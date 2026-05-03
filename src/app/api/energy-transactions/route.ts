import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取能量值流水记录
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // quota_match, purchase, market_transfer, withdraw, manual, all
    const userId = searchParams.get('userId');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (type && type !== 'all') {
      conditions.push(`et.type = $${paramIndex}`);
      params.push(type);
      paramIndex++;
    }

    if (userId) {
      conditions.push(`(et.from_user_id = $${paramIndex} OR et.to_user_id = $${paramIndex})`);
      params.push(userId);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;

    // 获取流水列表
    const transactionsQuery = `
      SELECT et.*, 
             fu.username as from_username, fu.role as from_role,
             tu.username as to_username, tu.role as to_role
      FROM energy_transactions et
      LEFT JOIN users fu ON fu.id = et.from_user_id
      LEFT JOIN users tu ON tu.id = et.to_user_id
      ${whereClause}
      ORDER BY et.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(pageSize, offset);

    const transactions = await query(transactionsQuery, params);

    // 获取总数
    const countParams = params.slice(0, -2);
    const countQuery = `
      SELECT COUNT(*) as total
      FROM energy_transactions et
      LEFT JOIN users fu ON fu.id = et.from_user_id
      LEFT JOIN users tu ON tu.id = et.to_user_id
      ${whereClause}
    `;
    const countResult = await query(countQuery, countParams);
    const total = parseInt(countResult[0]?.total || '0');

    // 获取各类型汇总
    const summaryQuery = `
      SELECT type, 
             COUNT(*) as count,
             SUM(amount) as total_amount
      FROM energy_transactions
      GROUP BY type
    `;
    const summary = await query(summaryQuery);

    // 获取最近30天趋势
    const trendQuery = `
      SELECT DATE(created_at) as date,
             type,
             SUM(amount) as daily_amount,
             COUNT(*) as daily_count
      FROM energy_transactions
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at), type
      ORDER BY date DESC
    `;
    const trend = await query(trendQuery);

    return NextResponse.json({
      success: true,
      data: {
        transactions: transactions.map(t => ({
          id: t.id,
          type: t.type,
          amount: Number(t.amount),
          fromUserId: t.from_user_id,
          fromUsername: t.from_username,
          fromRole: t.from_role,
          toUserId: t.to_user_id,
          toUsername: t.to_username,
          toRole: t.to_role,
          note: t.note,
          createdAt: t.created_at,
        })),
        summary: summary.map(s => ({
          type: s.type,
          count: parseInt(s.count),
          totalAmount: Number(s.total_amount),
        })),
        trend: trend.map(t => ({
          date: t.date,
          type: t.type,
          dailyAmount: Number(t.daily_amount),
          dailyCount: parseInt(t.daily_count),
        })),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      },
    });
  } catch (error: any) {
    console.error('获取能量值流水失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
