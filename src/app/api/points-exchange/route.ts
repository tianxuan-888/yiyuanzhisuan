import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/client';

// POST - 兑换商品
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, productId, receiverName, receiverPhone, receiverAddress } = body;
    
    if (!userId || !productId || !receiverName || !receiverPhone || !receiverAddress) {
      return NextResponse.json({ success: false, error: '缺少必填信息' }, { status: 400 });
    }
    
    const client = createClient();
    
    // 1. 查询商品信息
    const { data: productData, error: productError } = await client.rpc('rpc_execute', {
      sql_query: `SELECT * FROM points_products WHERE id = '${productId}' AND status = 'active'`
    });
    
    const product = (productData as any[])?.[0]?.result?.[0] || (productData as any[])?.[0];
    if (!product || productError) {
      return NextResponse.json({ success: false, error: '商品不存在或已下架' }, { status: 400 });
    }
    
    // 2. 检查库存
    if (product.stock > 0) {
      // 减库存
      const { error: stockError } = await client.rpc('rpc_execute', {
        sql_query: `UPDATE points_products SET stock = stock - 1, updated_at = NOW() WHERE id = '${productId}' AND stock > 0`
      });
      if (stockError) {
        return NextResponse.json({ success: false, error: '库存不足' }, { status: 400 });
      }
    }
    
    // 3. 查询用户积分
    const { data: userData, error: userError } = await client.rpc('rpc_execute', {
      sql_query: `SELECT id, username, points FROM users WHERE id = '${userId}'`
    });
    
    const user = (userData as any[])?.[0]?.result?.[0] || (userData as any[])?.[0];
    if (!user || userError) {
      return NextResponse.json({ success: false, error: '用户不存在' }, { status: 400 });
    }
    
    if ((user.points || 0) < product.points_price) {
      return NextResponse.json({ success: false, error: `积分不足，需要 ${product.points_price} 积分，当前 ${user.points || 0} 积分` }, { status: 400 });
    }
    
    // 4. 扣除积分
    const { error: deductError } = await client.rpc('rpc_execute', {
      sql_query: `UPDATE users SET points = points - ${product.points_price}, updated_at = NOW() WHERE id = '${userId}' AND points >= ${product.points_price}`
    });
    
    if (deductError) {
      return NextResponse.json({ success: false, error: '扣除积分失败' }, { status: 500 });
    }
    
    // 5. 创建兑换订单
    const orderSql = `INSERT INTO points_exchange_orders (user_id, product_id, product_name, points_cost, receiver_name, receiver_phone, receiver_address, status)
      VALUES ('${userId}', '${productId}', '${(product.name || '').replace(/'/g, "''")}', ${product.points_price}, '${receiverName.replace(/'/g, "''")}', '${receiverPhone}', '${receiverAddress.replace(/'/g, "''")}', 'pending')
      RETURNING *`;
    
    const { data: orderData, error: orderError } = await client.rpc('rpc_execute', { sql_query: orderSql });
    
    if (orderError) {
      // 回滚积分
      await client.rpc('rpc_execute', {
        sql_query: `UPDATE users SET points = points + ${product.points_price} WHERE id = '${userId}'`
      });
      return NextResponse.json({ success: false, error: '创建兑换订单失败' }, { status: 500 });
    }
    
    const order = (orderData as any[])?.[0]?.result?.[0] || (orderData as any[])?.[0];
    
    return NextResponse.json({
      success: true,
      data: {
        order,
        remainingPoints: (user.points || 0) - product.points_price
      },
      message: '兑换成功'
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// GET - 获取用户兑换记录
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    
    const client = createClient();
    
    let sql = `SELECT eo.*, pp.name as product_name, pp.image_url, pp.points_price
      FROM points_exchange_orders eo
      LEFT JOIN points_products pp ON eo.product_id = pp.id`;
    
    if (userId) {
      sql += ` WHERE eo.user_id = '${userId}'`;
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
