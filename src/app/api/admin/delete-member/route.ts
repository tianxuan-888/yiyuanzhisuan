import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/storage/database/pg-client';

// 删除会员账号（前提：无持仓）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { memberId } = body;

    if (!memberId) {
      return NextResponse.json({ error: '缺少会员ID' }, { status: 400 });
    }

    // 1. 检查用户是否存在且是会员角色
    const member = await queryOne<{ id: string; role: string; username: string; energy_value: number; balance: number }>(
      `SELECT id, role, username, energy_value, balance FROM users WHERE id = $1`,
      [memberId]
    );

    if (!member) {
      return NextResponse.json({ error: '用户不存在' }, { status: 400 });
    }

    if (member.role !== 'member') {
      return NextResponse.json({ error: '只能删除会员账号' }, { status: 400 });
    }

    // 2. 检查会员是否有持仓（holding状态的user_products）
    const holdingResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM user_products WHERE user_id = $1 AND status = 'holding'`,
      [memberId]
    );

    if (holdingResult && parseInt(holdingResult.count) > 0) {
      return NextResponse.json({ 
        error: `该会员有 ${holdingResult.count} 个持仓中的产品，无法删除账号` 
      }, { status: 400 });
    }

    // 3. 清除相关数据并删除账号

    // 3.1 删除资金流水记录
    await execute(`DELETE FROM capital_flow_records WHERE user_id = $1`, [memberId]);

    // 3.2 删除能量值流水
    await execute(`DELETE FROM energy_transactions WHERE from_user_id = $1 OR to_user_id = $1`, [memberId]);

    // 3.3 删除能量值账户
    await execute(`DELETE FROM energy_accounts WHERE user_id = $1`, [memberId]);

    // 3.4 删除通知
    await execute(`DELETE FROM notifications WHERE user_id = $1`, [memberId]);

    // 3.5 删除已完成的用户产品记录（非holding状态）
    await execute(`DELETE FROM user_products WHERE user_id = $1 AND status != 'holding'`, [memberId]);

    // 3.6 删除订单
    await execute(`DELETE FROM orders WHERE user_id = $1`, [memberId]);

    // 3.7 删除提现记录
    await execute(`DELETE FROM withdrawals WHERE user_id = $1`, [memberId]);

    // 3.8 删除充值申请
    await execute(`DELETE FROM energy_recharge_requests WHERE user_id = $1`, [memberId]);

    // 3.9 清除下级会员的inviter_id引用
    await execute(`UPDATE users SET inviter_id = NULL WHERE inviter_id = $1`, [memberId]);

    // 3.10 清除下级会员的provider_id引用
    await execute(`UPDATE users SET provider_id = NULL WHERE provider_id = $1`, [memberId]);

    // 3.11 删除用户账号
    await execute(`DELETE FROM users WHERE id = $1 AND role = 'member'`, [memberId]);

    return NextResponse.json({
      success: true,
      message: `会员 ${member.username} 的账号已删除，相关收益和数据已清除`
    });

  } catch (error: any) {
    console.error('[admin/delete-member] Error:', error);
    return NextResponse.json(
      { error: error.message || '删除会员账号失败' },
      { status: 500 }
    );
  }
}
