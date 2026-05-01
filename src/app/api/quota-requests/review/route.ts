import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 审核额度申请
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅管理员和分公司可审核
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'branch'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { requestId, reviewerId, action, rejectReason, customAmount } = body;

    if (!requestId || !reviewerId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '无效的操作类型' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 获取申请信息
    const { data: quotaRequest, error: requestError } = await client
      .from('quota_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (requestError || !quotaRequest) {
      return NextResponse.json({ error: '申请不存在' }, { status: 400 });
    }

    if (quotaRequest.status !== 'pending') {
      return NextResponse.json({ error: '该申请已被处理' }, { status: 400 });
    }

    const now = new Date().toISOString();

    // 白名单过滤更新字段
    const baseUpdate = {
      reviewed_by: reviewerId,
      reviewed_at: now
    };

    if (action === 'reject') {
      // 拒绝申请
      const { error: updateError } = await client
        .from('quota_requests')
        .update({
          ...baseUpdate,
          status: 'rejected',
          reject_reason: rejectReason || '审核未通过'
        })
        .eq('id', requestId);

      if (updateError) {
        throw new Error(`更新申请状态失败: ${updateError.message}`);
      }

      return NextResponse.json({ success: true, message: '申请已拒绝' });
    }

    // 通过申请
    const approvedAmount = customAmount || quotaRequest.requested_amount;
    const finalAmount = Math.floor(approvedAmount * quotaRequest.multiplier);

    // 获取申请人信息
    const { data: requester } = await client
      .from('users')
      .select('id, username, real_name, role')
      .eq('id', quotaRequest.requester_id)
      .single();

    // 如果是分公司申请，检查总公司额度
    if (quotaRequest.requester_type === 'branch') {
      const { data: companyQuota, error: quotaError } = await client
        .from('company_quota')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (quotaError) {
        console.error('获取总公司额度失败:', quotaError.message);
      }

      if (companyQuota && companyQuota.available_quota < finalAmount) {
        return NextResponse.json({
          error: `总公司额度不足，当前可用额度: ¥${companyQuota.available_quota.toLocaleString()}`
        }, { status: 400 });
      }

      // 扣除总公司额度
      if (companyQuota) {
        await client.from('company_quota').update({
          available_quota: companyQuota.available_quota - finalAmount,
          used_quota: companyQuota.used_quota + finalAmount
        }).eq('id', companyQuota.id);
      }
    }

    // 更新申请状态
    await client.from('quota_requests').update({
      ...baseUpdate,
      status: 'approved',
      approved_amount: approvedAmount,
      final_amount: finalAmount
    }).eq('id', requestId);

    return NextResponse.json({
      success: true,
      message: `申请已通过，分配额度 ¥${finalAmount.toLocaleString()}`
    });
  } catch (error) {
    console.error('审核额度申请失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
