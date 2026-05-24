import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, query } from '@/lib/supabase-client';

// 服务网点审核提现（会员/服务商的提现由服务网点审核，网点提现由总台审核）
// 审核通过：从用户balance扣除提现金额，手续费5%回流总台，95%记录为实际到账

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    const status = searchParams.get('status') || 'all';

    if (!branchId) {
      return NextResponse.json({ error: '缺少服务网点ID' }, { status: 400 });
    }

    // 查询该网点下所有服务商
    const providers = await query(
      'SELECT user_id FROM providers WHERE branch_id = $1',
      [branchId]
    );

    const providerIds = (providers || []).map((p: any) => p.user_id);
    if (providerIds.length === 0) {
      return NextResponse.json({ success: true, data: [], stats: { pendingCount: 0, pendingAmount: 0 } });
    }

    // 获取这些服务商下的所有会员ID
    const members = await query(
      'SELECT id FROM users WHERE provider_id = ANY($1) AND role = $2',
      [providerIds, 'member']
    );
    const memberIds = (members || []).map((m: any) => m.id);

    // 合并服务商和会员ID（网点只审核会员和服务商的提现）
    const allUserIds = [...providerIds, ...memberIds];

    if (allUserIds.length === 0) {
      return NextResponse.json({ success: true, data: [], stats: { pendingCount: 0, pendingAmount: 0 } });
    }

    let sql = 'SELECT w.*, u.username, u.phone, u.role as user_role_name FROM withdrawals w LEFT JOIN users u ON w.user_id = u.id WHERE w.user_id = ANY($1)';
    const params: any[] = [allUserIds];

    if (status !== 'all') {
      sql += ` AND w.status = $${params.length + 1}`;
      params.push(status);
    }

    sql += ' ORDER BY w.created_at DESC';

    const records = await query(sql, params);

    // 统计待审核数量和金额
    const pendingRecords = (records || []).filter((r: any) => r.status === 'pending');
    const stats = {
      pendingCount: pendingRecords.length,
      pendingAmount: pendingRecords.reduce((sum: number, r: any) => sum + parseFloat(r.amount || 0), 0),
    };

    return NextResponse.json({ success: true, data: records || [], stats });
  } catch (error) {
    console.error('获取提现记录失败:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '服务器错误' }, { status: 500 });
  }
}

// 服务网点审核提现（审核会员/服务商的提现申请）
// 审核通过：扣用户balance，手续费5%回流总台balance
// 审核拒绝：不扣钱（因为申请时没扣）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { withdrawalId, action, note, reviewerId } = body;

    if (!withdrawalId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '操作类型无效' }, { status: 400 });
    }

    const withdrawal = await queryOne(
      'SELECT * FROM withdrawals WHERE id = $1',
      [withdrawalId]
    );

    if (!withdrawal) {
      return NextResponse.json({ error: '提现记录不存在' }, { status: 404 });
    }

    if (withdrawal.status !== 'pending') {
      return NextResponse.json({ error: '该提现已被处理' }, { status: 400 });
    }

    const withdrawAmount = parseFloat(String(withdrawal.amount)) || 0;
    const fee = parseFloat(String(withdrawal.fee)) || Math.round(withdrawAmount * 0.05 * 100) / 100;
    const actualAmount = withdrawAmount - fee;

    if (action === 'reject') {
      // 拒绝：不扣钱（申请时没扣），只更新状态
      await execute(
        "UPDATE withdrawals SET status = 'rejected', reviewer_id = $1, reject_reason = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $3",
        [reviewerId || '', note || '审核拒绝', withdrawalId]
      );

      // 记录交易流水
      await execute(
        `INSERT INTO transactions (user_id, type, amount, note, created_at)
         VALUES ($1, 'withdraw_rejected', 0, $2, NOW())`,
        [withdrawal.user_id, `提现申请${withdrawAmount}元被网点拒绝${note ? '，原因：' + note : ''}`]
      );

      return NextResponse.json({ success: true, message: '已拒绝提现申请' });
    }

    // 批准：从用户balance扣除提现金额，手续费回流网点
    // 1. 检查用户余额是否足够
    const user = await queryOne(
      'SELECT id, balance FROM users WHERE id = $1',
      [withdrawal.user_id]
    );

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    const currentBalance = parseFloat(String(user.balance || '0'));
    if (currentBalance < withdrawAmount) {
      // 余额不足，自动拒绝
      await execute(
        "UPDATE withdrawals SET status = 'rejected', reviewer_id = $1, reject_reason = '审核时余额不足，自动拒绝', reviewed_at = NOW(), updated_at = NOW() WHERE id = $2",
        [reviewerId || '', withdrawalId]
      );
      return NextResponse.json({ error: '用户当前余额不足，已自动拒绝' }, { status: 400 });
    }

    // 2. 从用户balance扣除提现金额
    await execute(
      'UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE id = $2',
      [withdrawAmount.toFixed(2), withdrawal.user_id]
    );

    // 3. 提现金额全额回流到总台（手续费归总台收益账户）
    const admin = await queryOne("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (admin) {
      await execute(
        'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
        [withdrawAmount.toFixed(2), admin.id]
      );
    }

    // 4. 更新提现记录状态为 approved
    await execute(
      "UPDATE withdrawals SET status = 'approved', reviewer_id = $1, reviewed_at = NOW(), transferred_at = NOW(), note = $2, updated_at = NOW() WHERE id = $3",
      [reviewerId || '', note || '', withdrawalId]
    );

    // 5. 记录交易流水
    await execute(
      `INSERT INTO transactions (user_id, type, amount, note, created_at)
       VALUES ($1, 'withdraw', $2, $3, NOW())`,
      [withdrawal.user_id, withdrawAmount.toFixed(2), `网点审核提现通过，金额${withdrawAmount}元，手续费${fee}元回流总台，实际到账${actualAmount.toFixed(2)}元`]
    );

    return NextResponse.json({
      success: true,
      message: `提现审核通过，${withdrawAmount}元已从用户扣除并回流到总台，手续费${fee}元`,
      data: { withdrawAmount, fee, actualAmount },
    });
  } catch (error) {
    console.error('审核提现失败:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '服务器错误' }, { status: 500 });
  }
}
