import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 将会员升级为服务商（或为已有服务商设置额度）
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅管理员和分公司可操作
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'branch'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { memberId, branchId, initialQuota } = body;

    if (!memberId) {
      return NextResponse.json({ error: '缺少会员ID' }, { status: 400 });
    }

    if (!branchId) {
      return NextResponse.json({ error: '缺少分公司ID' }, { status: 400 });
    }

    if (!initialQuota || initialQuota < 50000) {
      return NextResponse.json({ error: '初始额度不能少于50000' }, { status: 400 });
    }

    // 验证操作者权限
    if (user.role !== 'admin' && user.userId !== branchId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const client = getSupabaseClient();

    // 1. 查询用户信息
    const { data: member, error: memberError } = await client
      .from('users')
      .select('*')
      .eq('id', memberId)
      .maybeSingle();

    if (memberError) {
      throw new Error(`查询用户失败: ${memberError.message}`);
    }

    if (!member) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    // 2. 检查该用户是否已经是服务商
    const { data: existingProvider, error: existingError } = await client
      .from('providers')
      .select('id, quota, used_quota')
      .eq('user_id', memberId)
      .maybeSingle();

    if (existingError) {
      throw new Error(`检查服务商状态失败: ${existingError.message}`);
    }

    // 白名单过滤 - 使用execute(SQL)确保写入
    const { execute } = await import('@/lib/pg-client');
    
    // 如果providers记录已存在，更新额度
    if (existingProvider) {
      const currentUsedQuota = parseFloat(existingProvider.used_quota || '0');
      const newUsedQuota = initialQuota >= currentUsedQuota ? 0 : currentUsedQuota;
      
      await execute(
        `UPDATE providers SET quota = $1, branch_id = $2, used_quota = $3 WHERE user_id = $4`,
        [initialQuota, branchId, newUsedQuota, memberId]
      );

      // 如果用户角色不是provider，也更新角色
      if (member.role !== 'provider') {
        await execute(`UPDATE users SET role = 'provider' WHERE id = $1`, [memberId]);
      }

      return NextResponse.json({
        success: true,
        message: '额度更新成功',
        data: { userId: memberId, username: member.username, branchId, initialQuota }
      });
    }

    // 创建新的服务商记录
    await client.from('providers').insert({
      user_id: memberId,
      quota: initialQuota,
      used_quota: 0,
      branch_id: branchId
    });

    // 更新用户角色为服务商
    await execute(`UPDATE users SET role = 'provider' WHERE id = $1`, [memberId]);

    return NextResponse.json({
      success: true,
      message: '升级成功，用户已成为服务商',
      data: { userId: memberId, username: member.username, branchId, initialQuota }
    });
  } catch (error) {
    console.error('升级会员失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
