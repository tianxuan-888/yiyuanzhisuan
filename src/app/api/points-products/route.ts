import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/client';

// GET - 获取积分商品列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    
    const client = createClient();
    let query = 'SELECT * FROM points_products';
    const conditions: string[] = [];
    
    if (status) {
      conditions.push(`status = '${status}'`);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC';
    
    const { data, error } = await client.rpc('rpc_execute', { sql_query: query });
    
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    
    const products = (data as any[])?.[0]?.result || data || [];
    
    return NextResponse.json({ success: true, data: products });
  } catch (error: any) {
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
    
    const client = createClient();
    const sql = `INSERT INTO points_products (name, description, image_url, points_price, stock, status, created_by)
      VALUES (${`'${name.replace(/'/g, "''")}'`}, ${description ? `'${description.replace(/'/g, "''")}'` : 'NULL'}, ${imageUrl ? `'${imageUrl}'` : 'NULL'}, ${pointsPrice}, ${stock || -1}, 'active', ${createdBy ? `'${createdBy}'` : 'NULL'})
      RETURNING *`;
    
    const { data, error } = await client.rpc('rpc_execute', { sql_query: sql });
    
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    
    const result = (data as any[])?.[0]?.result || data;
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
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
    
    const client = createClient();
    const updates: string[] = [];
    
    if (name !== undefined) updates.push(`name = '${name.replace(/'/g, "''")}'`);
    if (description !== undefined) updates.push(`description = ${description ? `'${description.replace(/'/g, "''")}'` : 'NULL'}`);
    if (imageUrl !== undefined) updates.push(`image_url = ${imageUrl ? `'${imageUrl}'` : 'NULL'}`);
    if (pointsPrice !== undefined) updates.push(`points_price = ${pointsPrice}`);
    if (stock !== undefined) updates.push(`stock = ${stock}`);
    if (status !== undefined) updates.push(`status = '${status}'`);
    updates.push(`updated_at = NOW()`);
    
    const sql = `UPDATE points_products SET ${updates.join(', ')} WHERE id = '${id}' RETURNING *`;
    
    const { data, error } = await client.rpc('rpc_execute', { sql_query: sql });
    
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    
    const result = (data as any[])?.[0]?.result || data;
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
