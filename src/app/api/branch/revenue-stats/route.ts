import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 获取服务网点收益统计
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const branchId = searchParams.get('branchId');

    // 鉴权：仅管理员或服务网点可操作
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['admin', 'branch'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    // 如果是服务网点用户，使用自己的 ID
    const targetBranchId = branchId || authUser.userId;

    if (!targetBranchId) {
      return NextResponse.json({ error: '缺少服务网点ID' }, { status: 400 });
    }

    // 1. 服务网点自己的收益统计（来自 branch_share）
    const branchStatsSql = `
      SELECT 
        COUNT(*)::int as total_orders,
        COALESCE(SUM(provider_share::float), 0) as provider_revenue,
        COALESCE(SUM(branch_share::float), 0) as branch_revenue,
        COALESCE(SUM(company_share::float), 0) as company_revenue
      FROM provider_revenue_distribution
      WHERE branch_id::text = $1
    `;
    const branchStats: any = await query(branchStatsSql, [targetBranchId]);

    // 2. 今日收益
    const today = new Date().toISOString().split('T')[0];
    const todayStatsSql = `
      SELECT 
        COUNT(*)::int as today_orders,
        COALESCE(SUM(provider_share::float), 0) as provider_today,
        COALESCE(SUM(branch_share::float), 0) as branch_today,
        COALESCE(SUM(company_share::float), 0) as company_today
      FROM provider_revenue_distribution
      WHERE branch_id::text = $1 AND DATE(created_at) = $2
    `;
    const todayStats: any = await query(todayStatsSql, [targetBranchId, today]);

    // 3. 下属服务商收益排行
    const providerRankingSql = `
      SELECT 
        u.id::text,
        u.username,
        u.phone,
        p.id as provider_record_id,
        COALESCE(SUM(prd.provider_share::float), 0) as total_revenue,
        COUNT(*)::int as order_count
      FROM provider_revenue_distribution prd
      LEFT JOIN users u ON u.id::text = prd.provider_id::text
      LEFT JOIN providers p ON p.user_id::text = prd.provider_id::text
      WHERE prd.branch_id::text = $1
      GROUP BY u.id, u.username, u.phone, p.id
      ORDER BY total_revenue DESC
      LIMIT 10
    `;
    const providerRanking: any = await query(providerRankingSql, [targetBranchId]);

    // 4. 收益趋势（最近7天）
    const trendSql = `
      SELECT 
        DATE(prd.created_at) as date,
        COUNT(*)::int as orders,
        COALESCE(SUM(prd.provider_share::float), 0) as provider_revenue,
        COALESCE(SUM(prd.branch_share::float), 0) as branch_revenue
      FROM provider_revenue_distribution prd
      WHERE prd.branch_id::text = $1
        AND prd.created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(prd.created_at)
      ORDER BY date ASC
    `;
    const trend: any = await query(trendSql, [targetBranchId]);

    // 5. 收益来源分布（按产品周期）
    const distributionSql = `
      SELECT 
        p.period,
        COUNT(*)::int as order_count,
        COALESCE(SUM(prd.provider_share::float), 0) as total_revenue
      FROM provider_revenue_distribution prd
      LEFT JOIN products p ON p.id::text = prd.product_id::text
      WHERE prd.branch_id::text = $1
      GROUP BY p.period
      ORDER BY p.period ASC
    `;
    const distribution: any = await query(distributionSql, [targetBranchId]);

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalOrders: branchStats[0]?.total_orders || 0,
          providerRevenue: branchStats[0]?.provider_revenue || 0,
          branchRevenue: branchStats[0]?.branch_revenue || 0,
          companyRevenue: branchStats[0]?.company_revenue || 0,
        },
        today: {
          orders: todayStats[0]?.today_orders || 0,
          providerRevenue: todayStats[0]?.provider_today || 0,
          branchRevenue: todayStats[0]?.branch_today || 0,
          companyRevenue: todayStats[0]?.company_today || 0,
        },
        providerRanking,
        trend,
        distribution,
      }
    });
  } catch (error) {
    console.error('获取服务网点收益统计失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取收益统计失败' },
      { status: 500 }
    );
  }
}
