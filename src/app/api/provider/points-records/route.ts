import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 获取服务商积分记录
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const userId = authUser.userId;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    let sql = 'SELECT * FROM points_records WHERE user_id = $1';
    const params: any[] = [userId];

    if (type) {
      sql += ' AND type = $2';
      params.push(type);
    }

    sql += ' ORDER BY created_at DESC';

    const data = await query(sql, params);

    // 获取积分统计
    const stats = await query(
      `SELECT 
        COALESCE(SUM(CASE WHEN type = 'convert' THEN amount ELSE 0 END), 0) as total_convert,
        COALESCE(SUM(CASE WHEN type = 'exchange' THEN amount ELSE 0 END), 0) as total_exchange,
        COALESCE(SUM(CASE WHEN type = 'convert' THEN amount ELSE -amount END), 0) as available_points
      FROM points_records WHERE user_id = $1`,
      [userId]
    );

    return NextResponse.json({
      success: true,
      data: {
        records: data,
        stats: stats[0] || { total_convert: 0, total_exchange: 0, available_points: 0 },
      },
    });
  } catch (error) {
    console.error('获取服务商积分记录失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取积分记录失败' },
      { status: 500 }
    );
  }
}
