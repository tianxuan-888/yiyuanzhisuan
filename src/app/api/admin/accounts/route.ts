import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role'); // branch, provider, member
    const branchId = searchParams.get('branchId');
    const providerId = searchParams.get('providerId');

    const client = getSupabase();

    if (role === 'branch') {
      // 查询所有服务网点
      const { data: branches, error } = await client
        .from('users')
        .select('id, username, real_name, phone, unique_id, role, balance, energy_value, is_active, created_at, branch_id')
        .eq('role', 'branch')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // 查询每个网点下的服务商数量
      const branchesWithStats = await Promise.all((branches || []).map(async (b: any) => {
        // 查询该网点下的服务商
        const { data: providers } = await client
          .from('providers')
          .select('user_id, quota, used_quota, total_sales')
          .eq('branch_id', b.id);

        const providerCount = providers?.length || 0;

        // 查询该网点下的会员数（通过服务商关联）
        let memberCount = 0;
        if (providers && providers.length > 0) {
          const providerIds = providers.map((p: any) => p.user_id);
          const { count } = await client
            .from('users')
            .select('*', { count: 'exact', head: true })
            .in('provider_id', providerIds)
            .eq('role', 'member');
          memberCount = count || 0;
        }

        // 查询该网点的额度
        const { data: allocations } = await client
          .from('quota_allocations')
          .select('quota_amount, used_amount')
          .eq('branch_id', b.id);

        const totalQuota = allocations?.reduce((s: number, a: any) => s + (Number(a.quota_amount) || 0), 0) || 0;
        const usedQuota = allocations?.reduce((s: number, a: any) => s + (Number(a.used_amount) || 0), 0) || 0;

        return {
          ...b,
          provider_count: providerCount,
          member_count: memberCount,
          total_quota: totalQuota,
          used_quota: usedQuota,
        };
      }));

      return NextResponse.json({ success: true, data: branchesWithStats });
    }

    if (role === 'provider') {
      // 查询服务商
      let query = client
        .from('providers')
        .select('id, user_id, quota, used_quota, total_sales, branch_id')
        .order('created_at', { ascending: false });

      if (branchId) {
        query = query.eq('branch_id', branchId);
      }

      const { data: providers, error } = await query;
      if (error) throw error;

      // 查询每个服务商的用户信息和会员数
      const providersWithStats = await Promise.all((providers || []).map(async (p: any) => {
        const { data: user } = await client
          .from('users')
          .select('id, username, real_name, phone, unique_id, role, balance, energy_value, is_active, created_at, inviter_id, parent_provider_id')
          .eq('id', p.user_id)
          .single();

        // 查询会员数
        const { count: memberCount } = await client
          .from('users')
          .select('*', { count: 'exact', head: true })
          .eq('provider_id', p.user_id)
          .eq('role', 'member');

        // 查询体系收益（该服务商体系下所有释放记录中服务商分到的）
        const { data: releaseRecords } = await client
          .from('release_records')
          .select('provider_share')
          .eq('provider_id', p.user_id);

        const totalRevenue = releaseRecords?.reduce((s: number, r: any) => s + (Number(r.provider_share) || 0), 0) || 0;

        // 计算预警：体系收益 / Token额度
        const quotaRatio = p.quota > 0 ? (totalRevenue / p.quota) * 100 : 0;
        const isWarning = quotaRatio > 30;

        return {
          ...p,
          user: user || {},
          member_count: memberCount || 0,
          total_revenue: totalRevenue,
          quota_ratio: quotaRatio,
          is_warning: isWarning,
          available_quota: Number(p.quota) - Number(p.used_quota),
        };
      }));

      return NextResponse.json({ success: true, data: providersWithStats });
    }

    if (role === 'member') {
      // 查询会员
      let memberQuery = client
        .from('users')
        .select('id, username, real_name, phone, unique_id, role, balance, energy_value, is_active, created_at, provider_id, inviter_id')
        .eq('role', 'member')
        .order('created_at', { ascending: false });

      if (providerId) {
        memberQuery = memberQuery.eq('provider_id', providerId);
      }

      const { data: members, error } = await memberQuery;
      if (error) throw error;

      // 查询每个会员的持仓和收益
      const membersWithStats = await Promise.all((members || []).map(async (m: any) => {
        // 查询服务商名
        let providerName = '-';
        if (m.provider_id) {
          const { data: providerUser } = await client
            .from('users')
            .select('username')
            .eq('id', m.provider_id)
            .single();
          providerName = providerUser?.username || '-';
        }

        // 查询持仓
        const { count: holdingCount } = await client
          .from('user_products')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', m.id)
          .eq('status', 'holding');

        // 查询该会员在释放记录中的分配
        const { data: releaseRecords } = await client
          .from('release_records')
          .select('member_share')
          .eq('member_id', m.id);

        const totalRevenue = releaseRecords?.reduce((s: number, r: any) => s + (Number(r.member_share) || 0), 0) || 0;

        return {
          ...m,
          provider_name: providerName,
          holding_count: holdingCount || 0,
          total_revenue: totalRevenue,
        };
      }));

      return NextResponse.json({ success: true, data: membersWithStats });
    }

    // 默认返回汇总
    const { count: branchCount } = await client.from('users').select('*', { count: 'exact', head: true }).eq('role', 'branch');
    const { count: providerCount } = await client.from('users').select('*', { count: 'exact', head: true }).eq('role', 'provider');
    const { count: memberCount } = await client.from('users').select('*', { count: 'exact', head: true }).eq('role', 'member');

    return NextResponse.json({
      success: true,
      data: {
        branch_count: branchCount || 0,
        provider_count: providerCount || 0,
        member_count: memberCount || 0,
      }
    });
  } catch (error: any) {
    console.error('[accounts] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// 修改账户状态或角色
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, action, value } = body;

    if (!userId || !action) {
      return NextResponse.json({ success: false, error: '缺少参数' }, { status: 400 });
    }

    const client = getSupabase();

    if (action === 'toggle_status') {
      // 切换账户状态（停用/正常）
      const { data: user } = await client.from('users').select('is_active').eq('id', userId).single();
      const newStatus = user?.is_active ? false : true;

      const { error } = await client.from('users').update({ is_active: newStatus }).eq('id', userId);
      if (error) throw error;

      return NextResponse.json({ success: true, message: `账户已${newStatus ? '启用' : '停用'}` });
    }

    if (action === 'change_role') {
      // 修改角色
      const { error } = await client.from('users').update({ role: value }).eq('id', userId);
      if (error) throw error;

      return NextResponse.json({ success: true, message: `角色已修改为${value}` });
    }

    return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
  } catch (error: any) {
    console.error('[accounts] PUT Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
