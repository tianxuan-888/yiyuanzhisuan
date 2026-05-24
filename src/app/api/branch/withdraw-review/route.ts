import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, query } from '@/lib/supabase-client';

// 服务网点审核提现（会员/服务商的提现由服务网点审核，网点提现由总台审核）
// 申请时已冻结余额，审核通过只处理手续费回流，审核拒绝则退还冻结余额

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
// 申请时已冻结余额，审核通过：95%到网点balance + 5%手续费到总台balance，审核拒绝：退还冻结余额
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
      // 拒绝：退还冻结的余额
      await execute(
        'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
        [withdrawAmount.toFixed(2), withdrawal.user_id]
      );

      await execute(
        "UPDATE withdrawals SET status = 'rejected', reviewer_id = $1, reject_reason = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $3",
        [reviewerId || '', note || '审核拒绝', withdrawalId]
      );

      // 记录交易流水
      await execute(
        `INSERT INTO transactions (user_id, type, amount, note, created_at)
         VALUES ($1, 'withdraw_rejected', $2, $3, NOW())`,
        [withdrawal.user_id, withdrawAmount.toFixed(2), `提现申请${withdrawAmount}元被网点拒绝，已退还冻结金额`]
      );

      return NextResponse.json({ success: true, message: '已拒绝提现申请，冻结余额已退还' });
    }

    // 批准：余额已在申请时冻结
    // 1. 95%到网点账上（网点线下付款给提现人）
    const branchAmount = actualAmount; // withdrawAmount - fee
    await execute(
      'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
      [branchAmount.toFixed(2), reviewerId]
    );
    // 记录网点收入
    await execute(
      `INSERT INTO transactions (user_id, type, amount, note, created_at)
       VALUES ($1, 'withdraw_to_branch', $2, $3, NOW())`,
      [reviewerId, branchAmount.toFixed(2), `审核提现收入：用户${withdrawal.user_id}提现${withdrawAmount}元，95%（${branchAmount.toFixed(2)}元）到网点账`]
    );

    // 2. 手续费5%回流到总台收益账户
    const admin = await queryOne("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (admin) {
      await execute(
        'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
        [fee.toFixed(2), admin.id]
      );
      // 记录总台手续费收入
      await execute(
        `INSERT INTO transactions (user_id, type, amount, note, created_at)
         VALUES ($1, 'withdrawal_fee', $2, $3, NOW())`,
        [admin.id, fee.toFixed(2), `提现手续费收入：用户${withdrawal.user_id}提现${withdrawAmount}元，手续费${fee}元`]
      );
    }

    // 3. 更新提现记录状态为 approved
    await execute(
      "UPDATE withdrawals SET status = 'approved', reviewer_id = $1, reviewed_at = NOW(), transferred_at = NOW(), note = $2, updated_at = NOW() WHERE id = $3",
      [reviewerId || '', note || '', withdrawalId]
    );

    // 4. 记录提现人交易流水
    await execute(
      `INSERT INTO transactions (user_id, type, amount, note, created_at)
       VALUES ($1, 'withdraw', $2, $3, NOW())`,
      [withdrawal.user_id, withdrawAmount.toFixed(2), `网点审核提现通过，金额${withdrawAmount}元，手续费${fee}元回流总台，95%（${actualAmount.toFixed(2)}元）到网点账`]
    );

    return NextResponse.json({
      success: true,
      message: `提现审核通过，${withdrawAmount}元已处理：95%（${actualAmount.toFixed(2)}元）到网点账，手续费${fee}元回流总台`,
      data: { withdrawAmount, fee, actualAmount, branchAmount },
    });
  } catch (error) {
    console.error('审核提现失败:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '服务器错误' }, { status: 500 });
  }
}
