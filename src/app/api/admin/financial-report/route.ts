import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

export async function GET(request: NextRequest) {
  try {
    // 1. 公司总额度
    const companyQuota = await queryOne<{
      total_quota: string; used_quota: string; available_quota: string;
    }>(`SELECT total_quota::text, used_quota::text, available_quota::text FROM company_quota LIMIT 1`);

    const totalQuota = parseFloat(companyQuota?.total_quota || '100000000');
    const usedQuota = parseFloat(companyQuota?.used_quota || '0');
    const availableQuota = parseFloat(companyQuota?.available_quota || String(totalQuota - usedQuota));

    // 2. 各服务网点额度分配
    const allocations = await query<{
      branch_id: string; quota_amount: string; used_amount: string; provider_id: string;
    }>(`SELECT branch_id, quota_amount::text, used_amount::text, provider_id FROM quota_allocations`);

    const branchMap: Record<string, { quota: number; used: number; providers: string[] }> = {};
    (allocations || []).forEach((a: any) => {
      if (!branchMap[a.branch_id]) {
        branchMap[a.branch_id] = { quota: 0, used: 0, providers: [] };
      }
      branchMap[a.branch_id].quota += Number(a.quota_amount) || 0;
      branchMap[a.branch_id].used += Number(a.used_amount) || 0;
      if (a.provider_id) branchMap[a.branch_id].providers.push(a.provider_id);
    });

    // 3. 各服务商额度与收益
    const providers = await query<{
      id: string; user_id: string; quota: string; used_quota: string; total_sales: string; branch_id: string;
    }>(`SELECT id, user_id, quota::text, used_quota::text, total_sales::text, branch_id FROM providers`);

    // 服务商用户信息
    const providerUserIds = (providers || []).map((p: any) => `'${p.user_id}'`).join("','");
    const providerUsers = providerUserIds ? await query<{
      id: string; username: string; real_name: string; phone: string; unique_id: string; balance: string; energy_value: string;
    }>(`SELECT id, username, real_name, phone, unique_id, balance::text, energy_value::text FROM users WHERE id IN (${providerUserIds})`) : [];

    const userMap: Record<string, any> = {};
    (providerUsers || []).forEach((u: any) => { userMap[u.id] = u; });

    // 从 provider_revenue_distribution 按服务商聚合收益
    const revenueByProvider = await query<{
      provider_id: string; total_provider_share: string; total_company_share: string; total_branch_share: string; total_direct_reward: string; total_upstream_share: string; total_market_fee: string; total_product_price: string;
    }>(`
      SELECT 
        provider_id,
        COALESCE(SUM(provider_share), 0)::text as total_provider_share,
        COALESCE(SUM(company_share), 0)::text as total_company_share,
        COALESCE(SUM(branch_share), 0)::text as total_branch_share,
        COALESCE(SUM(direct_reward), 0)::text as total_direct_reward,
        COALESCE(SUM(parent_provider_share), 0)::text as total_upstream_share,
        COALESCE(SUM(market_fee), 0)::text as total_market_fee,
        COALESCE(SUM(product_price), 0)::text as total_product_price
      FROM provider_revenue_distribution
      GROUP BY provider_id
    `);

    const providerRevenueMap: Record<string, { provider_share: number; company_share: number; branch_share: number; direct_reward: number; upstream_share: number; market_fee: number; total_product_price: number }> = {};
    (revenueByProvider || []).forEach((r: any) => {
      providerRevenueMap[r.provider_id] = {
        provider_share: parseFloat(r.total_provider_share) || 0,
        company_share: parseFloat(r.total_company_share) || 0,
        branch_share: parseFloat(r.total_branch_share) || 0,
        direct_reward: parseFloat(r.total_direct_reward) || 0,
        upstream_share: parseFloat(r.total_upstream_share) || 0,
        market_fee: parseFloat(r.total_market_fee) || 0,
        total_product_price: parseFloat(r.total_product_price) || 0,
      };
    });

    // 按网点聚合收益（各角色分成）
    const revenueByBranch = await query<{
      branch_id: string; total_branch_share: string; total_company_share: string; total_provider_share: string; total_direct_reward: string; total_upstream_share: string; total_market_fee: string;
    }>(`
      SELECT 
        branch_id,
        COALESCE(SUM(branch_share), 0)::text as total_branch_share,
        COALESCE(SUM(company_share), 0)::text as total_company_share,
        COALESCE(SUM(provider_share), 0)::text as total_provider_share,
        COALESCE(SUM(direct_reward), 0)::text as total_direct_reward,
        COALESCE(SUM(parent_provider_share), 0)::text as total_upstream_share,
        COALESCE(SUM(market_fee), 0)::text as total_market_fee
      FROM provider_revenue_distribution
      WHERE branch_id IS NOT NULL
      GROUP BY branch_id
    `);

    const branchRevenueMap: Record<string, { branch_share: number; company_share: number; provider_share: number; direct_reward: number; upstream_share: number; market_fee: number }> = {};
    (revenueByBranch || []).forEach((r: any) => {
      branchRevenueMap[r.branch_id] = {
        branch_share: parseFloat(r.total_branch_share) || 0,
        company_share: parseFloat(r.total_company_share) || 0,
        provider_share: parseFloat(r.total_provider_share) || 0,
        direct_reward: parseFloat(r.total_direct_reward) || 0,
        upstream_share: parseFloat(r.total_upstream_share) || 0,
        market_fee: parseFloat(r.total_market_fee) || 0,
      };
    });

    // 构建服务商列表（含预警）
    const providerStats = (providers || []).map((p: any) => {
      const user = userMap[p.user_id] || {};
      const revenue = providerRevenueMap[p.user_id] || { provider_share: 0, company_share: 0, branch_share: 0, direct_reward: 0, upstream_share: 0, market_fee: 0, total_product_price: 0 };
      // 体系收益 = 该服务商下所有释放收益叠加（market_fee总额）
      const totalRevenue = revenue.market_fee;
      const quotaNum = Number(p.quota) || 0;
      const quotaRatio = quotaNum > 0 ? (totalRevenue / quotaNum) * 100 : 0;
      const isWarning = quotaRatio > 30;

      return {
        id: p.id,
        user_id: p.user_id,
        username: user.username || '-',
        real_name: user.real_name || '-',
        phone: user.phone || '-',
        unique_id: user.unique_id || '-',
        branch_id: p.branch_id,
        quota: quotaNum,
        used_quota: Number(p.used_quota) || 0,
        available_quota: quotaNum - Number(p.used_quota) || 0,
        total_sales: Number(p.total_sales) || 0,
        balance: Number(user.balance) || 0,
        energy_value: Number(user.energy_value) || 0,
        // 体系收益 = 总释放收益叠加
        total_revenue: totalRevenue,
        total_product_price: revenue.total_product_price,
        // 各角色收益明细
        revenue_breakdown: {
          provider_share: revenue.provider_share,
          company_share: revenue.company_share,
          branch_share: revenue.branch_share,
          direct_reward: revenue.direct_reward,
          upstream_share: revenue.upstream_share,
          market_fee: revenue.market_fee,
        },
        quota_ratio: Math.round(quotaRatio * 100) / 100,
        is_warning: isWarning,
      };
    });

    // 4. 各网点信息
    const branchIds = Object.keys(branchMap);
    const branchUserIds = branchIds.map(id => `'${id}'`).join("','");
    const branchUsers = branchUserIds ? await query<{
      id: string; username: string; real_name: string; phone: string; unique_id: string; balance: string; energy_value: string;
    }>(`SELECT id, username, real_name, phone, unique_id, balance::text, energy_value::text FROM users WHERE id IN (${branchUserIds}) AND role = 'branch'`) : [];

    const branchStats = branchIds.map((bid: string) => {
      const bData = branchMap[bid];
      const bUser = (branchUsers || []).find((u: any) => u.id === bid) || {} as any;
      // 该网点下的服务商
      const branchProviders = providerStats.filter((p: any) => p.branch_id === bid);
      const bRevenue = branchRevenueMap[bid] || { branch_share: 0, company_share: 0, provider_share: 0, direct_reward: 0, upstream_share: 0, market_fee: 0 };
      // 体系收益 = 该网点下所有释放收益叠加（market_fee总额）
      const totalRevenue = bRevenue.market_fee;

      return {
        id: bid,
        username: bUser.username || '-',
        real_name: bUser.real_name || '-',
        phone: bUser.phone || '-',
        balance: Number(bUser.balance) || 0,
        energy_value: Number(bUser.energy_value) || 0,
        quota: bData.quota,
        used: bData.used,
        available: bData.quota - bData.used,
        provider_count: branchProviders.length,
        total_revenue: totalRevenue,
        // 各角色收益明细
        revenue_breakdown: {
          provider_share: bRevenue.provider_share,
          company_share: bRevenue.company_share,
          branch_share: bRevenue.branch_share,
          direct_reward: bRevenue.direct_reward,
          upstream_share: bRevenue.upstream_share,
          market_fee: bRevenue.market_fee,
        },
        providers: branchProviders,
      };
    });

    // 5. 预警列表
    const warningList = providerStats.filter((p: any) => p.is_warning);

    // 6. 全局收益汇总（各角色分成）
    const globalRevenue = await queryOne<{
      total_market_fee: string; total_provider_share: string; total_company_share: string;
      total_branch_share: string; total_direct_reward: string; total_upstream_share: string;
    }>(`
      SELECT 
        COALESCE(SUM(market_fee), 0)::text as total_market_fee,
        COALESCE(SUM(provider_share), 0)::text as total_provider_share,
        COALESCE(SUM(company_share), 0)::text as total_company_share,
        COALESCE(SUM(branch_share), 0)::text as total_branch_share,
        COALESCE(SUM(direct_reward), 0)::text as total_direct_reward,
        COALESCE(SUM(parent_provider_share), 0)::text as total_upstream_share
      FROM provider_revenue_distribution
    `);

    // 体系总收益 = 所有释放收益叠加（market_fee总额）
    const totalSystemRevenue = parseFloat(globalRevenue?.total_market_fee || '0');

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
          // 体系总收益 = 总释放收益叠加
          total_revenue: totalSystemRevenue,
          total_allocated: providerStats.reduce((s: number, p: any) => s + p.quota, 0),
          // 各角色全局收益
          revenue_breakdown: {
            provider_share: parseFloat(globalRevenue?.total_provider_share || '0'),
            company_share: parseFloat(globalRevenue?.total_company_share || '0'),
            branch_share: parseFloat(globalRevenue?.total_branch_share || '0'),
            direct_reward: parseFloat(globalRevenue?.total_direct_reward || '0'),
            upstream_share: parseFloat(globalRevenue?.total_upstream_share || '0'),
            market_fee: totalSystemRevenue,
          }
        }
      }
    });
  } catch (error: any) {
    console.error('[financial-report] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
