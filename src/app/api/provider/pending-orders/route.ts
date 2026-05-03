import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 获取服务商的待审核购买订单
export async function GET(request: NextRequest) {
  try {
    // 鉴权：仅服务商可操作
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['provider'])) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const providerId = authUser.userId;
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status') || 'pending'; // pending, completed, all

    // 构建查询：获取该服务商产品的购买订单
    // 注意：订单通过 orders.product_id 或 user_products 关联到 products
    let sql = `
      SELECT 
        o.id as order_id,
        o.user_id as buyer_id,
        o.user_product_id,
        o.order_type,
        o.amount,
        o.status,
        o.created_at,
        o.updated_at,
        u.id as user_id,
        u.username,
        u.phone,
        u.unique_id,
        u.real_name,
        o.product_id,
        up.product_id as up_product_id,
        p.name as product_name,
        p.code as product_code,
        p.price as product_price,
        p.period as product_period,
        p.total_rate,
        p.market_rate,
        p.profit_rate
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN user_products up ON o.user_product_id = up.id
      LEFT JOIN products p ON o.product_id = p.id OR up.product_id = p.id
      WHERE o.order_type = 'buy'
        AND p.provider_id = $1
    `;
    
    const params: any[] = [providerId];
    
    // 状态过滤
    if (status === 'pending') {
      sql += ` AND o.status = 'pending'`;
    } else if (status === 'completed') {
      sql += ` AND o.status = 'completed'`;
    }
    
    sql += ` ORDER BY o.created_at DESC`;

    const orders = await query(sql, params);

    // 按时间倒序排列
    orders.sort((a: any, b: any) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // 映射字段名称，确保 order_id 正确返回
    const mappedOrders = orders.map((o: any) => ({
      id: o.order_id,
      order_id: o.order_id,
      user_id: o.buyer_id,
      buyer_id: o.buyer_id,
      username: o.username,
      phone: o.phone,
      unique_id: o.unique_id,
      real_name: o.real_name,
      product_id: o.product_id,
      product_name: o.product_name,
      product_code: o.product_code,
      product_price: o.product_price,
      product_period: o.product_period,
      total_rate: o.total_rate,
      market_rate: o.market_rate,
      profit_rate: o.profit_rate,
      amount: o.amount,
      status: o.status,
      created_at: o.created_at,
      updated_at: o.updated_at,
    }));

    return NextResponse.json({
      success: true,
      data: {
        orders: mappedOrders,
        stats: {
          total: mappedOrders.length,
          pending: mappedOrders.filter((o: any) => o.status === 'pending').length,
          completed: mappedOrders.filter((o: any) => o.status === 'completed').length,
        }
      }
    });
  } catch (error) {
    console.error('获取待审核订单失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取待审核订单失败' },
      { status: 500 }
    );
  }
}
