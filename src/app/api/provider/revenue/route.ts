import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 获取服务商的收益记录
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    let providerId = searchParams.get('providerId');

    // 如果没有providerId参数，尝试从Authorization header获取
    if (!providerId) {
      const authUser = authenticateRequest(request);
      if (authUser) {
        providerId = authUser.userId;
      }
    }

    if (!providerId) {
      return NextResponse.json({ error: '缺少 providerId 参数' }, { status: 400 });
    }

    const providerRecord: any = await query(
      'SELECT * FROM providers WHERE user_id::text = $1',
      [providerId]
    );

    if (!providerRecord || providerRecord.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          records: [],
          stats: {
            totalRevenue: 0,
            selfRevenue: 0,
            directRevenue: 0,
            parentRevenue: 0,
            subordinateSplitRevenue: 0,
            orderCount: 0,
          }
        }
      });
    }

    const providerUserId = providerRecord[0].user_id;

    // 查询收益记录列表
    const recordsSql = `
      SELECT 
        prd.id::text,
        prd.order_id::text,
        prd.product_id::text,
        prd.provider_id,
        prd.member_id::text,
        prd.market_fee::float,
        prd.provider_share::float,
        prd.direct_reward::float,
        prd.parent_provider_share::float,
        prd.branch_share::float,
        prd.company_share::float,
        prd.status,
        prd.created_at,
        p.name as product_name,
        p.code as product_code,
        p.period,
        p.price::float,
        m.username as member_name,
        m.phone as member_phone
      FROM provider_revenue_distribution prd
      LEFT JOIN products p ON p.id::text = prd.product_id::text
      LEFT JOIN users m ON m.id::text = prd.member_id::text
      WHERE prd.provider_id::text = $1
      ORDER BY prd.created_at DESC
      LIMIT 50
    `;
    const records = await query(recordsSql, [providerUserId]);

    // 统计总数
    const totalCountSql = `SELECT COUNT(*) as total FROM provider_revenue_distribution WHERE provider_id::text = $1`;
    const totalCountResult: any = await query(totalCountSql, [providerUserId]);
    const totalCount = parseInt(totalCountResult?.[0]?.total || '0');

    // 统计各类收益
    // 1. 自己的收益分成 (70%)
    const selfRevenueSql = `
      SELECT COALESCE(SUM(provider_share::float), 0) as total
      FROM provider_revenue_distribution
      WHERE provider_id::text = $1
    `;
    const selfRevenueResult: any = await query(selfRevenueSql, [providerUserId]);
    const selfRevenue = parseFloat(String(selfRevenueResult?.[0]?.total || '0'));

    // 2. 直推奖励 (10%)
    const directRewardSql = `
      SELECT COALESCE(SUM(direct_reward::float), 0) as total
      FROM provider_revenue_distribution
      WHERE direct_reward_to::text = $1
    `;
    const directRewardResult: any = await query(directRewardSql, [providerUserId]);
    const directRevenue = parseFloat(String(directRewardResult?.[0]?.total || '0'));

    // 3. 下级服务商分成 (10%)
    const parentRevenueSql = `
      SELECT COALESCE(SUM(parent_provider_share::float), 0) as total
      FROM provider_revenue_distribution
      WHERE parent_provider_id::text = $1
    `;
    const parentRevenueResult: any = await query(parentRevenueSql, [providerUserId]);
    const parentRevenue = parseFloat(String(parentRevenueResult?.[0]?.total || '0'));

    // 4. 下级分成（0.3%/0.5% 基于交易额）
    const subordinateSplitSql = `
      SELECT COALESCE(SUM(split_amount::float), 0) as total
      FROM provider_subordinate_split
      WHERE upper_provider_id::text = $1
    `;
    const subordinateSplitResult: any = await query(subordinateSplitSql, [providerUserId]);
    const subordinateSplitRevenue = parseFloat(String(subordinateSplitResult?.[0]?.total || '0'));

    // 5. 下级分成记录
    const subordinateRecordsSql = `
      SELECT 
        pss.id::text,
        pss.order_id::text,
        pss.provider_id::text,
        pss.upper_provider_id,
        pss.product_name,
        pss.order_amount::float,
        pss.split_ratio::float,
        pss.split_amount::float,
        pss.subordinate_count,
        pss.created_at,
        u.username as provider_name
      FROM provider_subordinate_split pss
      LEFT JOIN users u ON u.id = pss.provider_id
      WHERE pss.upper_provider_id::text = $1
      ORDER BY pss.created_at DESC
      LIMIT 10
    `;
    const subordinateRecords = await query(subordinateRecordsSql, [providerUserId]);

    // 总收益
    const totalRevenue = selfRevenue + directRevenue + parentRevenue + subordinateSplitRevenue;

    return NextResponse.json({
      success: true,
      data: {
        records,
        stats: {
          totalRevenue,
          selfRevenue,
          directRevenue,
          parentRevenue,
          subordinateSplitRevenue,
          orderCount: totalCount,
        },
        subordinateRecords,
      }
    });
  } catch (error) {
    console.error('获取服务商收益记录失败:', error);
    return NextResponse.json({
      success: true,
      data: {
        records: [],
        stats: {
          totalRevenue: 0,
          selfRevenue: 0,
          directRevenue: 0,
          parentRevenue: 0,
          subordinateSplitRevenue: 0,
          orderCount: 0,
        },
        subordinateRecords: [],
      }
    });
  }
}
