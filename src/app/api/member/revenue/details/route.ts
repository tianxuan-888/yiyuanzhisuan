import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

// 辅助函数：将PostgreSQL numeric格式转换为数字
function parseNumeric(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const match = val.match(/\{(\d+)\s+(-?\d+)/);
    if (match) {
      return parseFloat(match[1]) * Math.pow(10, parseInt(match[2]));
    }
    return parseFloat(val) || 0;
  }
  return 0;
}

// 获取收益明细列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const type = searchParams.get('type'); // 筛选类型：profit_in, convert_to_energy, withdraw

    if (!userId) {
      return NextResponse.json({ error: '用户ID不能为空' }, { status: 400 });
    }

    // 构建查询条件
    let whereClause = 'WHERE rd.user_id = $1';
    const params: any[] = [userId];
    
    if (type) {
      whereClause += ' AND rd.type = $2';
      params.push(type);
    }

    // 查询收益明细（简化查询，不关联产品表）
    const records = await query(
      `SELECT 
        rd.id,
        rd.type,
        rd.amount,
        rd.balance_before,
        rd.balance_after,
        rd.description,
        rd.created_at,
        rd.revenue_id
       FROM revenue_details rd
       ${whereClause}
       ORDER BY rd.created_at DESC
       LIMIT 100`,
      params
    );

    // 计算统计
    const statsResult: any = await queryOne(
      `SELECT 
         COALESCE(SUM(CASE WHEN type = 'profit_in' THEN amount ELSE 0 END), 0) as total_in,
         COALESCE(SUM(CASE WHEN type = 'convert_to_energy' THEN amount ELSE 0 END), 0) as total_convert,
         COALESCE(SUM(CASE WHEN type = 'withdraw' THEN amount ELSE 0 END), 0) as total_withdraw,
         COUNT(CASE WHEN type = 'profit_in' THEN 1 END) as count_in,
         COUNT(CASE WHEN type = 'convert_to_energy' THEN 1 END) as count_convert,
         COUNT(CASE WHEN type = 'withdraw' THEN 1 END) as count_withdraw
       FROM revenue_details
       WHERE user_id = $1`,
      [userId]
    );

    // 获取当前收益汇总
    const revenueResult: any = await queryOne(
      `SELECT 
         COALESCE(SUM(profit), 0) as total_profit,
         COALESCE(SUM(converted_to_energy), 0) as converted
       FROM member_revenue
       WHERE user_id = $1`,
      [userId]
    );

    const totalProfit = parseNumeric(revenueResult?.total_profit);
    const converted = parseNumeric(revenueResult?.converted);

    const stats = {
      totalProfit,
      converted,
      available: totalProfit - converted,
      totalIn: parseNumeric(statsResult?.total_in),
      totalConvert: parseNumeric(statsResult?.total_convert),
      totalWithdraw: parseNumeric(statsResult?.total_withdraw),
    };

    return NextResponse.json({
      success: true,
      data: {
        records: records || [],
        stats,
      }
    });
  } catch (error) {
    console.error('获取收益明细失败:', error);
    return NextResponse.json({
      success: false,
      error: '获取收益明细失败'
    }, { status: 500 });
  }
}
