import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 服务商给会员充值能量值
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const providerId = authUser.userId;
    const body = await request.json();
    const { memberId, amount, note } = body;

    if (!memberId || !amount) {
      return NextResponse.json({ error: '缺少必要参数：memberId, amount' }, { status: 400 });
    }

    const rechargeAmount = parseFloat(amount);
    if (isNaN(rechargeAmount) || rechargeAmount <= 0) {
      return NextResponse.json({ error: '充值金额必须大于0' }, { status: 400 });
    }

    // 验证服务商身份和能量值
    const providerUsers = await query(
      'SELECT id, username, energy_value, role FROM users WHERE id = $1',
      [providerId]
    );

    if (!providerUsers || providerUsers.length === 0 || providerUsers[0].role !== 'provider') {
      return NextResponse.json({ error: '非服务商身份，无权操作' }, { status: 403 });
    }

    const provider = providerUsers[0];
    const providerEnergy = parseFloat(provider.energy_value || '0');
    if (providerEnergy < rechargeAmount) {
      return NextResponse.json({
        error: '服务商能量值不足',
        data: { required: rechargeAmount, current: providerEnergy },
      }, { status: 400 });
    }

    // 验证会员存在
    const memberUsers = await query(
      'SELECT id, username, energy_value FROM users WHERE id = $1',
      [memberId]
    );

    if (!memberUsers || memberUsers.length === 0) {
      return NextResponse.json({ error: '会员不存在' }, { status: 404 });
    }

    const member = memberUsers[0];
    const memberEnergy = parseFloat(member.energy_value || '0');
    const newProviderEnergy = providerEnergy - rechargeAmount;
    const newMemberEnergy = memberEnergy + rechargeAmount;

    const result = await withTransaction(async (client) => {
      // 1. 扣除服务商能量值 - users表
      await client.query(
        'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
        [newProviderEnergy, providerId]
      );

      // 2. 增加会员能量值 - users表
      await client.query(
        'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
        [newMemberEnergy, memberId]
      );

      // 3. 同步服务商 energy_accounts
      const provAccRes = await client.query('SELECT id FROM energy_accounts WHERE user_id = $1', [providerId]);
      if (provAccRes.rows && provAccRes.rows.length > 0) {
        await client.query(
          'UPDATE energy_accounts SET balance = $1, total_out = total_out + $2, updated_at = NOW() WHERE user_id = $3',
          [newProviderEnergy, rechargeAmount, providerId]
        );
      } else {
        await client.query(
          'INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at) VALUES ($1, $2, $3, 0, $4, NOW(), NOW())',
          [crypto.randomUUID(), providerId, newProviderEnergy, rechargeAmount]
        );
      }

      // 4. 同步会员 energy_accounts
      const memAccRes = await client.query('SELECT id FROM energy_accounts WHERE user_id = $1', [memberId]);
      if (memAccRes.rows && memAccRes.rows.length > 0) {
        await client.query(
          'UPDATE energy_accounts SET balance = $1, total_in = total_in + $2, updated_at = NOW() WHERE user_id = $3',
          [newMemberEnergy, rechargeAmount, memberId]
        );
      } else {
        await client.query(
          'INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at) VALUES ($1, $2, $3, $4, 0, NOW(), NOW())',
          [crypto.randomUUID(), memberId, newMemberEnergy, rechargeAmount]
        );
      }

      // 5. 记录服务商转出流水 - energy_transactions
      await client.query(
        `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, note, status, created_at)
         VALUES ($1, $2, 'transfer_out', $3, $2, $4, $5, 'completed', NOW())`,
        [crypto.randomUUID(), providerId, rechargeAmount, memberId, `给会员 ${member.username} 充值能量值`]
      );

      // 6. 记录会员转入流水 - energy_transactions
      await client.query(
        `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, note, status, created_at)
         VALUES ($1, $2, 'transfer_in', $3, $4, $2, $5, 'completed', NOW())`,
        [crypto.randomUUID(), memberId, rechargeAmount, providerId, `服务商 ${provider.username} 充值能量值`]
      );

      // 7. 充值记录 - energy_recharge_records
      await client.query(
        `INSERT INTO energy_recharge_records (id, provider_id, member_id, amount, status, note, created_at)
         VALUES ($1, $2, $3, $4, 'approved', $5, NOW())`,
        [crypto.randomUUID(), providerId, memberId, rechargeAmount, note || '服务商直接充值']
      );

      return { newProviderEnergy, newMemberEnergy };
    });

    return NextResponse.json({
      success: true,
      message: `成功为会员 ${member.username} 充值能量值 ${rechargeAmount}`,
      data: {
        provider: {
          id: providerId,
          username: provider.username,
          beforeEnergy: providerEnergy,
          afterEnergy: result.newProviderEnergy,
        },
        member: {
          id: memberId,
          username: member.username,
          beforeEnergy: memberEnergy,
          afterEnergy: result.newMemberEnergy,
        },
        amount: rechargeAmount,
        note: note || '无',
      },
    });
  } catch (error) {
    console.error('充值能量值失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '充值能量值失败' },
      { status: 500 }
    );
  }
}

// 获取服务商会员列表（用于选择要充值的会员）
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['provider'])) {
      return NextResponse.json({ error: '无权访问' }, { status: 403 });
    }

    const providerId = authUser.userId;

    const members = await query(
      'SELECT id, username, phone, real_name, energy_value, created_at FROM users WHERE provider_id = $1 AND role = $2',
      [providerId, 'member']
    );

    return NextResponse.json({
      success: true,
      data: members || [],
    });
  } catch (error) {
    console.error('获取会员列表失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取会员列表失败' },
      { status: 500 }
    );
  }
}
