import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 获取智算中心手续费沉淀记录
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    if (authUser.role !== 'admin') {
      return NextResponse.json({ error: '仅智算中心可查看' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const sourceRole = searchParams.get('sourceRole');

    let sql = 'SELECT * FROM company_fee_records WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (type) {
      sql += ` AND type = $${paramIdx}`;
      params.push(type);
      paramIdx++;
    }

    if (sourceRole) {
      sql += ` AND source_role = $${paramIdx}`;
      params.push(sourceRole);
    }

    sql += ' ORDER BY created_at DESC';

    const data = await query(sql, params);

    // 统计
    const stats = await query(
      `SELECT 
        COALESCE(SUM(CASE WHEN type = 'withdrawal_fee' THEN amount ELSE 0 END), 0) as total_withdrawal_fee,
        COALESCE(SUM(CASE WHEN type = 'market_fee_ops' THEN amount ELSE 0 END), 0) as total_market_fee_ops,
        COALESCE(SUM(CASE WHEN source_role = 'member' THEN amount ELSE 0 END), 0) as from_member,
        COALESCE(SUM(CASE WHEN source_role = 'provider' THEN amount ELSE 0 END), 0) as from_provider,
        COALESCE(SUM(CASE WHEN source_role = 'branch' THEN amount ELSE 0 END), 0) as from_branch,
        COALESCE(SUM(amount), 0) as total_fee
      FROM company_fee_records`
    );

    return NextResponse.json({
      success: true,
      data: {
        records: data,
        stats: stats[0] || {},
      },
    });
  } catch (error) {
    console.error('获取手续费记录失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取手续费记录失败' },
      { status: 500 }
    );
  }
}
