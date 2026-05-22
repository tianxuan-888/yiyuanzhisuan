import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';

export async function GET(request: NextRequest) {
  try {
    const client = getSupabase();

    // 1. 用户统计
    const { data: users } = await client
      .from('users')
      .select('id, role, balance, points, created_at, is_active, provider_id, branch_id');
    const allUsers = users || [];

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const totalUsers = allUsers.length;
    const totalBranches = allUsers.filter((u: any) => u.role === 'branch').length;
    const totalProviders = allUsers.filter((u: any) => u.role === 'provider').length;
    const totalMembers = allUsers.filter((u: any) => u.role === 'member').length;

    // 今日新注册
    const todayNewUsers = allUsers.filter((u: any) => u.created_at >= todayStart).length;
    const sevenDayNewUsers = allUsers.filter((u: any) => u.created_at >= sevenDaysAgo).length;

    // 7天注册趋势
    const registrationTrend: Array<{ date: string; count: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const dayStr = dayStart.toISOString().split('T')[0];
      const count = allUsers.filter((u: any) => u.created_at >= dayStart.toISOString() && u.created_at < dayEnd.toISOString()).length;
      registrationTrend.push({ date: dayStr, count });
    }

    // 2. 产品/购买统计
    const { data: products } = await client
      .from('products')
      .select('id, price, period, status, created_at, provider_id');
    const allProducts = products || [];

    const { data: userProducts } = await client
      .from('user_products')
      .select('id, user_id, product_id, purchase_price, purchase_date, status, expire_date');
    const allUserProducts = userProducts || [];

    const totalProducts = allProducts.length;
    const availableProducts = allProducts.filter((p: any) => p.status === 'available').length;
    const soldProducts = allProducts.filter((p: any) => p.status === 'sold').length;

    // 总销售金额
    const totalSalesAmount = allUserProducts.reduce((s: number, up: any) => s + (Number(up.purchase_price) || 0), 0);

    // 今日购买
    const todayPurchases = allUserProducts.filter((up: any) => up.purchase_date >= todayStart);
    const todayPurchaseAmount = todayPurchases.reduce((s: number, up: any) => s + (Number(up.purchase_price) || 0), 0);
    const todayPurchaseCount = todayPurchases.length;

    // 7天购买趋势
    const purchaseTrend: Array<{ date: string; count: number; amount: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const dayStr = dayStart.toISOString().split('T')[0];
      const dayPurchases = allUserProducts.filter((up: any) => up.purchase_date >= dayStart.toISOString() && up.purchase_date < dayEnd.toISOString());
      purchaseTrend.push({
        date: dayStr,
        count: dayPurchases.length,
        amount: dayPurchases.reduce((s: number, up: any) => s + (Number(up.purchase_price) || 0), 0),
      });
    }

    // 产品周期分布
    const productsByPeriod = [
      { period: 3, count: allProducts.filter((p: any) => p.period === 3).length, amount: allProducts.filter((p: any) => p.period === 3).reduce((s: number, p: any) => s + (Number(p.price) || 0), 0) },
      { period: 7, count: allProducts.filter((p: any) => p.period === 7).length, amount: allProducts.filter((p: any) => p.period === 7).reduce((s: number, p: any) => s + (Number(p.price) || 0), 0) },
      { period: 15, count: allProducts.filter((p: any) => p.period === 15).length, amount: allProducts.filter((p: any) => p.period === 15).reduce((s: number, p: any) => s + (Number(p.price) || 0), 0) },
      { period: 30, count: allProducts.filter((p: any) => p.period === 30).length, amount: allProducts.filter((p: any) => p.period === 30).reduce((s: number, p: any) => s + (Number(p.price) || 0), 0) },
      { period: 90, count: allProducts.filter((p: any) => p.period === 90).length, amount: allProducts.filter((p: any) => p.period === 90).reduce((s: number, p: any) => s + (Number(p.price) || 0), 0) },
    ].filter(p => p.count > 0);

    // 3. 收益/释放统计
    const { data: releaseRecords } = await client
      .from('release_records')
      .select('id, product_price, release_amount, member_share, provider_share, direct_referral_share, parent_provider_share, senior_provider_share, branch_share, company_share, created_at');
    const allReleaseRecords = releaseRecords || [];

    const totalReleaseAmount = allReleaseRecords.reduce((s: number, r: any) => s + (Number(r.release_amount) || 0), 0);
    const todayReleaseAmount = allReleaseRecords.filter((r: any) => r.created_at >= todayStart).reduce((s: number, r: any) => s + (Number(r.release_amount) || 0), 0);

    // 7天释放趋势
    const releaseTrend: Array<{ date: string; amount: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const dayStr = dayStart.toISOString().split('T')[0];
      const dayReleases = allReleaseRecords.filter((r: any) => r.created_at >= dayStart.toISOString() && r.created_at < dayEnd.toISOString());
      releaseTrend.push({ date: dayStr, amount: dayReleases.reduce((s: number, r: any) => s + (Number(r.release_amount) || 0), 0) });
    }

    // 释放分配统计
    const releaseDistribution = {
      memberShare: allReleaseRecords.reduce((s: number, r: any) => s + (Number(r.member_share) || 0), 0),
      directReferralShare: allReleaseRecords.reduce((s: number, r: any) => s + (Number(r.direct_referral_share) || 0), 0),
      providerShare: allReleaseRecords.reduce((s: number, r: any) => s + (Number(r.provider_share) || 0), 0),
      parentProviderShare: allReleaseRecords.reduce((s: number, r: any) => s + (Number(r.parent_provider_share) || 0), 0),
      seniorProviderShare: allReleaseRecords.reduce((s: number, r: any) => s + (Number(r.senior_provider_share) || 0), 0),
      branchShare: allReleaseRecords.reduce((s: number, r: any) => s + (Number(r.branch_share) || 0), 0),
      companyShare: allReleaseRecords.reduce((s: number, r: any) => s + (Number(r.company_share) || 0), 0),
    };

    // 4. 额度统计
    const { data: companyQuota } = await client
      .from('company_quota')
      .select('total_quota, used_quota, available_quota')
      .limit(1)
      .single();

    const { data: providerRecords } = await client
      .from('providers')
      .select('user_id, quota, used_quota, total_sales, branch_id');

    const totalProviderQuota = (providerRecords || []).reduce((s: number, p: any) => s + (Number(p.quota) || 0), 0);
    const totalProviderUsedQuota = (providerRecords || []).reduce((s: number, p: any) => s + (Number(p.used_quota) || 0), 0);

    // 5. 提现统计
    const { data: withdrawals } = await client
      .from('withdrawals')
      .select('id, user_id, amount, status, created_at');
    const allWithdrawals = withdrawals || [];

    const pendingWithdrawals = allWithdrawals.filter((w: any) => w.status === 'pending');
    const pendingWithdrawAmount = pendingWithdrawals.reduce((s: number, w: any) => s + (Number(w.amount) || 0), 0);
    const approvedWithdrawAmount = allWithdrawals.filter((w: any) => w.status === 'approved').reduce((s: number, w: any) => s + (Number(w.amount) || 0), 0);

    // 6. 团队排名 - 服务商按销售金额排名
    const teamRanking = await Promise.all(
      (providerRecords || []).map(async (p: any) => {
        const { data: providerUser } = await client
          .from('users')
          .select('username, real_name, phone')
          .eq('id', p.user_id)
          .single();

        const { count: memberCount } = await client
          .from('users')
          .select('*', { count: 'exact', head: true })
          .eq('provider_id', p.user_id)
          .eq('role', 'member');

        const { data: pReleaseRecords } = await client
          .from('release_records')
          .select('provider_share')
          .eq('provider_id', p.user_id);

        const totalRevenue = (pReleaseRecords || []).reduce((s: number, r: any) => s + (Number(r.provider_share) || 0), 0);

        // 查询该服务商下的购买量
        const { data: providerProducts } = await client
          .from('products')
          .select('id')
          .eq('provider_id', p.user_id)
          .eq('status', 'sold');
        const soldCount = providerProducts?.length || 0;

        return {
          providerId: p.user_id,
          providerName: providerUser?.username || providerUser?.real_name || '-',
          phone: providerUser?.phone || '-',
          quota: Number(p.quota) || 0,
          usedQuota: Number(p.used_quota) || 0,
          totalSales: Number(p.total_sales) || 0,
          totalRevenue,
          memberCount: memberCount || 0,
          soldCount,
        };
      })
    );

    // 按销售金额排序
    teamRanking.sort((a, b) => b.totalRevenue - a.totalRevenue);

    // 7. 网点排名
    const branchRanking = await Promise.all(
      allUsers.filter((u: any) => u.role === 'branch').map(async (branch: any) => {
        const branchProviders = (providerRecords || []).filter((p: any) => p.branch_id === branch.id);
        const providerCount = branchProviders.length;

        let branchRevenue = 0;
        let branchSales = 0;
        for (const bp of branchProviders) {
          const { data: bReleaseRecords } = await client
            .from('release_records')
            .select('branch_share')
            .eq('branch_id', branch.id);
          branchRevenue = (bReleaseRecords || []).reduce((s: number, r: any) => s + (Number(r.branch_share) || 0), 0);
          branchSales += Number(bp.total_sales) || 0;
        }

        const memberCount = allUsers.filter((u: any) => {
          const uProvider = (providerRecords || []).find((p: any) => p.user_id === u.provider_id);
          return u.role === 'member' && uProvider?.branch_id === branch.id;
        }).length;

        return {
          branchId: branch.id,
          branchName: branch.username || branch.real_name || '-',
          phone: branch.phone || '-',
          providerCount,
          memberCount,
          totalSales: branchSales,
          totalRevenue: branchRevenue,
          balance: Number(branch.balance) || 0,
        };
      })
    );

    branchRanking.sort((a, b) => b.totalRevenue - a.totalRevenue);

    // 8. 平台总流通
    const totalBalance = allUsers.reduce((s: number, u: any) => s + (Number(u.balance) || 0), 0);
    const totalPoints = allUsers.reduce((s: number, u: any) => s + (Number(u.points) || 0), 0);

    return NextResponse.json({
      success: true,
      data: {
        // 用户统计
        users: {
          total: totalUsers,
          branches: totalBranches,
          providers: totalProviders,
          members: totalMembers,
          todayNew: todayNewUsers,
          sevenDayNew: sevenDayNewUsers,
          registrationTrend,
        },
        // 产品/购买统计
        products: {
          total: totalProducts,
          available: availableProducts,
          sold: soldProducts,
          totalSalesAmount,
          todayPurchaseCount,
          todayPurchaseAmount,
          purchaseTrend,
          productsByPeriod,
        },
        // 收益释放统计
        revenue: {
          totalReleaseAmount,
          todayReleaseAmount,
          releaseTrend,
          releaseDistribution,
        },
        // 额度统计
        quota: {
          companyQuota: companyQuota || { total_quota: 0, used_quota: 0, available_quota: 0 },
          totalProviderQuota,
          totalProviderUsedQuota,
        },
        // 提现统计
        withdrawals: {
          pendingCount: pendingWithdrawals.length,
          pendingAmount: pendingWithdrawAmount,
          approvedAmount: approvedWithdrawAmount,
        },
        // 平台流通
        circulation: {
          totalBalance,
          totalPoints,
        },
        // 团队排名
        teamRanking,
        branchRanking,
      },
    });
  } catch (error: any) {
    console.error('[dashboard] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
