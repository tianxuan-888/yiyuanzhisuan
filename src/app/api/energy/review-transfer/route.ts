import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';
import { addEnergy, deductEnergy, getEnergyBalance } from '@/lib/energy-util';

// 服务商审核会员能量值转账申请
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    // 仅服务商和管理员可操作
    if (user.role !== 'provider' && user.role !== 'admin') {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { requestId, providerId, action, reviewNote } = body;

    if (!requestId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '无效的操作类型' }, { status: 400 });
    }

    const supabase = getSupabase();

    // 查询转账申请
    const { data: transferRequest, error: queryErr } = await supabase
      .from('energy_withdraw_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (queryErr || !transferRequest) {
      return NextResponse.json({ error: '转账申请不存在' }, { status: 404 });
    }

    // 验证状态
    if (transferRequest.status !== 'pending') {
      return NextResponse.json({ error: '该申请已处理' }, { status: 400 });
    }

    // 验证是转账类型
    if (transferRequest.withdraw_type !== 'transfer') {
      return NextResponse.json({ error: '该申请不是转账类型' }, { status: 400 });
    }

    // 验证服务商权限
    if (user.role !== 'admin' && transferRequest.to_user_id !== providerId) {
      return NextResponse.json({ error: '无权操作此转账' }, { status: 403 });
    }

    const transferAmount = Number(transferRequest.amount);
    const fromUserId = transferRequest.user_id;  // 会员
    const toUserId = transferRequest.to_user_id;  // 服务商

    if (action === 'reject') {
      // 拒绝：退还能量值给会员
      // 1. 退还能量值给会员（addEnergy 会同步更新 users + energy_accounts + 流水）
      const refundResult = await addEnergy(fromUserId, transferAmount, 'refund', {
        fromUserId: toUserId,
        note: '转账被拒绝，能量值退还',
      });

      if (!refundResult.success) {
        return NextResponse.json({ error: '退还能量值失败: ' + refundResult.error }, { status: 500 });
      }

      // 2. 更新申请状态
      const { error: updateErr } = await supabase
        .from('energy_withdraw_requests')
        .update({
          status: 'rejected',
          reviewed_by: providerId || user.userId,
          reviewed_at: new Date().toISOString(),
          review_note: reviewNote || '服务商拒绝',
          updated_at: new Date().toISOString(),
        })
        .eq('id', requestId);

      if (updateErr) {
        console.error('[review-transfer] 更新拒绝状态失败:', updateErr.message);
      }

      // 3. 更新之前的 pending 流水为 cancelled
      await supabase
        .from('energy_transactions')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('user_id', fromUserId)
        .eq('type', 'transfer_out')
        .eq('status', 'pending');

      return NextResponse.json({
        success: true,
        message: '已拒绝转账，能量值已退还给会员',
        data: { newEnergy: refundResult.newBalance }
      });
    }

    // 批准转账
    // 1. 给服务商增加能量值（addEnergy 会同步更新 users + energy_accounts + 流水）
    const addResult = await addEnergy(toUserId, transferAmount, 'transfer_in', {
      fromUserId,
      note: '会员能量值转入（审核通过）',
    });

    if (!addResult.success) {
      return NextResponse.json({ error: '服务商增加能量值失败: ' + addResult.error }, { status: 500 });
    }

    // 2. 更新申请状态
    const { error: updateErr } = await supabase
      .from('energy_withdraw_requests')
      .update({
        status: 'approved',
        reviewed_by: providerId || user.userId,
        reviewed_at: new Date().toISOString(),
        review_note: reviewNote || '服务商审核通过',
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId);

    if (updateErr) {
      console.error('[review-transfer] 更新批准状态失败:', updateErr.message);
    }

    // 3. 更新会员的 pending 流水为 completed
    await supabase
      .from('energy_transactions')
      .update({
        status: 'completed',
        note: '能量值转账给服务商（已审核通过）',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', fromUserId)
      .eq('type', 'transfer_out')
      .eq('status', 'pending');

    return NextResponse.json({
      success: true,
      message: '转账审核通过，能量值已转入您的账户',
      data: { newToEnergy: addResult.newBalance }
    });
  } catch (error) {
    console.error('审核能量值转账失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// 获取待审核的转账申请列表
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');
    const status = searchParams.get('status') || 'pending';

    if (!providerId) {
      return NextResponse.json({ error: '缺少服务商ID' }, { status: 400 });
    }

    // 验证权限
    if (user.role !== 'admin' && user.role !== 'provider') {
      return NextResponse.json({ error: '无权查看' }, { status: 403 });
    }

    const supabase = getSupabase();

    // 查询转账申请
    let query = supabase
      .from('energy_withdraw_requests')
      .select('*')
      .eq('to_user_id', providerId)
      .eq('withdraw_type', 'transfer')
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data: requests, error: queryErr } = await query;

    if (queryErr) {
      console.error('[review-transfer] 查询失败:', queryErr.message);
      return NextResponse.json({ error: '查询失败: ' + queryErr.message }, { status: 500 });
    }

    // 获取关联用户信息
    const userIds = [...new Set([
      ...(requests || []).map(r => r.user_id),
      ...(requests || []).map(r => r.to_user_id).filter(Boolean),
    ])];
    
    const { data: users } = await supabase
      .from('users')
      .select('id, username, phone, real_name, unique_id, energy_value')
      .in('id', userIds);

    const userMap: Record<string, Record<string, unknown>> = {};
    (users || []).forEach(u => { userMap[u.id] = u; });

    const result = (requests || []).map(r => ({
      ...r,
      username: userMap[r.user_id]?.username || '未知',
      phone: userMap[r.user_id]?.phone || '',
      user_real_name: userMap[r.user_id]?.real_name || '',
      unique_id: userMap[r.user_id]?.unique_id || '',
      user_energy_value: userMap[r.user_id]?.energy_value || 0,
    }));

    return NextResponse.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('获取转账审核列表失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
