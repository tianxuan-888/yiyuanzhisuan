import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest } from '@/lib/auth';

const supabase = getSupabaseClient();

// 获取会员待审核的购买订单
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || user.userId;

    // 获取该用户的 pending 和 processing 状态的购买订单
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id,
        user_id,
        user_product_id,
        order_type,
        amount,
        status,
        created_at,
        updated_at
      `)
      .eq('user_id', userId)
      .eq('order_type', 'buy')
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false });

    if (error) {
      console.error('获取待审核订单失败:', error);
      return NextResponse.json({ success: false, error: '获取待审核订单失败' }, { status: 500 });
    }

    // 获取订单关联的产品信息
    const pendingOrders = await Promise.all(
      (orders || []).map(async (order) => {
        // 获取 user_product 信息
        const { data: userProduct } = await supabase
          .from('user_products')
          .select('product_id, status, created_at')
          .eq('id', order.user_product_id)
          .single();

        // 获取产品信息
        let product = null;
        if (userProduct?.product_id) {
          const { data: p } = await supabase
            .from('products')
            .select('id, name, price, period, total_rate, profit_rate')
            .eq('id', userProduct.product_id)
            .single();
          product = p;
        }

        return {
          orderId: order.id,
          orderStatus: order.status,
          orderCreatedAt: order.created_at,
          productId: userProduct?.product_id,
          productName: product?.name,
          productPrice: product?.price,
          productPeriod: product?.period,
          totalRate: product?.total_rate,
          profitRate: product?.profit_rate,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: pendingOrders,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    });
  } catch (error) {
    console.error('获取待审核订单异常:', error);
    return NextResponse.json({ success: false, error: '服务器异常' }, { status: 500 });
  }
}
