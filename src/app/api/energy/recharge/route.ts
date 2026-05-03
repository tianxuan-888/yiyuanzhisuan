import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 能量值充值（服务商给会员充值）
// 统一使用 PostgreSQL 直连，同步更新 users.energy_value + energy_accounts + energy_transactions
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { providerId, memberId, amount } = body;

    // 参数验证
    if (!providerId || !memberId || !amount) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    if (amount <= 0) {
      return NextResponse.json(
        { error: '充值金额必须大于0' },
        { status: 400 }
      );
    }

    // 查询服务商信息
    const providers = await query(
      'SELECT id, username, energy_value, role FROM users WHERE id = $1',
      [providerId]
    );

    if (providers.length === 0) {
      return NextResponse.json(
        { error: '服务商不存在' },
        { status: 404 }
      );
    }

    const provider = providers[0];

    // 验证是服务商角色
    if (provider.role !== 'provider' && provider.role !== 'admin') {
      return NextResponse.json(
        { error: '只有服务商才能充值能量值' },
        { status: 403 }
      );
    }

    // 查询会员信息
    const members = await query(
      'SELECT id, username, energy_value FROM users WHERE id = $1',
      [memberId]
    );

    if (members.length === 0) {
      return NextResponse.json(
        { error: '会员不存在' },
        { status: 404 }
      );
    }

    const member = members[0];

    // 检查服务商能量值是否足够
    const providerEnergy = parseFloat(provider.energy_value || '0');
    if (providerEnergy < amount) {
      return NextResponse.json({
        success: false,
        error: '服务商能量值不足',
        data: {
          required: amount,
          current: providerEnergy,
          short: amount - providerEnergy,
        },
      }, { status: 400 });
    }

    // 计算新余额
    const newProviderEnergy = providerEnergy - amount;
    const memberEnergy = parseFloat(member.energy_value || '0');
    const newMemberEnergy = memberEnergy + amount;

    // 1. 更新 users 表能量值（服务商扣除、会员增加）
    await query(
      'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
      [newProviderEnergy, providerId]
    );
    await query(
      'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
      [newMemberEnergy, memberId]
    );

    // 2. 同步更新 energy_accounts（服务商扣除）
    await query(
      `INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at)
       VALUES ($1, $2, $3, 0, $4, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET 
         balance = $3,
         total_out = energy_accounts.total_out + $4,
         updated_at = NOW()`,
      [crypto.randomUUID(), providerId, newProviderEnergy, amount]
    );

    // 3. 同步更新 energy_accounts（会员增加）
    await query(
      `INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 0, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET 
         balance = $3,
         total_in = energy_accounts.total_in + $4,
         updated_at = NOW()`,
      [crypto.randomUUID(), memberId, newMemberEnergy, amount]
    );

    // 4. 记录能量值流水（服务商扣除）
    await query(
      `INSERT INTO energy_transactions (user_id, type, amount, from_user_id, to_user_id, note, status, created_at)
       VALUES ($1, 'transfer_out', $2, $1, $3, $4, 'completed', NOW())`,
      [providerId, -amount, memberId, `给会员 ${member.username} 充值能量值`]
    );

    // 5. 记录能量值流水（会员增加）
    await query(
      `INSERT INTO energy_transactions (user_id, type, amount, from_user_id, to_user_id, note, status, created_at)
       VALUES ($1, 'recharge', $2, $3, $1, $4, 'completed', NOW())`,
      [memberId, amount, providerId, `服务商 ${provider.username} 充值`]
    );

    return NextResponse.json({
      success: true,
      message: `成功为会员 ${member.username} 充值能量值 ${amount}`,
      data: {
        provider: {
          id: providerId,
          username: provider.username,
          beforeEnergy: providerEnergy,
          afterEnergy: newProviderEnergy,
        },
        member: {
          id: memberId,
          username: member.username,
          beforeEnergy: memberEnergy,
          afterEnergy: newMemberEnergy,
        },
        amount,
      },
    });
  } catch (error) {
    console.error('能量值充值失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '充值失败' },
      { status: 500 }
    );
  }
}
