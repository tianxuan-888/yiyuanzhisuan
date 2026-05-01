import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// POST - 服务商回购产品
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

    // 回购金额：仅返还本金
    const repurchaseAmount = Number(userProduct.purchase_price);

    // 使用白名单过滤字段
    const allowedOrderUpdates: Record<string, unknown> = {
      status: 'completed',
      reviewed_by: providerId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // 更新订单状态
    const { error: orderUpdateError } = await supabase
      .from('orders')
      .update(allowedOrderUpdates)
      .eq('id', orderId)
      .eq('status', 'pending'); // 乐观锁

    if (orderUpdateError) {
      return NextResponse.json({ success: false, error: '更新订单失败' }, { status: 500 });
    }

    // 更新用户产品状态
    await supabase
      .from('user_products')
      .update({
        status: 'repurchased',
        updated_at: new Date().toISOString()
      })
      .eq('id', order.user_product_id);

    // 返还本金给用户
    await supabase.rpc('increment_balance', {
      p_user_id: order.user_id,
      p_amount: repurchaseAmount
    });

    // 记录交易
    await supabase
      .from('transactions')
      .insert({
        user_id: order.user_id,
        order_id: orderId,
        type: 'repurchase',
        amount: repurchaseAmount,
        note: `服务商回购产品，返还本金 ${repurchaseAmount}`
      });

    return NextResponse.json({
      success: true,
      message: '回购成功，本金已返还',
      data: { repurchaseAmount }
    });
  } catch (error) {
    console.error('回购产品失败:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
