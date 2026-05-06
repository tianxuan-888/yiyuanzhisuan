import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest } from '@/lib/auth';
import { execute, queryOne } from '@/lib/pg-client';

/**
 * 服务商给会员充值能量值
 * POST /api/provider/energy/recharge
 */
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || user.role !== 'provider') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const providerId = user.userId;
    const { memberId, amount, note } = await request.json();

    // 验证参数
    if (!memberId) {
      return NextResponse.json({ error: '请选择会员' }, { status: 400 });
    }

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: '请输入正确的充值金额' }, { status: 400 });
    }

    // 验证服务商余额 - 使用SQL查询
    const provider = await queryOne(
      `SELECT id, username, energy_value FROM users WHERE id = $1`,
      [providerId]
    );

    if (!provider) {
      return NextResponse.json({ error: '服务商不存在' }, { status: 404 });
    }

    const currentProviderBalance = parseFloat(provider.energy_value) || 0;
    if (currentProviderBalance < amount) {
      return NextResponse.json({ error: '能量值余额不足' }, { status: 400 });
    }

    // 验证会员存在
    const member = await queryOne(
      `SELECT id, username FROM users WHERE id = $1 AND role = 'member'`,
      [memberId]
    );

    if (!member) {
      return NextResponse.json({ error: '会员不存在' }, { status: 404 });
    }

    // 执行充值（使用SQL直接更新，确保写入成功）
    const newProviderBalance = currentProviderBalance - amount;

    // 扣除服务商能量值
    await execute(
      `UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2`,
      [newProviderBalance, providerId]
    );

    // 更新服务商 energy_accounts
    await execute(
      `UPDATE energy_accounts SET balance = balance - $1, total_out = total_out + $1, updated_at = NOW() WHERE user_id = $2`,
      [amount, providerId]
    );

    // 增加会员能量值
    await execute(
      `UPDATE users SET energy_value = energy_value + $1, updated_at = NOW() WHERE id = $2`,
      [amount, memberId]
    );

    // 更新会员 energy_accounts
    const memberAccount = await queryOne(
      `SELECT user_id FROM energy_accounts WHERE user_id = $1`,
      [memberId]
    );

    if (memberAccount) {
      await execute(
        `UPDATE energy_accounts SET balance = balance + $1, total_in = total_in + $1, updated_at = NOW() WHERE user_id = $2`,
        [amount, memberId]
      );
    } else {
      await execute(
        `INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $2, 0, NOW(), NOW())`,
        [memberId, amount]
      );
    }

    // 记录服务商支出
    await execute(
      `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, note, status, created_at) VALUES (gen_random_uuid(), $1, 'transfer_out', $2, $1, $3, $4, 'completed', NOW())`,
      [providerId, amount, memberId, note || '给会员充值能量值']
    );

    // 记录会员收入
    await execute(
      `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, note, status, created_at) VALUES (gen_random_uuid(), $1, 'recharge', $2, $3, $1, $4, 'completed', NOW())`,
      [memberId, amount, providerId, note || '服务商充值']
    );

    // 更新充值申请状态
    await execute(
      `UPDATE energy_recharge_records SET status = 'approved', updated_at = NOW() WHERE member_id = $1 AND status = 'pending' AND amount = $2 ORDER BY created_at DESC LIMIT 1`,
      [memberId, amount]
    ).catch(() => {/* 可能没有对应的充值申请记录 */});

    return NextResponse.json({
      success: true,
      message: `已成功充值 ${amount} 能量值给 ${member.username}`,
      data: {
        amount,
        memberName: member.username,
        providerEnergy: newProviderBalance,
      }
    });

  } catch (error: any) {
    console.error('Recharge error:', error);
    return NextResponse.json({ error: `充值失败: ${error.message}` }, { status: 500 });
  }
}
