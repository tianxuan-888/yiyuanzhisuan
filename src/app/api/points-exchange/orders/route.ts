import { NextRequest, NextResponse } from 'next/server';
import { query, execute } from '@/lib/pg-client';

// GET - 获取所有兑换订单（总公司查看）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let sql = `SELECT eo.*, pp.name as product_name, pp.image_url, pp.points_price,
      u.username, u.unique_id, u.phone
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

    return NextResponse.json({ success: true, data: records });
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
