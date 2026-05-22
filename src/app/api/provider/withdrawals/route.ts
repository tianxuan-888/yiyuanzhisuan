import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { execute, queryOne } from '@/storage/database/pg-client';

// 获取提现申请列表
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');
    const status = searchParams.get('status') || 'all';

    if (!providerId) {
      return NextResponse.json({ error: '缺少服务商ID' }, { status: 400 });
    }

    const userAny = user as { role: string; userId: string };
    if (userAny.role !== 'admin' && userAny.userId !== providerId) {
      return NextResponse.json({ error: '无权查看' }, { status: 403 });
    }

    const client = getSupabaseClient();

    const { data: members, error: membersError } = await client
      .from('users')
      .select('id')
      .eq('provider_id', providerId)
      .eq('role', 'member');

    if (membersError) {
      throw new Error(`查询会员失败: ${membersError.message}`);
    }

    const memberIds = (members || []).map((m: any) => m.id);
    if (memberIds.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    let query = client
      .from('withdrawals')
      .select('*')
      .in('user_id', memberIds)
      .order('created_at', { ascending: false });

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data: withdrawals, error: withdrawalsError } = await query;
    if (withdrawalsError) {
      throw new Error(`查询提现申请失败: ${withdrawalsError.message}`);
    }

    let enrichedWithdrawals = withdrawals || [];
    if (withdrawals && withdrawals.length > 0) {
      const userIds = [...new Set((withdrawals as any[]).map((w: any) => w.user_id))];
      const { data: usersData } = await client
        .from('users')
        .select('id, username, phone, alipay_account, real_name')
        .in('id', userIds);

      const usersMap = ((usersData || []) as any[]).reduce((acc: Record<string, any>, u: any) => {
        acc[u.id] = u;
        return acc;
      }, {});

      enrichedWithdrawals = (withdrawals as any[]).map((w: any) => ({
        ...w,
        user: usersMap[w.user_id] || null
      }));
    }

    return NextResponse.json({ success: true, data: enrichedWithdrawals });
  } catch (error) {
    console.error('获取提现申请失败:', error);
    return NextResponse.json({ error: '获取提现申请失败' }, { status: 500 });
  }
}

// 处理提现申请（统一到总台审核）
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { withdrawalId, action, remark } = body;

    if (!withdrawalId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '无效的操作' }, { status: 400 });
    }

    // 查询提现记录
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
      // 拒绝：退回balance给用户
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

    // 批准：金额已从balance扣除，提现金额全额回流到总台
    const feeAmount = parseFloat(String(withdrawal.amount)) * 0.05;
    const actualAmount = parseFloat(String(withdrawal.amount)) - feeAmount;

    await execute(
      `UPDATE withdrawals SET status = 'completed', actual_amount = $1, fee = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $3`,
      [actualAmount, feeAmount, withdrawalId]
    );

    // 提现金额全额回流到总台（balance）
    await execute(
      "UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE role = 'admin'",
      [withdrawal.amount]
    );

    return NextResponse.json({
      success: true,
      message: `提现已批准，到账${actualAmount}元（手续费${feeAmount}元已归平台），提现金额${withdrawal.amount}元已回流总台`,
      data: { actualAmount, feeAmount, totalReturned: withdrawal.amount }
    });
  } catch (error) {
    console.error('处理提现申请失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
