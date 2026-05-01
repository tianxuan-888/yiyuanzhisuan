import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 确认打款
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅服务商/管理员可操作
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['provider', 'admin'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const providerId = authUser.userId;

    const body = await request.json();
    const { withdrawalId, action, note } = body;

    // 参数验证
    if (!withdrawalId || !action) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: '无效的操作' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient();

    // 查询提现记录
    const { data: withdrawal, error: withdrawalError } = await client
      .from('withdrawals')
      .select('*')
      .eq('id', withdrawalId)
      .maybeSingle();

    if (withdrawalError) {
      throw new Error(`查询提现记录失败: ${withdrawalError.message}`);
    }

    if (!withdrawal) {
      return NextResponse.json(
        { error: '提现记录不存在' },
        { status: 404 }
      );
    }

    if (withdrawal.status !== 'pending') {
      return NextResponse.json(
        { error: '该提现已被处理' },
        { status: 400 }
      );
    }

    if (action === 'reject') {
      // 拒绝：返还余额给用户
      const { data: user } = await client
        .from('users')
        .select('balance')
        .eq('id', withdrawal.user_id)
        .maybeSingle();

      const currentBalance = parseFloat(user?.balance || '0');
      const newBalance = currentBalance + withdrawal.amount;

      await client
        .from('users')
        .update({ balance: newBalance })
        .eq('id', withdrawal.user_id);

      // 更新提现状态
      await client
        .from('withdrawals')
        .update({
          status: 'rejected',
          reviewed_by: providerId,
          review_note: note || null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', withdrawalId);

      return NextResponse.json({
        success: true,
        message: '提现已拒绝，金额已返还给用户',
      });
    }

    // 批准：更新提现状态为已打款
    await client
      .from('withdrawals')
      .update({
        status: 'completed',
        reviewed_by: providerId,
        review_note: note || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', withdrawalId);

    // 查询用户信息
    const { data: user } = await client
      .from('users')
      .select('username')
      .eq('id', withdrawal.user_id)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      message: '打款确认成功',
      data: {
        withdrawal: {
          id: withdrawal.id,
          amount: withdrawal.amount,
          status: 'completed',
        },
        user: user ? { username: user.username } : null,
      },
    });
  } catch (error) {
    console.error('确认打款失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '操作失败' },
      { status: 500 }
    );
  }
}

// 获取待处理提现列表
export async function GET(request: NextRequest) {
  try {
    // 鉴权：仅服务商/管理员可查看
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['provider', 'admin'])) {
      return NextResponse.json({ error: '无权访问' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    const client = getSupabaseClient();

    const from = (page - 1) * pageSize;

    const { data, error, count } = await client
      .from('withdrawals')
      .select(`
        *,
        user:users!withdrawals_user_id_fkey(id, username, real_name, phone, wechat_account, alipay_account)
      `, { count: 'exact' })
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`查询提现列表失败: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      data: {
        list: data || [],
        total: count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    });
  } catch (error) {
    console.error('获取提现列表失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    );
  }
}
