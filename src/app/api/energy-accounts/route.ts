import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取收益账户列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role'); // branch, provider, member
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    let whereClause = '';
    const params: any[] = [];

    if (role) {
      whereClause = 'WHERE u.role = $1';
      params.push(role);
    }

    const offset = (page - 1) * pageSize;

    // 获取账户列表
    const accountsQuery = `
      SELECT ea.*, u.username, u.role, u.phone
      FROM energy_accounts ea
      JOIN users u ON u.id = ea.user_id
      ${whereClause}
      ORDER BY ea.balance DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(pageSize, offset);

    const accounts = await query(accountsQuery, params);

    // 获取总数
    const countParams = role ? [role] : [];
    const countQuery = `
      SELECT COUNT(*) as total
      FROM energy_accounts ea
      JOIN users u ON u.id = ea.user_id
      ${whereClause}
    `;
    const countResult = await query(countQuery, countParams);
    const total = parseInt(countResult[0]?.total || '0');

    // 获取各角色汇总
    const summaryQuery = `
      SELECT u.role, 
             COUNT(*) as count,
             COALESCE(SUM(ea.balance), 0) as total_balance,
             COALESCE(SUM(ea.total_in), 0) as total_in,
             COALESCE(SUM(ea.total_out), 0) as total_out
      FROM users u
      LEFT JOIN energy_accounts ea ON u.id = ea.user_id
      WHERE u.role IN ('branch', 'provider', 'member')
      GROUP BY u.role
    `;
    const summary = await query(summaryQuery);

    return NextResponse.json({
      success: true,
      data: {
        accounts: accounts.map(a => ({
          id: a.id,
          userId: a.user_id,
          username: a.username,
          role: a.role,
          phone: a.phone,
          balance: Number(a.balance || 0),
          totalIn: Number(a.total_in || 0),
          totalOut: Number(a.total_out || 0),
        })),
        summary: summary.map(s => ({
          role: s.role,
          count: parseInt(s.count),
          totalBalance: Number(s.total_balance),
          totalIn: Number(s.total_in),
          totalOut: Number(s.total_out),
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
    console.error('获取收益账户列表失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
