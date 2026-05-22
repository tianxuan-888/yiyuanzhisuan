import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseServiceRoleKey } from '@/lib/env';

function getAdminSupabase() {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    throw new Error('Missing Supabase configuration');
  }
  return createClient(url, key);
}

/**
 * 拒绝购买订单
 * 将 user_products(pending_confirm) → cancelled，产品(pending_sell) → available
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, reason } = body;

    if (!orderId) {
      return NextResponse.json({ error: '订单ID不能为空' }, { status: 400 });
    }

    const client = getAdminSupabase();

    const { data: order, error: fetchError } = await client
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fetchError || !order) {
      return NextResponse.json({ error: '订单不存在' }, { status: 404 });
    }

    if (order.status !== 'pending') {
      return NextResponse.json({ error: `订单状态为 ${order.status}，无法拒绝` }, { status: 400 });
    }

    // 更新订单状态为已取消
    const { error: updateError } = await client
      .from('orders')
      .update({
        status: 'cancelled',
        reject_reason: reason || '服务商拒绝',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (updateError) {
      throw new Error(`更新订单失败: ${updateError.message}`);
    }

    // 1. 将 user_products(pending_confirm) → cancelled
    if (order.user_product_id) {
      await client
        .from('user_products')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', order.user_product_id)
        .eq('status', 'pending_confirm');
    }

    // 2. 将产品(pending_sell) → available
    if (order.product_id) {
      await client
        .from('products')
        .update({ status: 'available', updated_at: new Date().toISOString() })
        .eq('id', order.product_id)
        .eq('status', 'pending_sell');
    }

    // 发送通知给会员
    if (order.product_id) {
      const { data: product } = await client
        .from('products')
        .select('name')
        .eq('id', order.product_id)
        .maybeSingle();

      await client.from('notifications').insert({
        receiver_id: order.user_id,
        receiver_role: 'member',
        sender_id: null,
        sender_name: '系统通知',
        type: 'buy_rejected',
        title: '购买申请被拒绝',
        content: `您购买的产品 ${product?.name || ''} 申请已被拒绝`,
        related_id: order.product_id,
      });
    }

    return NextResponse.json({
      success: true,
      message: '订单已拒绝'
    });
  } catch (error) {
    console.error('拒绝订单失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '拒绝订单失败' },
      { status: 500 }
    );
  }
}
