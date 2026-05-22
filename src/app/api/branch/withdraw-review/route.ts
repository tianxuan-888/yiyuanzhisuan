import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { queryOne, execute, query } from '@/storage/database/pg-client';

// 服务网点提现审核（统一到总台审核，服务网点不再直接审批）
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    const status = searchParams.get('status') || 'all';

    if (!branchId) {
      return NextResponse.json({ error: '缺少服务网点ID' }, { status: 400 });
    }

    // 查询该网点下所有服务商的提现记录
    const providers = await query(
      'SELECT user_id FROM providers WHERE branch_id = $1',
      [branchId]
    );

    const providerIds = (providers || []).map((p: any) => p.user_id);
    if (providerIds.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    // 获取这些服务商下的所有会员ID
    const members = await query(
      'SELECT id FROM users WHERE provider_id = ANY($1) AND role = $2',
      [providerIds, 'member']
    );
    const memberIds = (members || []).map((m: any) => m.id);

    // 合并服务商和会员ID
    const allUserIds = [...providerIds, ...memberIds];

    let sql = 'SELECT * FROM withdrawals WHERE user_id = ANY($1)';
    const params: any[] = [allUserIds];

    if (status !== 'all') {
      sql += ' AND status = $2';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';

    const records = await query(sql, params);

    return NextResponse.json({ success: true, data: records || [] });
  } catch (error) {
    console.error('获取提现记录失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// 服务网点审核提现（简化：只记录状态，实际由总台审核）
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { withdrawalId, action, remark } = body;

    if (!withdrawalId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
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

    if (action === 'reject') {
      // 拒绝：退还balance给用户
      await execute(
        'UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE id = $2',
        [withdrawal.amount, withdrawal.user_id]
      );
      await execute(
        "UPDATE withdrawals SET status = 'rejected', review_note = $1, reviewed_at = NOW(), updated_at = NOW() WHERE id = $2",
        [remark || null, withdrawalId]
      );
      return NextResponse.json({ success: true, message: '已拒绝提现申请，金额已退回' });
    }

    // 批准：金额回流到总台
    const feeRate = 0.05;
    const feeAmount = parseFloat(String(withdrawal.amount)) * feeRate;
    const actualAmount = parseFloat(String(withdrawal.amount)) - feeAmount;

    await execute(
      `UPDATE withdrawals SET status = 'completed', actual_amount = $1, fee = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $3`,
      [actualAmount, feeAmount, withdrawalId]
    );

    // 提现金额全额回流到总台
    await execute(
      "UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE role = 'admin'",
      [withdrawal.amount]
    );

    return NextResponse.json({
      success: true,
      message: `提现已批准，到账${actualAmount}元，手续费${feeAmount}元归平台，提现金额${withdrawal.amount}元已回流总台`,
    });
  } catch (error) {
    console.error('审核提现失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
