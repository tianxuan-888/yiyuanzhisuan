import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { queryOne, execute } from '@/lib/supabase-client';

/**
 * 服务商提现API
 * POST - 服务商申请提现智算金
 * 扣除 energy_value，5%手续费，网点审核
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });

    const body = await request.json();
    const { userId, amount, alipayAccount, realName } = body;

    if (!userId || !amount || parseFloat(amount) < 100) {
      return NextResponse.json({ success: false, error: '最低提现金额为100元' });
    }

    const withdrawAmount = parseFloat(amount);

    // 查询用户信息
    const user = await queryOne(
      `SELECT id, username, role, energy_value, balance FROM users WHERE id = $1`,
      [userId]
    );

    if (!user) {
      return NextResponse.json({ success: false, error: '用户不存在' });
    }

    if (user.role !== 'provider') {
      return NextResponse.json({ success: false, error: '仅服务商可使用此接口' });
    }

    // 检查智算金余额
    const energyValue = Number(user.energy_value) || 0;
    if (energyValue < withdrawAmount) {
      return NextResponse.json({ success: false, error: `智算金余额不足，当前余额¥${energyValue}` });
    }

    // 计算手续费5%
    const fee = Math.round(withdrawAmount * 0.05 * 100) / 100;
    const actualAmount = Math.round((withdrawAmount - fee) * 100) / 100;

    // 扣除智算金
    await execute(
      `UPDATE users SET energy_value = energy_value - $1, updated_at = NOW() WHERE id = $2`,
      [withdrawAmount, user.id]
    );

    // 写入提现记录
    await queryOne(
      `INSERT INTO withdrawals (user_id, user_role, amount, fee, actual_amount, alipay_account, real_name, status, reviewer_type, note, created_at, updated_at)
       VALUES ($1, 'provider', $2, $3, $4, $5, $6, 'pending', 'branch', '服务商智算金提现', NOW(), NOW())
       RETURNING id`,
      [user.id, withdrawAmount, fee, actualAmount, alipayAccount || null, realName || null]
    );

    return NextResponse.json({
      success: true,
      message: '提现申请已提交，等待网点审核',
      data: {
        amount: withdrawAmount,
        fee,
        actualAmount
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '提现申请失败';
    console.error('[provider/withdraw] error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
