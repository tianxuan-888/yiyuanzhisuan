import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 能量值互转接口（服务商之间互转）
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { fromProviderId, toProviderId, amount, note } = body;

    if (!fromProviderId || !toProviderId || !amount) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (user.role !== 'admin' && user.userId !== fromProviderId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    if (fromProviderId === toProviderId) {
      return NextResponse.json({ error: '不能给自己转账' }, { status: 400 });
    }

    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount < 50) {
      return NextResponse.json({ error: '转账金额不能少于50' }, { status: 400 });
    }

    // 查询转出方服务商信息
    const fromProviders = await query(
      'SELECT id, username, role, energy_value FROM users WHERE id = $1',
      [fromProviderId]
    );

    if (!fromProviders || fromProviders.length === 0) {
      return NextResponse.json({ error: '转出方用户不存在' }, { status: 404 });
    }

    const fromProvider = fromProviders[0];
    if (fromProvider.role !== 'provider') {
      return NextResponse.json({ error: '转出方不是服务商' }, { status: 400 });
    }

    const fromEnergyValue = parseFloat(fromProvider.energy_value || '0');
    if (fromEnergyValue < transferAmount) {
      return NextResponse.json({ error: `能量值不足，当前只有 ${fromEnergyValue}` }, { status: 400 });
    }

    // 查询转入方服务商信息
    const toProviders = await query(
      'SELECT id, username, role, energy_value FROM users WHERE id = $1',
      [toProviderId]
    );

    if (!toProviders || toProviders.length === 0) {
      return NextResponse.json({ error: '转入方用户不存在' }, { status: 404 });
    }

    const toProvider = toProviders[0];
    if (toProvider.role !== 'provider') {
      return NextResponse.json({ error: '转入方不是服务商' }, { status: 400 });
    }

    const newFromEnergy = fromEnergyValue - transferAmount;
    const newToEnergy = parseFloat(toProvider.energy_value || '0') + transferAmount;

    const result = await withTransaction(async (client) => {
      // 更新转出方能量值 - users表
      await client.query(
        'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
        [newFromEnergy, fromProviderId]
      );

      // 更新转入方能量值 - users表
      await client.query(
        'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
        [newToEnergy, toProviderId]
      );

      // 同步转出方 energy_accounts
      const fromAccRes = await client.query('SELECT id FROM energy_accounts WHERE user_id = $1', [fromProviderId]);
      if (fromAccRes.rows && fromAccRes.rows.length > 0) {
        await client.query(
          'UPDATE energy_accounts SET balance = $1, total_out = total_out + $2, updated_at = NOW() WHERE user_id = $3',
          [newFromEnergy, transferAmount, fromProviderId]
        );
      } else {
        await client.query(
          'INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at) VALUES ($1, $2, $3, 0, $4, NOW(), NOW())',
          [crypto.randomUUID(), fromProviderId, newFromEnergy, transferAmount]
        );
      }

      // 同步转入方 energy_accounts
      const toAccRes = await client.query('SELECT id FROM energy_accounts WHERE user_id = $1', [toProviderId]);
      if (toAccRes.rows && toAccRes.rows.length > 0) {
        await client.query(
          'UPDATE energy_accounts SET balance = $1, total_in = total_in + $2, updated_at = NOW() WHERE user_id = $3',
          [newToEnergy, transferAmount, toProviderId]
        );
      } else {
        await client.query(
          'INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at) VALUES ($1, $2, $3, $4, 0, NOW(), NOW())',
          [crypto.randomUUID(), toProviderId, newToEnergy, transferAmount]
        );
      }

      // 记录转出方流水
      await client.query(
        `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, note, status, created_at)
         VALUES ($1, $2, 'transfer_out', $3, $2, $4, $5, 'completed', NOW())`,
        [crypto.randomUUID(), fromProviderId, transferAmount, toProviderId, note || '服务商间能量值转出']
      );

      // 记录转入方流水
      await client.query(
        `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, note, status, created_at)
         VALUES ($1, $2, 'transfer_in', $3, $4, $2, $5, 'completed', NOW())`,
        [crypto.randomUUID(), toProviderId, transferAmount, fromProviderId, note || '服务商间能量值转入']
      );

      return { newFromEnergy, newToEnergy };
    });

    return NextResponse.json({
      success: true,
      message: '转账成功',
      data: {
        fromEnergy: result.newFromEnergy,
        toEnergy: result.newToEnergy,
        amount: transferAmount
      }
    });
  } catch (error) {
    console.error('能量值转账失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
