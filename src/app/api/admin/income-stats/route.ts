import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseAnonKey } from '@/lib/env';

// 总公司收益管理 - 使用用户自己的 Supabase 数据库
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const subType = url.searchParams.get('subType') || 'overview';

    const supabaseUrl = getSupabaseUrl();
    const supabaseAnonKey = getSupabaseAnonKey();
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Supabase 环境变量未配置' }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
  // 1. 从 user_products 统计市场费和销售
  const { data: userProducts } = await supabase
    .from('user_products')
    .select('market_fee, purchase_price, purchase_date, status')
    .in('status', ['holding', 'sold']);

  const allProducts = userProducts || [];
  const totalMarketFee = allProducts.reduce((sum: number, p: any) => sum + (parseFloat(p.market_fee) || 0), 0);
  const totalSales = allProducts.reduce((sum: number, p: any) => sum + (parseFloat(p.purchase_price) || 0), 0);
  const totalOrders = allProducts.length;

  // 今日数据
  const today = new Date().toISOString().split('T')[0];
  const todayProducts = allProducts.filter((p: any) => p.purchase_date?.startsWith(today));
  const todayMarketFee = todayProducts.reduce((sum: number, p: any) => sum + (parseFloat(p.market_fee) || 0), 0);
  const todaySales = todayProducts.reduce((sum: number, p: any) => sum + (parseFloat(p.purchase_price) || 0), 0);
  const todayOrders = todayProducts.length;

  // 2. 按分配比例计算各方收益
  const providerShare = Math.floor(totalMarketFee * 0.70);
  const branchShare = Math.floor(totalMarketFee * 0.05);
  const companyShare = Math.floor(totalMarketFee * 0.05);
  const directRewardShare = Math.floor(totalMarketFee * 0.10);
  const parentProviderShare = Math.floor(totalMarketFee * 0.10);

  // 3. 从 energy_transactions 获取各角色能量值
  const { data: energyTxns } = await supabase
    .from('energy_transactions')
    .select('user_id, amount, users:user_id(role)')
    .eq('status', 'completed');

  const energyByRole: Record<string, number> = {};
  (energyTxns || []).forEach((t: any) => {
    const role = t.users?.role || 'unknown';
    energyByRole[role] = (energyByRole[role] || 0) + (parseFloat(t.amount) || 0);
  });

  // 4. 收益趋势（最近7天）
  const { data: trendProducts } = await supabase
    .from('user_products')
    .select('purchase_date, purchase_price, market_fee')
    .in('status', ['holding', 'sold'])
    .gte('purchase_date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('purchase_date', { ascending: true });

  // 按日汇总
  const trendMap: Record<string, { orders: number; sales: number; marketFee: number }> = {};
  (trendProducts || []).forEach((p: any) => {
    const date = p.purchase_date?.substring(0, 10) || '';
    if (!trendMap[date]) trendMap[date] = { orders: 0, sales: 0, marketFee: 0 };
    trendMap[date].orders++;
    trendMap[date].sales += parseFloat(p.purchase_price) || 0;
    trendMap[date].marketFee += parseFloat(p.market_fee) || 0;
  });
  const trend = Object.entries(trendMap).map(([date, v]) => ({ date, ...v }));

  // 5. 服务商能量值排行 TOP5
  const { data: providerRankRaw } = await supabase
    .from('energy_transactions')
    .select('user_id, amount, users:user_id(id, username)')
    .eq('status', 'completed')
    .in('type', ['provider_share', 'direct_reward', 'market_share', 'recharge', 'transfer_in', 'quota_match']);

  const providerMap: Record<string, { id: string; username: string; totalEnergy: number; txCount: number }> = {};
  (providerRankRaw || []).forEach((t: any) => {
    if (t.users?.username) {
      const key = t.user_id;
      if (!providerMap[key]) providerMap[key] = { id: t.users.id || t.user_id, username: t.users.username, totalEnergy: 0, txCount: 0 };
      providerMap[key].totalEnergy += parseFloat(t.amount) || 0;
      providerMap[key].txCount++;
    }
  });
  const providerRanking = Object.values(providerMap)
    .sort((a, b) => b.totalEnergy - a.totalEnergy)
    .slice(0, 5);

  // 6. 分公司能量值
  const { data: branchRankRaw } = await supabase
    .from('energy_transactions')
    .select('user_id, amount, users:user_id(id, username)')
    .eq('status', 'completed')
    .in('type', ['branch_share', 'quota_match', 'transfer_in']);

  const branchMap: Record<string, { id: string; username: string; totalEnergy: number }> = {};
  (branchRankRaw || []).forEach((t: any) => {
    if (t.users?.username) {
      const key = t.user_id;
      if (!branchMap[key]) branchMap[key] = { id: t.users.id || t.user_id, username: t.users.username, totalEnergy: 0 };
      branchMap[key].totalEnergy += parseFloat(t.amount) || 0;
    }
  });
  const branchRevenue = Object.values(branchMap).sort((a, b) => b.totalEnergy - a.totalEnergy);

  return NextResponse.json({
    success: true,
    data: {
      summary: {
        totalIncome: totalMarketFee,
        todayIncome: todayMarketFee,
        pendingSettlement: 0,
        distributed: totalMarketFee,
        totalOrders,
        todayOrders,
        totalSales,
        todaySales,
      },
      shareBreakdown: {
        provider: { amount: providerShare, rate: '70%' },
        directReward: { amount: directRewardShare, rate: '10%' },
        parentProvider: { amount: parentProviderShare, rate: '10%' },
        branch: { amount: branchShare, rate: '5%' },
        company: { amount: companyShare, rate: '5%' },
      },
      todayBreakdown: {
        providerShare: Math.floor(todayMarketFee * 0.70),
        companyShare: Math.floor(todayMarketFee * 0.05),
      },
      energyByRole,
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
    records.push({
      id: up.id,
      date: up.purchase_date,
      productName: product?.name || '-',
      productCode: product?.code || '-',
      period: product?.period,
      purchasePrice: parseFloat(up.purchase_price) || 0,
      marketFee,
      marketRate: product?.market_rate,
      buyerName: buyer?.username || '-',
      buyerPhone: buyer?.phone,
      providerName,
      status: up.status,
      shareDetail: {
        provider: Math.floor(marketFee * 0.70),
        directReward: Math.floor(marketFee * 0.10),
        parentProvider: Math.floor(marketFee * 0.10),
        branch: Math.floor(marketFee * 0.05),
        company: Math.floor(marketFee * 0.05),
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
