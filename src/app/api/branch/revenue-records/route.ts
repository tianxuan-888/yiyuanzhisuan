import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 获取服务网点收益记录
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    if (authUser.role !== 'branch') {
      return NextResponse.json({ error: '仅服务网点可查看' }, { status: 403 });
    }

    const branchUserId = authUser.userId;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const status = searchParams.get('status');

    let sql = 'SELECT * FROM branch_revenue_records WHERE branch_id = $1';
    const params: any[] = [branchUserId];
    let paramIdx = 2;

    if (type) {
      sql += ` AND type = $${paramIdx}`;
      params.push(type);
      paramIdx++;
    }

    if (status) {
      sql += ` AND status = $${paramIdx}`;
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';

    const data = await query(sql, params);

    // 统计
    const stats = await query(
      `SELECT 
        COALESCE(SUM(CASE WHEN type = 'member_withdraw' THEN amount ELSE 0 END), 0) as total_member_withdraw,
        COALESCE(SUM(CASE WHEN type = 'provider_withdraw' THEN amount ELSE 0 END), 0) as total_provider_withdraw,
        COALESCE(SUM(CASE WHEN type = 'market_fee_share' THEN amount ELSE 0 END), 0) as total_market_fee_share,
        COALESCE(SUM(CASE WHEN type = 'provider_upstream' THEN amount ELSE 0 END), 0) as total_provider_upstream,
        COALESCE(SUM(amount), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN status = 'received' THEN amount ELSE 0 END), 0) as pending_amount,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0) as completed_amount
      FROM branch_revenue_records WHERE branch_id = $1`,
      [branchUserId]
    );

    return NextResponse.json({
      success: true,
      data: {
        records: data,
        stats: stats[0] || {},
      },
    });
  } catch (error) {
    console.error('获取服务网点收益记录失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取收益记录失败' },
      { status: 500 }
    );
  }
}
