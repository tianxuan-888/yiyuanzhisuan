import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const supabase = getSupabaseClient();

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const orderType = searchParams.get('orderType');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    let query = supabase
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
      `);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (orderType && orderType !== 'all') {
      query = query.eq('order_type', orderType);
    }

    if (startDate) {
      query = query.gte('created_at', startDate);
    }

    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    const { data: orders, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('获取订单列表失败:', error);
      return NextResponse.json({ success: false, error: '获取订单列表失败' }, { status: 500 });
    }

    // 获取用户名和产品名
    const ordersWithDetails = await Promise.all(
      (orders || []).map(async (order) => {
        // 获取用户名
        const { data: user } = await supabase
          .from('users')
          .select('username')
          .eq('id', order.user_id)
          .single();

        // 获取产品名
        const { data: userProduct } = await supabase
          .from('user_products')
          .select('product_id')
          .eq('id', order.user_product_id)
          .single();

        let productName = '未知产品';
        if (userProduct?.product_id) {
          const { data: product } = await supabase
            .from('products')
            .select('name')
            .eq('id', userProduct.product_id)
            .single();
          productName = product?.name || '未知产品';
        }

        return {
          ...order,
          username: user?.username || '未知用户',
          product_name: productName,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: ordersWithDetails,
    });
  } catch (error) {
    console.error('服务器错误:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
