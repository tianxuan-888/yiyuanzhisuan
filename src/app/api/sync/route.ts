import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 数据同步接口
export async function POST(request: NextRequest) {
  try {
    // 鉴权：从 JWT 获取用户身份
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    // 角色验证：只允许 admin/branch/provider
    if (!authorizeRole(authUser, ['admin', 'branch', 'provider'])) {
      return NextResponse.json({ error: '无权访问' }, { status: 403 });
    }

    const body = await request.json();
    const { syncType = 'all' } = body;

    // 使用 JWT 中的身份信息，不信任请求体中的 userId/userRole
    const userId = authUser.userId;
    const userRole = authUser.role;

    const client = getSupabaseClient();

    const syncData: {
      success: boolean;
      data: {
        orders?: unknown[];
        members?: unknown[];
        providers?: unknown[];
        products?: unknown[];
        quotaAllocations?: unknown[];
        transactions?: unknown[];
        notifications?: unknown[];
        providerApplications?: unknown[];
        branches?: unknown[];
        quotaRequests?: unknown[];
      };
      synced_at: string;
    } = {
      success: true,
      data: {},
      synced_at: new Date().toISOString(),
    };

    // 同步订单数据
    if (syncType === 'all' || syncType === 'orders') {
      const { data: orders, error: ordersError } = await client
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (!ordersError) {
        syncData.data.orders = orders || [];
      }
    }

    // 同步会员数据
    if (syncType === 'all' || syncType === 'members') {
      const { data: members, error: membersError } = await client
        .from('users')
        .select('id, username, role, real_name, phone, energy_value, balance, points, provider_id, branch_id, inviter_id, created_at, is_active')
        .eq('role', 'member')
        .order('created_at', { ascending: false });

      if (!membersError) {
        syncData.data.members = members || [];
      }
    }

    // 同步服务商数据
    if (syncType === 'all' || syncType === 'providers') {
      const { data: providers, error: providersError } = await client
        .from('users')
        .select('id, username, role, real_name, phone, energy_value, balance, branch_id, quota, used_quota, total_sales, created_at, is_active')
        .eq('role', 'provider')
        .order('created_at', { ascending: false });

      if (!providersError) {
        syncData.data.providers = providers || [];
      }
    }

    // 同步分公司数据
    if (syncType === 'all' || syncType === 'branches') {
      const { data: branches, error: branchesError } = await client
        .from('users')
        .select('id, username, role, real_name, phone, energy_value, balance, created_at, is_active')
        .eq('role', 'branch')
        .order('created_at', { ascending: false });

      if (!branchesError) {
        syncData.data.branches = branches || [];
      }
    }

    // 同步产品数据
    if (syncType === 'all' || syncType === 'products') {
      const { data: products, error: productsError } = await client
        .from('products')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (!productsError) {
        syncData.data.products = products || [];
      }
    }

    // 同步额度分配数据
    if (syncType === 'all' || syncType === 'quotas') {
      const { data: quotaAllocations, error: quotaError } = await client
        .from('quota_allocations')
        .select('*')
        .order('created_at', { ascending: false });

      if (!quotaError) {
        syncData.data.quotaAllocations = quotaAllocations || [];
      }
    }

    // 同步额度申请数据
    if (syncType === 'all' || syncType === 'quotaRequests') {
      const { data: quotaRequests, error: requestsError } = await client
        .from('quota_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (!requestsError) {
        syncData.data.quotaRequests = quotaRequests || [];
      }
    }

    // 同步交易记录
    if (syncType === 'all' || syncType === 'transactions') {
      const { data: transactions, error: transactionsError } = await client
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (!transactionsError) {
        syncData.data.transactions = transactions || [];
      }
    }

    // 根据用户角色过滤数据
    if (userRole === 'branch' && userId) {
      // 分公司只看到自己的服务商和会员
      const providers = syncData.data.providers as Array<{ branch_id: string; id: string }> || [];
      const members = syncData.data.members as Array<{ provider_id: string }> || [];
      
      syncData.data.providers = providers.filter(p => p.branch_id === userId);
      syncData.data.members = members.filter(m => {
        // 获取该分公司下属服务商的会员
        const branchProviders = providers.map(p => p.id);
        return branchProviders.includes(m.provider_id);
      });
    } else if (userRole === 'provider' && userId) {
      // 服务商只看到自己的会员
      const members = syncData.data.members as Array<{ provider_id: string }> || [];
      const quotaAllocations = syncData.data.quotaAllocations as Array<{ provider_id: string }> || [];
      
      syncData.data.members = members.filter(m => m.provider_id === userId);
      syncData.data.quotaAllocations = quotaAllocations.filter(q => q.provider_id === userId);
    }

    return NextResponse.json(syncData);
  } catch (error) {
    console.error('数据同步失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '数据同步失败' },
      { status: 500 }
    );
  }
}

// 获取数据同步状态
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const lastSyncTime = searchParams.get('lastSyncTime');

    const client = getSupabaseClient();

    // 获取各类数据的更新时间
    const syncStatus: Record<string, { count: number; last_updated: string | null }> = {
      orders: { count: 0, last_updated: null },
      members: { count: 0, last_updated: null },
      providers: { count: 0, last_updated: null },
      branches: { count: 0, last_updated: null },
      products: { count: 0, last_updated: null },
    };

    const [ordersRes, membersRes, providersRes, branchesRes, productsRes] = await Promise.all([
      client.from('orders').select('created_at', { count: 'exact', head: true }),
      client.from('users').select('updated_at', { count: 'exact', head: true }).eq('role', 'member'),
      client.from('users').select('updated_at', { count: 'exact', head: true }).eq('role', 'provider'),
      client.from('users').select('updated_at', { count: 'exact', head: true }).eq('role', 'branch'),
      client.from('products').select('updated_at', { count: 'exact', head: true }),
    ]);

    syncStatus.orders.count = ordersRes.count || 0;
    syncStatus.members.count = membersRes.count || 0;
    syncStatus.providers.count = providersRes.count || 0;
    syncStatus.branches.count = branchesRes.count || 0;
    syncStatus.products.count = productsRes.count || 0;

    return NextResponse.json({
      success: true,
      data: syncStatus,
    });
  } catch (error) {
    console.error('获取同步状态失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取同步状态失败' },
      { status: 500 }
    );
  }
}
