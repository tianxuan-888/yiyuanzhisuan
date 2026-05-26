import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/client';

// GET - 获取所有兑换订单（总公司查看）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    
    const client = createClient();
    
    let sql = `SELECT eo.*, pp.name as product_name, pp.image_url, pp.points_price,
      u.username, u.unique_id, u.phone
      FROM points_exchange_orders eo
      LEFT JOIN points_products pp ON eo.product_id = pp.id
      LEFT JOIN users u ON eo.user_id = u.id`;
    
    const conditions: string[] = [];
    if (status) {
      conditions.push(`eo.status = '${status}'`);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ` ORDER BY eo.created_at DESC`;
    
    const { data, error } = await client.rpc('rpc_execute', { sql_query: sql });
    
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    
    const records = (data as any[])?.[0]?.result || data || [];
    
    return NextResponse.json({ success: true, data: records });
  } catch (error: any) {
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
    
    const client = createClient();
    const sql = `UPDATE points_exchange_orders SET status = '${status}', updated_at = NOW() WHERE id = '${orderId}' RETURNING *`;
    
    const { data, error } = await client.rpc('rpc_execute', { sql_query: sql });
    
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ success: true, message: '订单状态已更新' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
