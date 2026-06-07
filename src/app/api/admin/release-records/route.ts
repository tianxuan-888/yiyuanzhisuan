import { NextResponse } from 'next/server';
import { query } from '@/lib/supabase-client';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');

    let dateFilter = '';
    if (startDate && endDate) {
      dateFilter = `AND up.created_at >= '${startDate}' AND up.created_at <= '${endDate} 23:59:59'`;
    }

    // 直接从 user_products (revenue_distributed=true) + products 计算所有数据
    // 释放总金额 = 产品价格 × total_rate (5%)
    // 分配比例: 会员 profit_rate(2%) / 服务商2% / 直推0.25% / 上级0.25% / 网点0.1% / 公司0.4%
    const statsResult = await query(`
      SELECT 
        COUNT(*) as total_count,
        COALESCE(SUM(up.purchase_price), 0) as total_product_price,
        COALESCE(SUM(up.purchase_price * p.total_rate / 100), 0) as total_release,
        COALESCE(SUM(up.purchase_price * p.profit_rate / 100), 0) as total_member_share,
        COALESCE(SUM(up.purchase_price * 2.0 / 100), 0) as total_provider_share,
        COALESCE(SUM(up.purchase_price * 0.25 / 100), 0) as total_direct_share,
        COALESCE(SUM(up.purchase_price * 0.25 / 100), 0) as total_parent_provider_share,
        COALESCE(SUM(up.purchase_price * 0.1 / 100), 0) as total_branch_share,
        COALESCE(SUM(up.purchase_price * 0.4 / 100), 0) as total_company_share
      FROM user_products up
      JOIN products p ON p.id = up.product_id
      WHERE up.revenue_distributed = true ${dateFilter}
    `);

    const rawStats = statsResult?.[0] || {};
    const stats = {
      total_count: rawStats.total_count || 0,
      total_product_price: parseFloat(String(rawStats.total_product_price || 0)),
      total_release: parseFloat(String(rawStats.total_release || 0)),
      total_member_share: parseFloat(String(rawStats.total_member_share || 0)),
      total_provider_share: parseFloat(String(rawStats.total_provider_share || 0)),
      total_direct_share: parseFloat(String(rawStats.total_direct_share || 0)),
      total_parent_provider_share: parseFloat(String(rawStats.total_parent_provider_share || 0)),
      total_branch_share: parseFloat(String(rawStats.total_branch_share || 0)),
      total_company_share: parseFloat(String(rawStats.total_company_share || 0)),
    };

    const offset = (page - 1) * pageSize;

    // 记录列表
    const records = await query(`
      SELECT 
        up.id,
        up.user_id,
        up.product_id,
        up.purchase_price as product_price,
        p.total_rate,
        p.profit_rate,
        p.market_rate,
        p.period,
        p.name as product_name,
        up.created_at,
        m.username as member_name,
        m.unique_id as member_unique_id,
        pv.username as provider_name
      FROM user_products up
      JOIN products p ON p.id = up.product_id
      LEFT JOIN users m ON m.id = up.user_id
      LEFT JOIN users pv ON pv.id = p.provider_id
      WHERE up.revenue_distributed = true ${dateFilter}
      ORDER BY up.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    const enrichedRecords = (records || []).map((r: Record<string, unknown>) => {
      const price = parseFloat(String(r.product_price || 0));
      return {
        id: r.id,
        product_id: r.product_id,
        product_name: r.product_name,
        product_price: price,
        total_rate: parseFloat(String(r.total_rate || 5)),
        profit_rate: parseFloat(String(r.profit_rate || 2)),
        market_rate: parseFloat(String(r.market_rate || 3)),
        period: r.period,
        release_amount: price * parseFloat(String(r.total_rate || 5)) / 100,
        member_share: price * parseFloat(String(r.profit_rate || 2)) / 100,
        provider_share: price * 2.0 / 100,
        direct_referral_share: price * 0.25 / 100,
        parent_provider_share: price * 0.25 / 100,
        branch_share: price * 0.1 / 100,
        company_share: price * 0.4 / 100,
        member_name: r.member_name,
        member_unique_id: r.member_unique_id,
        provider_name: r.provider_name,
        created_at: r.created_at,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        stats,
        records: enrichedRecords,
        pagination: {
          page,
          pageSize,
          total: parseInt(String(stats.total_count || 0)),
        },
      },
    });
  } catch (error) {
    console.error('获取释放收益记录失败:', error);
    return NextResponse.json({ error: '获取释放收益记录失败' }, { status: 500 });
  }
}
