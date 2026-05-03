import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 服务商收益转能量值（5%变积分，95%变能量值）
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    if (authUser.role !== 'provider') {
      return NextResponse.json({ error: '仅服务商可使用此接口' }, { status: 403 });
    }

    const body = await request.json();
    const { amount } = body;
    const userId = authUser.userId;

    if (!amount) {
      return NextResponse.json({ error: '缺少转换金额' }, { status: 400 });
    }

    const convertAmount = parseFloat(amount);
    if (isNaN(convertAmount) || convertAmount <= 0) {
      return NextResponse.json({ error: '转换金额无效' }, { status: 400 });
    }

    if (convertAmount < 10) {
      return NextResponse.json({ error: '最小转换金额为 10 元' }, { status: 400 });
    }

    const pointsAmount = Math.round(convertAmount * 0.05 * 100) / 100;
    const energyAmount = convertAmount - pointsAmount;

    const result = await withTransaction(async (client) => {
      const userRes = await client.query(
        'SELECT id, username, balance, energy_value, points FROM users WHERE id = $1',
        [userId]
      );

      if (!userRes.rows || userRes.rows.length === 0) {
        throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
      }

      const user = userRes.rows[0];
      const currentBalance = parseFloat(user.balance) || 0;
      const currentEnergy = parseFloat(user.energy_value) || 0;
      const currentPoints = parseFloat(user.points) || 0;

      if (currentBalance < convertAmount) {
        throw Object.assign(new Error('收益余额不足'), { statusCode: 400 });
      }

      const newBalance = currentBalance - convertAmount;
      const newEnergy = currentEnergy + energyAmount;
      const newPoints = currentPoints + pointsAmount;

      await client.query(
        'UPDATE users SET balance = $1, energy_value = $2, points = $3, updated_at = NOW() WHERE id = $4',
        [newBalance.toFixed(2), newEnergy.toFixed(2), newPoints.toFixed(2), userId]
      );

      // 同步更新 energy_accounts
      const isIncrease = energyAmount > 0;
      await client.query(
        `INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET 
           balance = $3,
           total_in = energy_accounts.total_in + $4,
           total_out = energy_accounts.total_out + $5,
           updated_at = NOW()`,
        [crypto.randomUUID(), userId, newEnergy.toFixed(2), isIncrease ? energyAmount.toFixed(2) : '0', isIncrease ? '0' : Math.abs(energyAmount).toFixed(2)]
      );

      // 记录能量值流水
      await client.query(
        `INSERT INTO energy_transactions (user_id, type, amount, from_user_id, to_user_id, note, created_at)
         VALUES ($1, 'convert_from_balance', $2, $1, $1, $3, NOW())`,
        [userId, energyAmount.toFixed(2), `收益转能量值: ${energyAmount.toFixed(2)}元`]
      );

      // 记录积分流水
      await client.query(
        `INSERT INTO points_records (user_id, type, amount, balance_after, note, created_at)
         VALUES ($1, 'convert', $2, $3, $4, NOW())`,
        [userId, pointsAmount.toFixed(2), newPoints.toFixed(2), `收益转能量值产生积分5%: ${pointsAmount}元`]
      );

      return { newBalance, newEnergy, newPoints, energyAmount, pointsAmount };
    });

    return NextResponse.json({
      success: true,
      data: {
        convertedAmount: convertAmount.toFixed(2),
        energyAdded: result.energyAmount.toFixed(2),
        pointsAdded: result.pointsAmount.toFixed(2),
        balance: result.newBalance.toFixed(2),
        energyValue: result.newEnergy.toFixed(2),
        points: result.newPoints.toFixed(2),
      },
      message: `转换成功：${energyAmount.toFixed(2)}元→能量值，${pointsAmount.toFixed(2)}元→积分`,
    });
  } catch (error: any) {
    console.error('服务商收益转能量值失败:', error);
    const statusCode = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || '转换失败' },
      { status: statusCode }
    );
  }
}
