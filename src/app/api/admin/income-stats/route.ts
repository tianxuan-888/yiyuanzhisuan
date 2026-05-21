import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseServiceRoleKey } from '@/lib/env';

// 智算总台收益管理 - 使用用户自己的 Supabase 数据库（service role key 绕过 RLS）
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const subType = url.searchParams.get('subType') || 'overview';

    const supabaseUrl = getSupabaseUrl();
    const supabaseServiceKey = getSupabaseServiceRoleKey();
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase 环境变量未配置' }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (subType === 'overview') {
      return await getIncomeOverview(supabase);
    }

    if (subType === 'detail') {
      const typeFilter = url.searchParams.get('type') || 'all';
      const page = parseInt(url.searchParams.get('page') || '1');
      const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
      return await getIncomeDetail(supabase, typeFilter, page, pageSize);
    }

    if (subType === 'withdraw') {
      return await getWithdrawManagement(supabase);
    }

    return NextResponse.json({ error: '未知的subType' }, { status: 400 });
  } catch (error) {
    console.error('获取收益数据失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取收益数据失败' },
      { status: 500 }
    );
  }
}

async function getIncomeOverview(supabase: any) {
  // 1. 从 provider_revenue_distribution 读取真实分配数据
  const { data: distributions } = await supabase
    .from('provider_revenue_distribution')
    .select('market_fee, provider_share, direct_reward, parent_provider_share, branch_share, company_share, product_price, created_at, status')
    .eq('status', 'completed');

  const allDistributions = distributions || [];

  // 汇总各方真实收益
  let totalMarketFee = 0;
  let totalMemberShare = 0;
  let totalProviderShare = 0;
  let totalDirectReward = 0;
  let totalParentProviderShare = 0;
  let totalSeniorProviderShare = 0;
  let totalBranchShare = 0;
  let totalCompanyShare = 0;
  let totalProductPrice = 0;

  allDistributions.forEach((d: any) => {
    totalMarketFee += parseFloat(d.market_fee) || 0;
    totalMemberShare += parseFloat(d.member_share) || 0;
    totalProviderShare += parseFloat(d.provider_share) || 0;
    totalDirectReward += parseFloat(d.direct_reward) || 0;
    totalParentProviderShare += parseFloat(d.parent_provider_share) || 0;
    totalSeniorProviderShare += parseFloat(d.senior_provider_share) || 0;
    totalBranchShare += parseFloat(d.branch_share) || 0;
    totalCompanyShare += parseFloat(d.company_share) || 0;
    totalProductPrice += parseFloat(d.product_price) || 0;
  });

  // 今日数据
  const today = new Date().toISOString().split('T')[0];
  const todayDistributions = allDistributions.filter((d: any) => d.created_at?.startsWith(today));
  let todayMarketFee = 0;
  let todayProductPrice = 0;
  todayDistributions.forEach((d: any) => {
    todayMarketFee += parseFloat(d.market_fee) || 0;
    todayProductPrice += parseFloat(d.product_price) || 0;
  });

  // 2. 从 orders 表获取订单统计
  const { data: completedOrders } = await supabase
    .from('orders')
    .select('id, amount, status, created_at')
    .eq('status', 'completed');

  const totalOrders = (completedOrders || []).length;
  const todayOrders = (completedOrders || []).filter((o: any) => o.created_at?.startsWith(today)).length;

  // 3. 从 user_products 获取持仓统计（总销售额 = 所有已购买产品的purchase_price之和）
  const { data: userProducts } = await supabase
    .from('user_products')
    .select('market_fee, purchase_price, purchase_date, status')
    .in('status', ['holding', 'sold']);

  const allProducts = userProducts || [];
  const totalSales = allProducts.reduce((sum: number, p: any) => sum + (parseFloat(p.purchase_price) || 0), 0);
  const todayProducts = allProducts.filter((p: any) => p.purchase_date?.startsWith(today));
  const todaySales = todayProducts.reduce((sum: number, p: any) => sum + (parseFloat(p.purchase_price) || 0), 0);

  // 4. 收益趋势（最近7天，从 provider_revenue_distribution 按日汇总）
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const trendMap: Record<string, { orders: number; sales: number; marketFee: number; providerShare: number; branchShare: number }> = {};

  // 初始化最近7天的日期
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().split('T')[0];
    trendMap[dateStr] = { orders: 0, sales: 0, marketFee: 0, providerShare: 0, branchShare: 0 };
  }

  // 从分配记录按日汇总
  const recentDistributions = allDistributions.filter((d: any) => d.created_at >= sevenDaysAgo);
  recentDistributions.forEach((d: any) => {
    const date = d.created_at?.substring(0, 10) || '';
    if (trendMap[date]) {
      trendMap[date].marketFee += parseFloat(d.market_fee) || 0;
      trendMap[date].providerShare += parseFloat(d.provider_share) || 0;
      trendMap[date].branchShare += parseFloat(d.branch_share) || 0;
      trendMap[date].orders++;
      trendMap[date].sales += parseFloat(d.product_price) || 0;
    }
  });

  const trend = Object.entries(trendMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));

  // 5. 服务商收益排行 TOP5（从 provider_revenue_distribution 汇总）
  const { data: providerDistRaw } = await supabase
    .from('provider_revenue_distribution')
    .select('provider_id, provider_share, market_fee')
    .eq('status', 'completed');

  const provRevenueMap: Record<string, { providerId: string; totalRevenue: number; totalMarketFee: number }> = {};
  (providerDistRaw || []).forEach((d: any) => {
    const key = d.provider_id;
    if (!provRevenueMap[key]) provRevenueMap[key] = { providerId: d.provider_id, totalRevenue: 0, totalMarketFee: 0 };
    provRevenueMap[key].totalRevenue += parseFloat(d.provider_share) || 0;
    provRevenueMap[key].totalMarketFee += parseFloat(d.market_fee) || 0;
  });

  // 获取服务商用户名（provider_id 存的是 providers.user_id）
  const providerRanking = [];
  const sortedProviders = Object.values(provRevenueMap).sort((a: any, b: any) => b.totalRevenue - a.totalRevenue).slice(0, 5);
  for (const p of sortedProviders) {
    // 通过 providers.user_id 查找 providers.id，再找 users.username
    const { data: provUser } = await supabase
      .from('users')
      .select('username')
      .eq('id', p.providerId)
      .single();
    const username = provUser?.username || '未知服务商';
    providerRanking.push({
      id: p.providerId,
      username,
      totalRevenue: Math.round(p.totalRevenue * 100) / 100,
      totalMarketFee: Math.round(p.totalMarketFee * 100) / 100,
    });
  }

  // 6. 服务网点收益（从 provider_revenue_distribution 汇总 branch_share）
  const { data: branchDistRaw } = await supabase
    .from('provider_revenue_distribution')
    .select('branch_id, branch_share')
    .eq('status', 'completed');

  const branchRevenueMap: Record<string, { branchId: string; totalRevenue: number }> = {};
  (branchDistRaw || []).forEach((d: any) => {
    const key = d.branch_id;
    if (!key) return;
    if (!branchRevenueMap[key]) branchRevenueMap[key] = { branchId: d.branch_id, totalRevenue: 0 };
    branchRevenueMap[key].totalRevenue += parseFloat(d.branch_share) || 0;
  });

  const branchRevenue = [];
  for (const b of Object.values(branchRevenueMap)) {
    const { data: u } = await supabase.from('users').select('username').eq('id', b.branchId).single();
    branchRevenue.push({
      id: b.branchId,
      username: u?.username || '未知服务网点',
      totalRevenue: Math.round(b.totalRevenue * 100) / 100,
    });
  }
  branchRevenue.sort((a: any, b: any) => b.totalRevenue - a.totalRevenue);

  return NextResponse.json({
    success: true,
    data: {
      summary: {
        totalIncome: Math.round(totalMarketFee * 100) / 100,
        todayIncome: Math.round(todayMarketFee * 100) / 100,
        pendingSettlement: 0,
        distributed: Math.round(totalMarketFee * 100) / 100,
        totalOrders,
        todayOrders,
        totalSales,
        todaySales,
      },
      shareBreakdown: {
        member: { amount: Math.round(totalMemberShare * 100) / 100, rate: '2%' },
        directReward: { amount: Math.round(totalDirectReward * 100) / 100, rate: '0.3%' },
        provider: { amount: Math.round(totalProviderShare * 100) / 100, rate: '2%' },
        parentProvider: { amount: Math.round(totalParentProviderShare * 100) / 100, rate: '0.3%' },
        seniorProvider: { amount: Math.round(totalSeniorProviderShare * 100) / 100, rate: '0.15%' },
        branch: { amount: Math.round(totalBranchShare * 100) / 100, rate: '0.15%' },
        company: { amount: Math.round(totalCompanyShare * 100) / 100, rate: '0.10%' },
      },
      todayBreakdown: {
        providerShare: Math.round(todayDistributions.reduce((s: number, d: any) => s + (parseFloat(d.provider_share) || 0), 0) * 100) / 100,
        companyShare: Math.round(todayDistributions.reduce((s: number, d: any) => s + (parseFloat(d.company_share) || 0), 0) * 100) / 100,
      },
      providerRanking,
      branchRevenue,
      trend,
    }
  });
}

async function getIncomeDetail(supabase: any, typeFilter: string, page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from('user_products')
    .select('id, purchase_date, purchase_price, market_fee, status, user_id, product_id', { count: 'exact' })
    .in('status', ['holding', 'sold'])
    .order('purchase_date', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (typeFilter === 'product' || typeFilter === 'market') {
    query = query.gt('market_fee', 0);
  }

  const { data: products, count } = await query;
  const totalCount = count || 0;

  // 获取关联数据
  const records = [];
  for (const up of (products || [])) {
    // 获取买家信息
    const { data: buyer } = await supabase.from('users').select('username, phone').eq('id', up.user_id).single();

    // 获取产品信息
    const { data: product } = await supabase.from('products').select('name, code, period, market_rate, provider_id').eq('id', up.product_id).single();

    // 获取服务商信息
    let providerName = '-';
    if (product?.provider_id) {
      const { data: prov } = await supabase.from('providers').select('user_id').eq('id', product.provider_id).single();
      if (prov?.user_id) {
        const { data: provUser } = await supabase.from('users').select('username').eq('id', prov.user_id).single();
        providerName = provUser?.username || '-';
      }
    }

    const marketFee = parseFloat(up.market_fee) || 0;
    const purchasePrice = parseFloat(up.purchase_price) || 0;
    records.push({
      id: up.id,
      date: up.purchase_date,
      productName: product?.name || '-',
      productCode: product?.code || '-',
      period: product?.period,
      purchasePrice,
      marketFee,
      marketRate: product?.market_rate,
      buyerName: buyer?.username || '-',
      buyerPhone: buyer?.phone,
      providerName,
      status: up.status,
      shareDetail: {
        member: Math.round(purchasePrice * 0.02 * 100) / 100,
        directReward: Math.round(purchasePrice * 0.003 * 100) / 100,
        provider: Math.round(purchasePrice * 0.02 * 100) / 100,
        parentProvider: Math.round(purchasePrice * 0.003 * 100) / 100,
        seniorProvider: Math.round(purchasePrice * 0.0015 * 100) / 100,
        branch: Math.round(purchasePrice * 0.0015 * 100) / 100,
        company: Math.round(purchasePrice * 0.001 * 100) / 100,
      }
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      records,
      pagination: {
        page,
        pageSize,
        total: totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      }
    }
  });
}

async function getWithdrawManagement(supabase: any) {
  // 1. 提现统计
  const { data: allWithdrawals } = await supabase
    .from('energy_withdraw_requests')
    .select('id, status, amount, actual_amount, fee_amount, reviewed_at');

  const ws = {
    totalRequests: allWithdrawals?.length || 0,
    pendingCount: 0,
    pendingAmount: 0,
    approvedAmount: 0,
    actualPaid: 0,
    todayAmount: 0,
  };

  const today = new Date().toISOString().split('T')[0];
  (allWithdrawals || []).forEach((w: any) => {
    const amount = parseFloat(w.amount) || 0;
    const actual = parseFloat(w.actual_amount) || 0;
    if (w.status === 'pending') {
      ws.pendingCount++;
      ws.pendingAmount += amount;
    } else if (w.status === 'approved') {
      ws.approvedAmount += amount;
      ws.actualPaid += actual;
      if (w.reviewed_at?.startsWith(today)) {
        ws.todayAmount += amount;
      }
    }
  });

  // 2. 提现列表
  const { data: withdrawListRaw } = await supabase
    .from('energy_withdraw_requests')
    .select('id, user_id, amount, actual_amount, fee_amount, status, created_at, reviewed_at, alipay_account')
    .order('created_at', { ascending: false })
    .limit(50);

  // 获取用户信息
  const withdrawList = [];
  for (const w of (withdrawListRaw || [])) {
    const { data: u } = await supabase.from('users').select('username, phone, role').eq('id', w.user_id).single();
    withdrawList.push({
      id: w.id,
      userId: w.user_id,
      username: u?.username || '-',
      phone: u?.phone,
      role: u?.role,
      amount: parseFloat(w.amount) || 0,
      actualAmount: parseFloat(w.actual_amount) || 0,
      fee: parseFloat(w.fee_amount) || 0,
      alipayAccount: w.alipay_account,
      status: w.status,
      createdAt: w.created_at,
      reviewedAt: w.reviewed_at,
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      stats: ws,
      withdrawList,
    }
  });
}
