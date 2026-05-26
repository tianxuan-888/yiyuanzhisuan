import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth';
import { getSupabaseUrl, getSupabaseServiceRoleKey } from '@/lib/env';

function getAdminSupabase() {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    throw new Error('Missing Supabase configuration');
  }
  return createClient(url, key);
}

/**
 * 获取会员收益明细流水
 * 包含：收益入账、转收益、提现
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: '用户ID不能为空' }, { status: 400 });
    }

    const client = getAdminSupabase();

    // 使用 rpc_query 查询收益明细
    const { data: detailRecords } = await client
      .rpc('rpc_query', {
        sql_query: `
          SELECT rd.*, mr.principal as revenue_principal, mr.profit as revenue_profit,
            p.name as product_name, p.period as product_period
          FROM revenue_details rd
          LEFT JOIN member_revenue mr ON rd.revenue_id = mr.id
          LEFT JOIN user_products up ON mr.user_product_id = up.id
          LEFT JOIN products p ON up.product_id = p.id
          WHERE rd.user_id = '${userId}'
          ORDER BY rd.created_at DESC
          LIMIT 100
        `
      });

    const formattedDetails = (detailRecords || []).map((detail: any) => ({
      id: detail.id,
      user_id: detail.user_id,
      revenue_id: detail.revenue_id,
      type: detail.type,
      amount: parseFloat(detail.amount || 0),
      description: detail.description,
      product_name: detail.product_name || null,
      product_period: detail.product_period || null,
      created_at: detail.created_at,
    }));

    // 统计
    const { data: statsData } = await client
      .rpc('rpc_query', {
        sql_query: `
          SELECT 
            COALESCE(SUM(amount) FILTER (WHERE type = 'principal_return'), 0) as total_principal_in,
            COALESCE(SUM(amount) FILTER (WHERE type = 'profit_in'), 0) as total_profit_in,
            COALESCE(SUM(amount) FILTER (WHERE type = 'convert_to_energy'), 0) as total_convert,
            COALESCE(SUM(amount) FILTER (WHERE type = 'withdraw'), 0) as total_withdraw
          FROM revenue_details
          WHERE user_id = '${userId}'
        `
      });

    const statsRow = (statsData || [])[0] || {};

    return NextResponse.json({
      success: true,
      data: {
        records: formattedDetails,
        stats: {
          totalPrincipal: parseFloat(statsRow.total_principal_in || 0),
          totalProfit: parseFloat(statsRow.total_profit_in || 0),
          totalConvert: parseFloat(statsRow.total_convert || 0),
          totalWithdraw: parseFloat(statsRow.total_withdraw || 0),
        }
      }
    });
  } catch (error) {
    console.error('获取收益明细失败:', error);
    return NextResponse.json({
      success: true,
      data: {
        records: [],
        stats: { totalPrincipal: 0, totalProfit: 0, totalConvert: 0, totalWithdraw: 0 }
      }
    });
  }
}
