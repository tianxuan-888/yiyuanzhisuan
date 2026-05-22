import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';

export async function GET(request: NextRequest) {
  try {
    const client = getSupabase();

    // 1. 公司总额度
    const { data: companyQuota } = await client
      .from('company_quota')
      .select('*')
      .limit(1)
      .single();

    const totalQuota = Number(companyQuota?.total_quota) || 100000000;
    const usedQuota = Number(companyQuota?.used_quota) || 0;
    const availableQuota = Number(companyQuota?.available_quota) || (totalQuota - usedQuota);

    // 2. 各服务网点额度分配
    const { data: allocations } = await client
      .from('quota_allocations')
      .select('branch_id, quota_amount, used_amount, provider_id');

    // 按网点分组
    const branchMap: Record<string, { quota: number; used: number; providers: any[] }> = {};
    (allocations || []).forEach((a: any) => {
      if (!branchMap[a.branch_id]) {
        branchMap[a.branch_id] = { quota: 0, used: 0, providers: [] };
      }
      branchMap[a.branch_id].quota += Number(a.quota_amount) || 0;
      branchMap[a.branch_id].used += Number(a.used_amount) || 0;
    });

    // 3. 各服务商额度与收益
    const { data: providers } = await client
      .from('providers')
      .select('id, user_id, quota, used_quota, total_sales, branch_id');

    // 查询服务商用户信息
    const providerUserIds = (providers || []).map((p: any) => p.user_id);
    const { data: providerUsers } = await client
      .from('users')
      .select('id, username, real_name, phone, unique_id, balance')
      .in('id', providerUserIds);

    const userMap: Record<string, any> = {};
    (providerUsers || []).forEach((u: any) => { userMap[u.id] = u; });

    // 查询释放记录中的收益汇总（按服务商分组）
    const { data: releaseByProvider } = await client
      .from('release_records')
      .select('provider_id, provider_share, product_price');

    const providerRevenueMap: Record<string, { total_revenue: number; total_product_price: number }> = {};
    (releaseByProvider || []).forEach((r: any) => {
      if (!providerRevenueMap[r.provider_id]) {
        providerRevenueMap[r.provider_id] = { total_revenue: 0, total_product_price: 0 };
      }
      providerRevenueMap[r.provider_id].total_revenue += Number(r.provider_share) || 0;
      providerRevenueMap[r.provider_id].total_product_price += Number(r.product_price) || 0;
    });

    // 构建服务商列表（含预警）
    const providerStats = (providers || []).map((p: any) => {
      const user = userMap[p.user_id] || {};
      const revenue = providerRevenueMap[p.user_id] || { total_revenue: 0, total_product_price: 0 };
      const quotaRatio = Number(p.quota) > 0 ? (revenue.total_revenue / Number(p.quota)) * 100 : 0;
      const isWarning = quotaRatio > 30;

      return {
        id: p.id,
        user_id: p.user_id,
        username: user.username || '-',
        real_name: user.real_name || '-',
        phone: user.phone || '-',
        unique_id: user.unique_id || '-',
        branch_id: p.branch_id,
        quota: Number(p.quota) || 0,
        used_quota: Number(p.used_quota) || 0,
        available_quota: Number(p.quota) - Number(p.used_quota) || 0,
        total_sales: Number(p.total_sales) || 0,
        balance: Number(user.balance) || 0,
        total_revenue: revenue.total_revenue,
        total_product_price: revenue.total_product_price,
        quota_ratio: Math.round(quotaRatio * 100) / 100,
        is_warning: isWarning,
      };
    });

    // 4. 各网点信息
    const branchIds = Object.keys(branchMap);
    const { data: branchUsers } = await client
      .from('users')
      .select('id, username, real_name, phone, unique_id, balance')
      .in('id', branchIds)
      .eq('role', 'branch');

    const branchStats = branchIds.map((bid: string) => {
      const bData = branchMap[bid];
      const bUser = (branchUsers || []).find((u: any) => u.id === bid) || {} as any;
      // 该网点下的服务商
      const branchProviders = providerStats.filter((p: any) => p.branch_id === bid);
      const branchTotalRevenue = branchProviders.reduce((s: number, p: any) => s + p.total_revenue, 0);

      return {
        id: bid,
        username: bUser.username || '-',
        real_name: bUser.real_name || '-',
        phone: bUser.phone || '-',
        balance: Number(bUser.balance) || 0,
        quota: bData.quota,
        used: bData.used,
        available: bData.quota - bData.used,
        provider_count: branchProviders.length,
        total_revenue: branchTotalRevenue,
        providers: branchProviders,
      };
    });

    // 5. 预警列表
    const warningList = providerStats.filter((p: any) => p.is_warning);

    return NextResponse.json({
      success: true,
      data: {
        company: {
          total_quota: totalQuota,
          used_quota: usedQuota,
          available_quota: availableQuota,
        },
        branches: branchStats,
        providers: providerStats,
        warnings: warningList,
        summary: {
          total_providers: providerStats.length,
          total_branches: branchStats.length,
          warning_count: warningList.length,
          total_revenue: providerStats.reduce((s: number, p: any) => s + p.total_revenue, 0),
          total_allocated: providerStats.reduce((s: number, p: any) => s + p.quota, 0),
        }
      }
    });
  } catch (error: any) {
    console.error('[financial-report] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
