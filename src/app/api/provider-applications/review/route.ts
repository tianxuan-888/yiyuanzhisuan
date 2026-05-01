import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 晋级分公司所需培养的服务商数量
const PROMOTE_TO_BRANCH_PROVIDER_COUNT = 9;

// 检查并处理服务商晋级分公司
async function checkAndPromoteToBranch(parentProviderId: string): Promise<{ promoted: boolean; message: string }> {
  // 查询该服务商直接培养的下级服务商数量
  const result = await query(
    'SELECT COUNT(*) as count FROM providers WHERE parent_provider_id = $1',
    [parentProviderId]
  );
  const subordinateCount = parseInt(result?.[0]?.count || '0');

  // 如果达到9个，晋级为分公司
  if (subordinateCount >= PROMOTE_TO_BRANCH_PROVIDER_COUNT) {
    const client = getSupabaseClient();

    // 获取当前服务商信息
    const providerInfo = await query(
      'SELECT user_id, branch_id FROM providers WHERE id = $1',
      [parentProviderId]
    );

    if (providerInfo.length > 0) {
      const providerUserId = providerInfo[0].user_id;
      const originalBranchId = providerInfo[0].branch_id;

      // 将用户角色升级为分公司
      await client.from('users').update({ role: 'branch' }).eq('id', providerUserId);

      // 创建分公司记录
      await query(
        `INSERT INTO branches (user_id, name, status, created_at)
         VALUES ($1, $2, 'active', NOW())
         ON CONFLICT (user_id) DO NOTHING`,
        [providerUserId, `分公司-${providerUserId.slice(0, 8)}`]
      );

      // 将该服务商的所有下级服务商转移给原分公司（或创建新的分公司关系）
      // 更新下级服务商的branch_id
      await query(
        'UPDATE providers SET branch_id = $1 WHERE parent_provider_id = $2',
        [originalBranchId || providerUserId, parentProviderId]
      );

      return {
        promoted: true,
        message: `恭喜！您已培养 ${subordinateCount} 个服务商，成功晋级为分公司！`
      };
    }
  }

  return { promoted: false, message: '' };
}

// 审核服务商申请
export async function POST(request: NextRequest) {
  try {
    // 鉴权：管理员、分公司、服务商可审核
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'branch', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { applicationId, reviewerId, action, rejectReason, quotaAllocated } = body;

    // 参数验证
    if (!applicationId || !reviewerId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '无效的操作类型' }, { status: 400 });
    }

    // 验证操作者权限
    if (user.role !== 'admin' && user.userId !== reviewerId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const client = getSupabaseClient();

    // 获取申请信息
    const { data: application, error: appError } = await client
      .from('provider_applications')
      .select('*')
      .eq('id', applicationId)
      .single();

    if (appError || !application) {
      return NextResponse.json({ error: '申请不存在' }, { status: 400 });
    }

    if (application.status !== 'pending') {
      return NextResponse.json({ error: '该申请已被处理' }, { status: 400 });
    }

    // 验证审核人权限
    const { data: reviewer, error: reviewerError } = await client
      .from('users')
      .select('id, role')
      .eq('id', reviewerId)
      .single();

    if (reviewerError || !reviewer) {
      return NextResponse.json({ error: '审核人不存在' }, { status: 400 });
    }

    // 第一代申请只能由分公司审核
    if (application.apply_type === 'first_gen' && reviewer.role !== 'branch') {
      return NextResponse.json({ error: '只有分公司可以审核第一代服务商申请' }, { status: 403 });
    }

    // 第二代申请只能由上级服务商审核
    if (application.apply_type === 'second_gen') {
      if (reviewer.role !== 'provider') {
        return NextResponse.json({ error: '只有服务商可以审核第二代服务商申请' }, { status: 403 });
      }
      if (reviewer.id !== application.parent_provider_id) {
        return NextResponse.json({ error: '只有上级服务商可以审核此申请' }, { status: 403 });
      }
    }

    const now = new Date().toISOString();

    // 白名单过滤
    const baseUpdate = {
      reviewed_by: reviewerId,
      reviewed_at: now
    };

    if (action === 'reject') {
      // 拒绝申请
      const { error: updateError } = await client
        .from('provider_applications')
        .update({
          ...baseUpdate,
          status: 'rejected',
          reject_reason: rejectReason || '审核未通过'
        })
        .eq('id', applicationId);

      if (updateError) {
        throw new Error(`更新申请状态失败: ${updateError.message}`);
      }

      return NextResponse.json({ success: true, message: '申请已拒绝' });
    }

    // 批准申请
    await client.from('provider_applications').update({
      ...baseUpdate,
      status: 'approved'
    }).eq('id', applicationId);

    // 将用户角色更新为服务商
    await client.from('users').update({ role: 'provider' }).eq('id', application.user_id);

    // 如果是第二代申请，检查上级服务商是否需要晋级为分公司
    let promoteResult = { promoted: false, message: '' };
    if (application.apply_type === 'second_gen' && application.parent_provider_id) {
      promoteResult = await checkAndPromoteToBranch(application.parent_provider_id);
    }

    return NextResponse.json({
      success: true,
      message: promoteResult.promoted 
        ? promoteResult.message 
        : '服务商申请已通过，用户已升级为服务商',
      data: {
        promoted: promoteResult.promoted,
        subordinateCount: promoteResult.promoted ? PROMOTE_TO_BRANCH_PROVIDER_COUNT : null
      }
    });
  } catch (error) {
    console.error('审核服务商申请失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
