import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 获取全系统收益统计（智算中心使用）
export async function GET(request: NextRequest) {
  try {
    // 鉴权：仅管理员可操作
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['admin'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    // 1. 总收益统计（来自 provider_revenue_distribution 表）
    const totalStatsSql = `
      SELECT 
        COUNT(*)::int as total_orders,
        COALESCE(SUM(provider_share::float), 0) as provider_total,
        COALESCE(SUM(direct_reward::float), 0) as direct_reward_total,
        COALESCE(SUM(parent_provider_share::float), 0) as parent_provider_total,
        COALESCE(SUM(branch_share::float), 0) as branch_total,
        COALESCE(SUM(company_share::float), 0) as company_total
      FROM provider_revenue_distribution
    `;
    const totalStats: any = await query(totalStatsSql);

    // 2. 今日收益统计
    const today = new Date().toISOString().split('T')[0];
    const todayStatsSql = `
      SELECT 
        COUNT(*)::int as today_orders,
        COALESCE(SUM(provider_share::float), 0) as provider_today,
        COALESCE(SUM(branch_share::float), 0) as branch_today,
        COALESCE(SUM(company_share::float), 0) as company_today
      FROM provider_revenue_distribution
      WHERE DATE(created_at) = $1
    `;
    const todayStats: any = await query(todayStatsSql, [today]);

    // 3. 各服务商收益排行
    const providerRankingSql = `
      SELECT 
        u.id::text,
        u.username,
        u.phone,
        COALESCE(SUM(prd.provider_share::float), 0) as total_revenue,
        COUNT(*)::int as order_count
      FROM provider_revenue_distribution prd
      LEFT JOIN users u ON u.id::text = prd.provider_id::text
      GROUP BY u.id, u.username, u.phone
      ORDER BY total_revenue DESC
      LIMIT 10
    `;
    const providerRanking: any = await query(providerRankingSql);

    // 4. 服务网点收益统计
    const branchStatsSql = `
      SELECT 
        u.id::text,
        u.username,
        COALESCE(SUM(prd.branch_share::float), 0) as total_revenue,
        COUNT(*)::int as order_count
      FROM provider_revenue_distribution prd
      LEFT JOIN users u ON u.id::text = prd.branch_id::text
      WHERE prd.branch_id IS NOT NULL
      GROUP BY u.id, u.username
      ORDER BY total_revenue DESC
    `;
    const branchStats: any = await query(branchStatsSql);

    // 5. 收益趋势（最近7天）
    const trendSql = `
      SELECT 
        DATE(created_at) as date,
        COUNT(*)::int as orders,
        COALESCE(SUM(provider_share::float), 0) as provider_revenue,
        COALESCE(SUM(branch_share::float), 0) as branch_revenue,
        COALESCE(SUM(company_share::float), 0) as company_revenue
      FROM provider_revenue_distribution
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `;
    const trend: any = await query(trendSql);

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalOrders: totalStats[0]?.total_orders || 0,
          providerTotal: totalStats[0]?.provider_total || 0,
          directRewardTotal: totalStats[0]?.direct_reward_total || 0,
          parentProviderTotal: totalStats[0]?.parent_provider_total || 0,
          branchTotal: totalStats[0]?.branch_total || 0,
          companyTotal: totalStats[0]?.company_total || 0,
        },
        today: {
          orders: todayStats[0]?.today_orders || 0,
          providerRevenue: todayStats[0]?.provider_today || 0,
          branchRevenue: todayStats[0]?.branch_today || 0,
          companyRevenue: todayStats[0]?.company_today || 0,
        },
        providerRanking,
        branchStats,
        trend,
      }
    });
  } catch (error) {
    console.error('获取收益统计失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取收益统计失败' },
      { status: 500 }
    );
  }
}
