import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest } from '@/lib/auth';

// 会员确认收款接口（卖出场景）
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { orderId, userId } = body;

    if (!orderId || !userId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (user.role !== 'admin' && user.userId !== userId) {
      return NextResponse.json({ error: '无权操作此订单' }, { status: 403 });
    }

    const client = getSupabaseClient();

    // 查询订单信息
    const { data: order, error: orderError } = await client
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) {
      throw new Error(`查询订单失败: ${orderError.message}`);
    }

    if (!order) {
      return NextResponse.json({ error: '订单不存在' }, { status: 404 });
    }

    if (user.role !== 'admin' && order.user_id !== userId) {
      return NextResponse.json({ error: '无权操作此订单' }, { status: 403 });
    }

    if (order.status !== 'awaiting_payment') {
      return NextResponse.json({ error: '订单状态不正确' }, { status: 400 });
    }

    // 查询用户产品信息
    const { data: userProduct, error: userProductError } = await client
      .from('user_products')
      .select('*')
      .eq('id', order.user_product_id)
      .maybeSingle();

    if (userProductError) {
      throw new Error(`查询用户产品失败: ${userProductError.message}`);
    }

    if (!userProduct) {
      return NextResponse.json({ error: '用户产品不存在' }, { status: 404 });
    }

    // 更新订单状态
    const { error: updateError } = await client
      .from('orders')
      .update({ status: 'pending_sell', updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('status', 'awaiting_payment');

    if (updateError) {
      throw new Error(`更新订单失败: ${updateError.message}`);
    }

    // 更新用户产品状态
    await client
      .from('user_products')
      .update({ status: 'pending_sell' })
      .eq('id', order.user_product_id);

    return NextResponse.json({
      success: true,
      message: '已提交卖出申请，等待服务商审核',
    });
  } catch (error) {
    console.error('确认收款失败:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
