import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/lib/supabase-client';

// 智算总台审核提现申请（仅审核服务网点的提现，会员/服务商提现由服务网点审核）
// 申请时已冻结余额，审核通过：100%到总台balance（总台线下付款给网点），审核拒绝：退还冻结余额

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { withdrawalId, action, note, adminUserId } = body;

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
    const fee = parseFloat(wd.fee_amount) || Math.round(withdrawAmount * 0.05 * 100) / 100;
    const actualAmount = withdrawAmount - fee;

    if (action === 'reject') {
      // 审核拒绝：退还冻结的余额
      await execute(
        'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
        [withdrawAmount.toFixed(2), wd.user_id]
      );

      await execute(
        "UPDATE withdrawals SET status = 'rejected', reviewed_by = $1, review_note = $2, updated_at = NOW() WHERE id = $3",
        [adminUserId || 'admin', note || '审核拒绝', withdrawalId]
      );

      // 记录交易流水
      await execute(
        `INSERT INTO transactions (user_id, type, amount, description, created_at)
         VALUES ($1, 'withdraw_rejected', $2, $3, NOW())`,
        [wd.user_id, withdrawAmount.toFixed(2), `提现申请${withdrawAmount}元被总台拒绝，已退还冻结金额`]
      );

      return NextResponse.json({
        success: true,
        message: '提现审核已拒绝，冻结余额已退还',
        data: { withdrawAmount },
      });
    }

    // 审核通过：余额已在申请时冻结
    // 100%到总台balance（总台线下付款给网点，5%是手续费）
    const admin = await queryOne("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (admin) {
      await execute(
        'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
        [withdrawAmount.toFixed(2), admin.id]
      );
      // 记录总台手续费收入
      await execute(
        `INSERT INTO transactions (user_id, type, amount, description, created_at)
         VALUES ($1, 'withdrawal_fee', $2, $3, NOW())`,
        [admin.id, fee.toFixed(2), `网点提现手续费收入：网点提现${withdrawAmount}元，手续费${fee}元`]
      );
      // 记录网点提现到账（95%待线下付款给网点）
      await execute(
        `INSERT INTO transactions (user_id, type, amount, description, created_at)
         VALUES ($1, 'branch_withdraw', $2, $3, NOW())`,
        [admin.id, actualAmount.toFixed(2), `网点提现到账：网点提现${withdrawAmount}元，95%即${actualAmount.toFixed(2)}元待线下付款给网点`]
      );
    }

    // 更新提现记录状态为 approved
    await execute(
      "UPDATE withdrawals SET status = 'approved', reviewed_by = $1, processed_at = NOW(), review_note = $2, updated_at = NOW() WHERE id = $3",
      [adminUserId || 'admin', note || '', withdrawalId]
    );

    // 记录提现人交易流水
    await execute(
      `INSERT INTO transactions (user_id, type, amount, description, created_at)
       VALUES ($1, 'withdraw', $2, $3, NOW())`,
      [wd.user_id, withdrawAmount.toFixed(2), `总台审核网点提现通过，金额${withdrawAmount}元，手续费${fee}元回流总台，实际到账${actualAmount.toFixed(2)}元`]
    );

    return NextResponse.json({
      success: true,
      message: `提现审核通过，${withdrawAmount}元已处理，手续费${fee}元回流总台，实际到账${actualAmount.toFixed(2)}元`,
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

// 获取所有提现记录（总台可看所有角色的提现记录，但只能审核网点提现）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const role = searchParams.get('role');

    // 总台查看所有提现记录，通过JOIN users获取角色
    let sql = `SELECT w.*, u.username, u.role as user_role, u.phone,
               b_user.username as reviewer_name
               FROM withdrawals w 
               LEFT JOIN users u ON w.user_id = u.id 
               LEFT JOIN users b_user ON w.reviewed_by = b_user.id 
               WHERE 1=1`;
    const params: any[] = [];

    if (role) {
      sql += ` AND u.role = $${params.length + 1}`;
      params.push(role);
    }

    if (status) {
      sql += ` AND w.status = $${params.length + 1}`;
      params.push(status);
    }

    sql += ' ORDER BY w.created_at DESC LIMIT 100';

    const data = await query(sql, params);

    // 统计 - 所有角色
    const stats = await queryOne(
      `SELECT 
        COUNT(*) as total_count,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) as pending_amount,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0) as approved_amount,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN COALESCE(fee_amount, 0) ELSE 0 END), 0) as total_fee
      FROM withdrawals`
    );

    // 按角色统计（通过JOIN users）
    const roleStats = await query(
      `SELECT u.role as user_role, 
        COUNT(*) as count,
        COALESCE(SUM(CASE WHEN w.status = 'pending' THEN w.amount ELSE 0 END), 0) as pending_amount,
        COALESCE(SUM(CASE WHEN w.status = 'approved' THEN w.amount ELSE 0 END), 0) as approved_amount
      FROM withdrawals w LEFT JOIN users u ON w.user_id = u.id GROUP BY u.role`
    );

    return NextResponse.json({
      success: true,
      data: {
        records: data,
        stats: stats || {},
        roleStats: roleStats || [],
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
