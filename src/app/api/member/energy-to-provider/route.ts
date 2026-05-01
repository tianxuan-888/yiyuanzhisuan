import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 能量值转给服务商
export async function POST(request: NextRequest) {
  try {
    // 鉴权
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { providerId, amount } = body;

    // 强制使用 JWT 中的 userId，防止冒充
    const userId = authUser.userId;

    if (!providerId || !amount) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const energyAmount = parseFloat(amount);
    if (isNaN(energyAmount) || energyAmount <= 0) {
      return NextResponse.json(
        { error: '能量值数量无效' },
        { status: 400 }
      );
    }

    if (energyAmount < 50) {
      return NextResponse.json(
        { error: '最小转账金额为 50 能量值' },
        { status: 400 }
      );
    }

    // 使用数据库事务 + 行锁保证原子性
    const result = await withTransaction(async (client) => {
      // 锁定用户行
      const userRes = await client.query(
        'SELECT id, username, energy_value, provider_id FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );

      if (userRes.rows.length === 0) {
        throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
      }

      const user = userRes.rows[0];
      const currentEnergy = parseFloat(user.energy_value) || 0;

      if (currentEnergy < energyAmount) {
        throw Object.assign(new Error('能量值不足'), { statusCode: 400 });
      }

      // 锁定服务商行并验证角色
      const providerRes = await client.query(
        "SELECT id, username, energy_value FROM users WHERE id = $1 AND role = 'provider' FOR UPDATE",
        [providerId]
      );

      if (providerRes.rows.length === 0) {
        throw Object.assign(new Error('服务商不存在'), { statusCode: 404 });
      }

      const provider = providerRes.rows[0];
      const providerEnergy = parseFloat(provider.energy_value) || 0;

      const newEnergy = currentEnergy - energyAmount;
      const newProviderEnergy = providerEnergy + energyAmount;

      // 扣减用户能量值
      await client.query(
        'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
        [newEnergy.toFixed(2), userId]
      );

      // 增加服务商能量值
      await client.query(
        'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
        [newProviderEnergy.toFixed(2), providerId]
      );

      // 记录用户转出到 energy_transactions 表
      await client.query(
        `INSERT INTO energy_transactions (id, user_id, type, amount, to_user_id, status, description, created_at)
         VALUES ($1, $2, 'transfer_out', $3, $4, 'completed', $5, NOW())`,
        [crypto.randomUUID(), userId, energyAmount.toFixed(2), providerId, `能量值转给服务商: ${provider.username}`]
      );

      // 记录服务商转入到 energy_transactions 表
      await client.query(
        `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, status, description, created_at)
         VALUES ($1, $2, 'transfer_in', $3, $4, 'completed', $5, NOW())`,
        [crypto.randomUUID(), providerId, energyAmount.toFixed(2), userId, `收到会员 ${user.username} 能量值转账`]
      );

      return { newEnergy, user, provider };
    });

    return NextResponse.json({
      success: true,
      data: {
        energy_value: result.newEnergy.toFixed(2),
      },
      message: `成功转出 ${energyAmount} 能量值给服务商`,
    });
  } catch (error: any) {
    console.error('能量值转账失败:', error);
    const statusCode = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || '能量值转账失败' },
      { status: statusCode }
    );
  }
}
