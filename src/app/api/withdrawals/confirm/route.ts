import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 确认打款
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅管理员和服务商可操作
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { withdrawalId, providerId, action, note } = body;

    // 参数验证
    if (!withdrawalId || !providerId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '无效的操作' }, { status: 400 });
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
      return NextResponse.json({ error: '提现记录不存在' }, { status: 404 });
    }

    if (withdrawal.status !== 'pending') {
      return NextResponse.json({ error: '该提现已被处理' }, { status: 400 });
    }

    // 白名单过滤更新字段
    const baseUpdate = {
      reviewed_by: providerId,
      review_note: note || null,
      reviewed_at: new Date().toISOString()
    };

    if (action === 'reject') {
      // 拒绝：返还余额给用户
      const { data: user } = await client
        .from('users')
        .select('balance')
        .eq('id', withdrawal.user_id)
        .maybeSingle();

      const currentBalance = parseFloat(user?.balance || '0');
      const newBalance = currentBalance + withdrawal.amount;

      // 白名单过滤
      await client.from('users').update({ balance: newBalance }).eq('id', withdrawal.user_id);

      // 更新提现状态 - 白名单过滤
      await client.from('withdrawals').update({ ...baseUpdate, status: 'rejected' }).eq('id', withdrawalId);

      return NextResponse.json({ success: true, message: '提现已拒绝，金额已返还给用户' });
    }

    // 批准：更新提现状态为已打款 - 白名单过滤
    await client.from('withdrawals').update({ ...baseUpdate, status: 'completed' }).eq('id', withdrawalId);

    // 查询用户信息
    const { data: userData } = await client.from('users').select('username').eq('id', withdrawal.user_id).single();

    return NextResponse.json({
      success: true,
      message: '提现已批准，款项已打给用户',
      data: {
        withdrawalId,
        amount: withdrawal.amount,
        user: userData?.username || '未知'
      }
    });
  } catch (error) {
    console.error('确认打款失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
