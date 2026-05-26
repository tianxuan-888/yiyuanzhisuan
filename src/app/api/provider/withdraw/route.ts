import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { queryOne, query, execute } from '@/lib/supabase-client';

/**
 * 服务商提现API
 * POST - 服务商申请提现智算金
 * GET  - 查询提现记录
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

    // 记录 transactions 明细
    await execute(
      `INSERT INTO transactions (id, user_id, order_id, type, amount, status, description, created_at)
       VALUES (gen_random_uuid(), $1, NULL, 'withdraw', $2, 'pending', $3, NOW())`,
      [user.id, withdrawAmount, JSON.stringify({
        type: '智算金提现',
        withdrawAmount,
        fee,
        actualAmount,
        alipayAccount,
        realName,
        note: '服务商智算金提现申请'
      })]
    );

    // 记录 energy_transactions 明细
    await execute(
      `INSERT INTO energy_transactions (id, type, amount, from_user_id, to_user_id, created_at)
       VALUES (gen_random_uuid(), 'withdraw', $1, $2, NULL, NOW())`,
      [withdrawAmount, user.id]
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

/**
 * GET - 查询服务商提现记录
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ success: false, error: '缺少用户ID' });
    }

    // 查询提现记录
    const records = await query(
      `SELECT id, amount, fee, actual_amount, alipay_account, real_name, status, reviewer_type, note, reject_reason, created_at, updated_at
       FROM withdrawals 
       WHERE user_id = $1 AND user_role = 'provider'
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );

    // 统计
    const stats = await queryOne(
      `SELECT 
        COUNT(*) as total_count,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) as pending_amount,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN actual_amount ELSE 0 END), 0) as approved_amount,
        COALESCE(SUM(CASE WHEN status = 'rejected' THEN amount ELSE 0 END), 0) as rejected_amount
       FROM withdrawals 
       WHERE user_id = $1 AND user_role = 'provider'`,
      [userId]
    );

    return NextResponse.json({
      success: true,
      data: {
        records: (records || []).map((r: any) => ({
          id: r.id,
          amount: Number(r.amount),
          fee: Number(r.fee),
          actualAmount: Number(r.actual_amount),
          alipayAccount: r.alipay_account,
          realName: r.real_name,
          status: r.status,
          reviewerType: r.reviewer_type,
          note: r.note,
          rejectReason: r.reject_reason,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
        stats: {
          totalCount: Number(stats?.total_count) || 0,
          pendingAmount: Number(stats?.pending_amount) || 0,
          approvedAmount: Number(stats?.approved_amount) || 0,
          rejectedAmount: Number(stats?.rejected_amount) || 0,
        }
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '查询失败';
    console.error('[provider/withdraw] GET error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
