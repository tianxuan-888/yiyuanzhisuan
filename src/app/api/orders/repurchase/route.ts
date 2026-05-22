import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// POST - 服务商回购产品
// 回购：产品回到服务商代售列表，Token值随产品回到服务商
// 不涉及智算金（balance）变动，Token值不是智算金
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅管理员和服务商可操作
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const supabase = getSupabaseClient();
    const body = await request.json();
    const { orderId, providerId } = body;

    if (!orderId || !providerId) {
      return NextResponse.json({ success: false, error: '缺少必要参数' }, { status: 400 });
    }

    // 验证操作者权限
    if (user.role !== 'admin' && user.role !== 'provider') {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    // 获取订单信息
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ success: false, error: '订单不存在' }, { status: 404 });
    }

    if (order.order_type !== 'sell') {
      return NextResponse.json({ success: false, error: '不是卖出订单' }, { status: 400 });
    }

    if (order.status !== 'pending') {
      return NextResponse.json({ success: false, error: '订单状态不是待审核' }, { status: 400 });
    }

    // 获取用户产品信息
    const { data: userProduct, error: productError } = await supabase
      .from('user_products')
      .select('*')
      .eq('id', order.user_product_id)
      .single();

    if (productError || !userProduct) {
      return NextResponse.json({ success: false, error: '用户产品不存在' }, { status: 404 });
    }

    const tokenValue = Number(userProduct.purchase_price);

    // 更新订单状态为已完成（回购）
    const allowedOrderUpdates: Record<string, unknown> = {
      status: 'completed',
      reviewed_by: providerId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { error: orderUpdateError } = await supabase
      .from('orders')
      .update(allowedOrderUpdates)
      .eq('id', orderId)
      .eq('status', 'pending');

    if (orderUpdateError) {
      return NextResponse.json({ success: false, error: '更新订单失败' }, { status: 500 });
    }

    // 更新用户产品状态为已回购
    await supabase
      .from('user_products')
      .update({
        status: 'repurchased',
        updated_at: new Date().toISOString()
      })
      .eq('id', order.user_product_id);

    // 将产品重新设为可购买（回到服务商代售列表）
    const { data: productData } = await supabase
      .from('products')
      .select('id')
      .eq('id', userProduct.product_id)
      .single();

    if (productData) {
      await supabase
        .from('products')
        .update({
          status: 'available',
          updated_at: new Date().toISOString()
        })
        .eq('id', userProduct.product_id);
    }

    // 记录交易（Token值回流，不是智算金）
    await supabase
      .from('transactions')
      .insert({
        user_id: order.user_id,
        order_id: orderId,
        type: 'repurchase',
        amount: tokenValue,
        note: `服务商回购产品，Token值 ${tokenValue} 回到服务商代售`
      });

    return NextResponse.json({
      success: true,
      message: '回购成功，产品已回到代售列表',
      data: { tokenValue }
    });
  } catch (error) {
    console.error('回购产品失败:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
