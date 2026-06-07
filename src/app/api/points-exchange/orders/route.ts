import { NextRequest, NextResponse } from 'next/server';
import { query, execute } from '@/lib/pg-client';

// GET - 获取所有兑换订单（总公司查看）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    // 查询兑换订单列表（含收货人信息）
    let sql = `SELECT eo.id, eo.user_id, eo.product_id, eo.product_name, eo.points_cost,
      eo.receiver_name, eo.receiver_phone, eo.receiver_address, eo.status,
      eo.created_at, eo.updated_at,
      pp.name as product_name, pp.image_url, pp.points_price,
      u.username, u.unique_id, u.phone, u.role
      FROM points_exchange_orders eo
      LEFT JOIN points_products pp ON eo.product_id::uuid = pp.id::uuid
      LEFT JOIN users u ON eo.user_id::uuid = u.id::uuid`;

    const params: any[] = [];
    if (status) {
      sql += ` WHERE eo.status = $1`;
      params.push(status);
    }
    sql += ` ORDER BY eo.created_at DESC`;

    const records = await query(sql, params);

    // 统计数据
    const statsResult = await query(`
      SELECT 
        COUNT(*) as total_orders,
        COALESCE(SUM(points_cost), 0) as total_points_cost,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN points_cost ELSE 0 END), 0) as pending_points,
        COUNT(CASE WHEN status = 'shipped' THEN 1 END) as shipped_count,
        COALESCE(SUM(CASE WHEN status = 'shipped' THEN points_cost ELSE 0 END), 0) as shipped_points,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN points_cost ELSE 0 END), 0) as completed_points
      FROM points_exchange_orders
    `);

    const stats = statsResult?.[0] || {};

    return NextResponse.json({ 
      success: true, 
      data: records,
      stats: {
        totalOrders: Number(stats.total_orders) || 0,
        totalPointsCost: Number(stats.total_points_cost) || 0,
        pendingCount: Number(stats.pending_count) || 0,
        pendingPoints: Number(stats.pending_points) || 0,
        shippedCount: Number(stats.shipped_count) || 0,
        shippedPoints: Number(stats.shipped_points) || 0,
        completedCount: Number(stats.completed_count) || 0,
        completedPoints: Number(stats.completed_points) || 0,
      }
    });
  } catch (error: any) {
    console.error('获取兑换订单失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// PUT - 更新订单状态（发货等）
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, status } = body;

    if (!orderId || !status) {
      return NextResponse.json({ success: false, error: '缺少参数' }, { status: 400 });
    }

    await execute(
      'UPDATE points_exchange_orders SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, orderId]
    );

    return NextResponse.json({ success: true, message: '订单状态已更新' });
  } catch (error: any) {
    console.error('更新兑换订单失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
