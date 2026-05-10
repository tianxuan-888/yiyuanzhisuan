import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// 递归获取会员的整条直推树（所有层级）
async function getDownlineTree(userId: string): Promise<string[]> {
  const allIds: string[] = [userId];
  const queue: string[] = [userId];
  const visited = new Set<string>([userId]);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    // 查找以 currentId 为推荐人的所有用户
    const { data: downlines, error } = await supabase
      .from('users')
      .select('id')
      .eq('inviter_id', currentId);

    if (error || !downlines) continue;

    for (const dl of downlines) {
      if (!visited.has(dl.id)) {
        visited.add(dl.id);
        allIds.push(dl.id);
        queue.push(dl.id);
      }
    }
  }

  return allIds;
}

// 检查用户是否有持有中的产品
async function hasHoldingProducts(userIds: string[]): Promise<{ hasHolding: boolean; holders: string[] }> {
  if (userIds.length === 0) return { hasHolding: false, holders: [] };

  const { data, error } = await supabase
    .from('user_products')
    .select('user_id')
    .in('user_id', userIds)
    .eq('status', 'holding');

  if (error) return { hasHolding: false, holders: [] };

  const holders = [...new Set((data || []).map((d: { user_id: string }) => d.user_id))];
  return { hasHolding: holders.length > 0, holders };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { branchId, memberId, targetProviderId, operatorId, preview } = body;

    if (!branchId || !memberId || !targetProviderId || !operatorId) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 1. 验证操作者是分公司
    const { data: operator, error: opError } = await supabase
      .from('users')
      .select('id, role, branch_id')
      .eq('id', operatorId)
      .single();

    if (opError || !operator || operator.role !== 'branch') {
      return NextResponse.json(
        { success: false, message: '无操作权限，仅分公司可执行转移' },
        { status: 403 }
      );
    }

    // 2. 验证被转移会员存在
    const { data: member, error: memberError } = await supabase
      .from('users')
      .select('id, username, role, provider_id, unique_id, phone')
      .eq('id', memberId)
      .single();

    if (memberError || !member) {
      return NextResponse.json(
        { success: false, message: '会员不存在' },
        { status: 404 }
      );
    }

    // 会员通过 provider_id 关联服务商，服务商的 branch_id 确定所属分公司
    // 验证该会员所属服务商在同一分公司下
    if (member.provider_id) {
      const { data: currentProvider } = await supabase
        .from('users')
        .select('id, branch_id')
        .eq('id', member.provider_id)
        .single();

      if (!currentProvider || currentProvider.branch_id !== branchId) {
        return NextResponse.json(
          { success: false, message: '该会员不属于当前分公司' },
          { status: 400 }
        );
      }
    }

    // 3. 验证目标服务商存在且属于同一分公司
    const { data: targetProvider, error: tpError } = await supabase
      .from('users')
      .select('id, username, role, branch_id, unique_id')
      .eq('id', targetProviderId)
      .single();

    if (tpError || !targetProvider) {
      return NextResponse.json(
        { success: false, message: '目标服务商不存在' },
        { status: 404 }
      );
    }

    if (targetProvider.role !== 'provider') {
      return NextResponse.json(
        { success: false, message: '目标用户不是服务商' },
        { status: 400 }
      );
    }

    if (targetProvider.branch_id !== branchId) {
      return NextResponse.json(
        { success: false, message: '目标服务商不在同一分公司下，无法转移' },
        { status: 400 }
      );
    }

    // 4. 不能转移到当前服务商
    if (member.provider_id === targetProviderId) {
      return NextResponse.json(
        { success: false, message: '该会员已隶属目标服务商，无需转移' },
        { status: 400 }
      );
    }

    // 5. 获取整条直推树
    const treeUserIds = await getDownlineTree(memberId);
    console.log(`[TRANSFER] 直推树用户数: ${treeUserIds.length}, IDs: ${treeUserIds.join(', ')}`);

    // 6. 验证直推树中所有用户都没有持有产品
    const { hasHolding, holders } = await hasHoldingProducts(treeUserIds);
    if (hasHolding) {
      const { data: holderUsers } = await supabase
        .from('users')
        .select('id, username, unique_id')
        .in('id', holders);

      const holderNames = (holderUsers || []).map((u: { username: string; unique_id: string }) => 
        `${u.username}[${u.unique_id}]`
      ).join(', ');

      // 预览模式也返回错误，让前端展示
      return NextResponse.json(
        { 
          success: false, 
          message: `转移失败：以下会员持有产品中，必须先清空持仓才能转移 - ${holderNames}` 
        },
        { status: 400 }
      );
    }

    // === 预览模式：只返回预览数据，不执行转移 ===
    if (preview) {
      // 获取直推树中用户的信息
      const { data: treeUsers } = await supabase
        .from('users')
        .select('id, username, unique_id, role, provider_id')
        .in('id', treeUserIds);

      return NextResponse.json({
        success: true,
        data: {
          treeSize: treeUserIds.length,
          targetProviderName: targetProvider.username,
          targetProviderUniqueId: targetProvider.unique_id,
          treeUsers: (treeUsers || []).map((u: any) => ({
            id: u.id,
            username: u.username,
            unique_id: u.unique_id,
            role: u.role,
            currentProviderId: u.provider_id
          }))
        }
      });
    }

    // === 执行模式：真正转移 ===
    // 7. 更新直推树中所有用户的 provider_id
    const idList = treeUserIds.map(id => `'${id}'`).join(',');
    const updateSql = `UPDATE users SET provider_id = '${targetProviderId}', updated_at = NOW() WHERE id IN (${idList})`;
    
    const { error: updateError } = await supabase.rpc('rpc_execute', { sql_query: updateSql });

    if (updateError) {
      console.error('[TRANSFER] 更新失败:', updateError);
      return NextResponse.json(
        { success: false, message: `转移失败: ${updateError.message}` },
        { status: 500 }
      );
    }

    console.log(`[TRANSFER] 转移成功: ${treeUserIds.length} 个用户从服务商 ${member.provider_id} 转移到 ${targetProviderId}`);

    return NextResponse.json({
      success: true,
      message: `转移成功，共转移 ${treeUserIds.length} 个会员到服务商 ${targetProvider.username}`,
      data: {
        transferredCount: treeUserIds.length,
        targetProvider: {
          id: targetProvider.id,
          username: targetProvider.username,
          uniqueId: targetProvider.unique_id
        },
        transferredMember: {
          id: member.id,
          username: member.username,
          uniqueId: member.unique_id
        }
      }
    });

  } catch (error) {
    console.error('[TRANSFER] 服务器错误:', error);
    return NextResponse.json(
      { success: false, message: '服务器错误' },
      { status: 500 }
    );
  }
}
