import { NextRequest, NextResponse } from 'next/server';
import { query, execute } from '@/lib/pg-client';

// GET - 获取积分商品列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let sql = `SELECT pp.*, 
      COALESCE(eo.exchanged_count, 0) as exchanged_count,
      pp.stock as original_stock,
      pp.stock as stock
    FROM points_products pp
    LEFT JOIN (
      SELECT product_id, COUNT(*) as exchanged_count 
      FROM points_exchange_orders 
      WHERE status != 'cancelled'
      GROUP BY product_id
    ) eo ON pp.id = eo.product_id`;
    const params: any[] = [];

    if (status) {
      sql += ' WHERE pp.status = $1';
      params.push(status);
    }

    sql += ' ORDER BY pp.created_at DESC';

    const products = await query(sql, params);

    return NextResponse.json({ success: true, data: products });
  } catch (error: any) {
    console.error('获取积分商品失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST - 添加积分商品
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, imageUrl, pointsPrice, stock, createdBy } = body;

    if (!name || !pointsPrice) {
      return NextResponse.json({ success: false, error: '商品名称和兑换积分为必填' }, { status: 400 });
    }

    const result = await query(
      `INSERT INTO points_products (name, description, image_url, points_price, stock, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'active', $6)
       RETURNING *`,
      [name, description || null, imageUrl || null, pointsPrice, stock || -1, createdBy || null]
    );

    return NextResponse.json({ success: true, data: result[0] });
  } catch (error: any) {
    console.error('添加积分商品失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// PUT - 更新积分商品
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, description, imageUrl, pointsPrice, stock, status } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: '商品ID为必填' }, { status: 400 });
    }

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) { updates.push(`name = $${paramIndex++}`); params.push(name); }
    if (description !== undefined) { updates.push(`description = $${paramIndex++}`); params.push(description || null); }
    if (imageUrl !== undefined) { updates.push(`image_url = $${paramIndex++}`); params.push(imageUrl || null); }
    if (pointsPrice !== undefined) { updates.push(`points_price = $${paramIndex++}`); params.push(pointsPrice); }
    if (stock !== undefined) { updates.push(`stock = $${paramIndex++}`); params.push(stock); }
    if (status !== undefined) { updates.push(`status = $${paramIndex++}`); params.push(status); }
    updates.push(`updated_at = NOW()`);

    params.push(id);

    const sql = `UPDATE points_products SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const result = await query(sql, params);

    return NextResponse.json({ success: true, data: result[0] });
  } catch (error: any) {
    console.error('更新积分商品失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
