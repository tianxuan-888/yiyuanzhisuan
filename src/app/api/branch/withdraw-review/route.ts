import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/lib/supabase-client';

// 服务网点审核提现申请（审核会员和服务商的提现）
// 申请时已冻结余额，审核通过：95%到网点balance + 5%手续费到总台balance，审核拒绝：退还冻结余额

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { withdrawalId, action, note, branchUserId } = body;

    if (!withdrawalId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '操作类型无效，只能是 approve 或 reject' }, { status: 400 });
    }

    // 查询提现记录
    const wd = await queryOne(
      'SELECT * FROM withdrawals WHERE id = $1',
      [withdrawalId]
    );

    if (!wd) {
      return NextResponse.json({ error: '提现记录不存在' }, { status: 404 });
    }

    if (wd.status !== 'pending') {
      return NextResponse.json({ error: `提现状态为 ${wd.status}，无法审核` }, { status: 400 });
    }

    const withdrawAmount = parseFloat(wd.amount) || 0;
    const fee = parseFloat(wd.fee) || Math.round(withdrawAmount * 0.05 * 100) / 100;
    const actualAmount = withdrawAmount - fee;

    if (action === 'reject') {
      // 审核拒绝：退还冻结的余额
      await execute(
        'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
        [withdrawAmount.toFixed(2), wd.user_id]
      );

      await execute(
        "UPDATE withdrawals SET status = 'rejected', reviewer_id = $1, reject_reason = $2, updated_at = NOW() WHERE id = $3",
        [branchUserId, note || '审核拒绝', withdrawalId]
      );

      // 记录交易流水
      await execute(
        `INSERT INTO transactions (user_id, type, amount, description, created_at)
         VALUES ($1, 'withdraw_rejected', $2, $3, NOW())`,
        [wd.user_id, withdrawAmount.toFixed(2), `提现申请${withdrawAmount}元被服务网点拒绝，已退还冻结金额`]
      );

      return NextResponse.json({
        success: true,
        message: '提现审核已拒绝，冻结余额已退还',
        data: { withdrawAmount },
      });
    }

    // 审核通过：余额已在申请时冻结
    // 95%到网点balance
    await execute(
      'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
      [actualAmount.toFixed(2), branchUserId]
    );
    // 记录网点收入流水
    await execute(
      `INSERT INTO transactions (user_id, type, amount, description, created_at)
       VALUES ($1, 'withdrawal_income', $2, $3, NOW())`,
      [branchUserId, actualAmount.toFixed(2), `审核提现通过：会员/服务商提现${withdrawAmount}元，95%即${actualAmount.toFixed(2)}元到账`]
    );

    // 5%手续费到总台balance
    const admin = await queryOne("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (admin && fee > 0) {
      await execute(
        'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
        [fee.toFixed(2), admin.id]
      );
      // 记录总台手续费收入
      await execute(
        `INSERT INTO transactions (user_id, type, amount, description, created_at)
         VALUES ($1, 'withdrawal_fee', $2, $3, NOW())`,
        [admin.id, fee.toFixed(2), `提现手续费收入：会员/服务商提现${withdrawAmount}元，5%手续费${fee}元`]
      );
    }

    // 更新提现记录状态为 approved
    await execute(
      "UPDATE withdrawals SET status = 'approved', reviewer_id = $1, transferred_at = NOW(), note = $2, updated_at = NOW() WHERE id = $3",
      [branchUserId, note || '', withdrawalId]
    );

    // 记录提现人交易流水
    await execute(
      `INSERT INTO transactions (user_id, type, amount, description, created_at)
       VALUES ($1, 'withdraw', $2, $3, NOW())`,
      [wd.user_id, withdrawAmount.toFixed(2), `服务网点审核提现通过，金额${withdrawAmount}元，手续费${fee}元，实际到账${actualAmount.toFixed(2)}元`]
    );

    return NextResponse.json({
      success: true,
      message: `提现审核通过，${actualAmount.toFixed(2)}元到账，手续费${fee}元回流总台`,
      data: { withdrawAmount, fee, actualAmount },
    });
  } catch (error) {
    console.error('审核提现失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '审核提现失败' },
      { status: 500 }
    );
  }
}

// 获取服务网点下的提现记录（会员和服务商的提现）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    const status = searchParams.get('status');

    if (!branchId) {
      return NextResponse.json({ error: '缺少网点ID' }, { status: 400 });
    }

    // 查询该网点下所有会员和服务商的提现记录
    // 会员通过 provider_id 关联到服务商，服务商通过 branch_id 关联到网点
    const data = await query(
      `SELECT w.*, u.username, u.role as user_role, u.phone,
              b_user.username as reviewer_name
       FROM withdrawals w 
       LEFT JOIN users u ON w.user_id = u.id 
       LEFT JOIN users b_user ON w.reviewer_id = b_user.id 
       WHERE (
         w.user_id IN (SELECT id FROM users WHERE provider_id IN (SELECT user_id FROM providers WHERE branch_id = $1))
         OR w.user_id IN (SELECT user_id FROM providers WHERE branch_id = $1)
       )
       AND u.role IN ('member', 'provider')
       ${status ? ' AND w.status = $2' : ''}
       ORDER BY w.created_at DESC LIMIT 100`,
      status ? [branchId, status] : [branchId]
    );

    // 统计
    const stats = await queryOne(
      `SELECT 
        COUNT(*) as total_count,
        COALESCE(SUM(CASE WHEN w.status = 'pending' THEN w.amount ELSE 0 END), 0) as pending_amount,
        COALESCE(SUM(CASE WHEN w.status = 'approved' THEN w.amount ELSE 0 END), 0) as approved_amount,
        COALESCE(SUM(CASE WHEN w.status = 'approved' THEN COALESCE(w.fee, 0) ELSE 0 END), 0) as total_fee
      FROM withdrawals w 
      LEFT JOIN users u ON w.user_id = u.id 
      WHERE (
        w.user_id IN (SELECT id FROM users WHERE provider_id IN (SELECT user_id FROM providers WHERE branch_id = $1))
        OR w.user_id IN (SELECT user_id FROM providers WHERE branch_id = $1)
      )
      AND u.role IN ('member', 'provider')`,
      [branchId]
    );

    return NextResponse.json({
      success: true,
      data: {
        records: data,
        stats: stats || {},
      },
    });
  } catch (error) {
    console.error('获取提现记录失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取提现记录失败' },
      { status: 500 }
    );
  }
}
