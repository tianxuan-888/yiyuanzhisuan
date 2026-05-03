import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 积分转能量值（同步更新 users + energy_accounts + energy_transactions）
export async function POST(request: NextRequest) {
  try {
    // 鉴权：需要登录
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { points } = body;
    const userId = user.userId;

    if (!points) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const pointsAmount = parseFloat(points);
    if (isNaN(pointsAmount) || pointsAmount <= 0) {
      return NextResponse.json({ error: '积分数量无效' }, { status: 400 });
    }

    const result = await withTransaction(async (client) => {
      // 查询用户信息
      const userRes = await client.query(
        'SELECT id, points, energy_value FROM users WHERE id = $1',
        [userId]
      );

      if (!userRes.rows || userRes.rows.length === 0) {
        throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
      }

      const userData = userRes.rows[0];
      const currentPoints = parseFloat(userData.points) || 0;
      if (currentPoints < pointsAmount) {
        throw Object.assign(new Error('积分不足'), { statusCode: 400 });
      }

      const newPoints = currentPoints - pointsAmount;
      const currentEnergy = parseFloat(userData.energy_value) || 0;
      const newEnergy = currentEnergy + pointsAmount;

      // 1. 更新 users 表积分和能量值
      await client.query(
        'UPDATE users SET points = $1, energy_value = $2, updated_at = NOW() WHERE id = $3',
        [newPoints.toFixed(2), newEnergy.toFixed(2), userId]
      );

      // 2. 同步更新 energy_accounts
      await client.query(
        `INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 0, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET 
           balance = $3,
           total_in = energy_accounts.total_in + $4,
           updated_at = NOW()`,
        [crypto.randomUUID(), userId, newEnergy.toFixed(2), pointsAmount.toFixed(2)]
      );

      // 3. 记录能量值流水
      await client.query(
        `INSERT INTO energy_transactions (user_id, type, amount, from_user_id, to_user_id, note, status, created_at)
         VALUES ($1, 'points_to_energy', $2, $1, $1, $3, 'completed', NOW())`,
        [userId, pointsAmount.toFixed(2), `积分转能量值: ${pointsAmount}`]
      );

      // 4. 记录积分流水
      await client.query(
        `INSERT INTO points_records (user_id, type, amount, balance_after, note, created_at)
         VALUES ($1, 'exchange', $2, $3, $4, NOW())`,
        [userId, pointsAmount.toFixed(2), newPoints.toFixed(2), `积分转能量值: -${pointsAmount}`]
      );

      return { newPoints, newEnergy, pointsAmount };
    });

    return NextResponse.json({
      success: true,
      message: '转换成功',
      data: { 
        newPoints: result.newPoints, 
        newEnergy: result.newEnergy, 
        points: result.pointsAmount 
      }
    });
  } catch (error: any) {
    console.error('积分转能量值失败:', error);
    const statusCode = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || '服务器错误' },
      { status: statusCode }
    );
  }
}
