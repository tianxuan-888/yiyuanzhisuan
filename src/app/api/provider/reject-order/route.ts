import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseServiceRoleKey } from '@/lib/env';
import { execute, queryOne } from '@/lib/pg-client';

// 获取管理员 Supabase 客户端（绕过 RLS）
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
 * 新流程：将 user_products(pending_confirm) → cancelled，产品(pending_sell) → available，退还能量值
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, reason } = body;

    if (!orderId) {
      return NextResponse.json(
        { error: '订单ID不能为空' },
        { status: 400 }
      );
    }

    const client = getAdminSupabase();

    // 获取订单信息
    const { data: order, error: fetchError } = await client
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fetchError || !order) {
      return NextResponse.json(
        { error: '订单不存在' },
        { status: 404 }
      );
    }

    if (!order.status) {
      return NextResponse.json({ error: '订单状态异常' }, { status: 400 });
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

    // ========== 新流程：更新 user_products 和 products 状态 ==========
    
    // 1. 将 user_products(pending_confirm) → cancelled
    if (order.user_product_id) {
      const { error: updateUPError } = await client
        .from('user_products')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.user_product_id)
        .eq('status', 'pending_confirm');

      if (updateUPError) {
        console.error('更新持仓记录状态失败:', updateUPError);
      }
    }

    // 2. 将产品(pending_sell) → available
    if (order.product_id) {
      const { error: updateProductError } = await client
        .from('products')
        .update({
          status: 'available',
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.product_id)
        .eq('status', 'pending_sell');

      if (updateProductError) {
        console.error('更新产品状态失败:', updateProductError);
      }
    }

    // 3. 退还会员能量值（购买时已扣除的 market_fee）- 使用 SQL 直接更新
    if (order.energy_cost && order.energy_cost > 0) {
      const memberRow = await queryOne('SELECT energy_value FROM users WHERE id = $1', [order.user_id]);
      if (memberRow) {
        const newBalance = (parseFloat(String(memberRow.energy_value)) || 0) + order.energy_cost;
        await execute('UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2', [newBalance, order.user_id]);

        // 记录能量值退还流水
        await client
          .from('energy_transactions')
          .insert({
            id: crypto.randomUUID(),
            user_id: order.user_id,
            type: 'refund',
            amount: order.energy_cost,
            from_user_id: null,
            to_user_id: null,
            status: 'completed',
            description: '订单被拒绝，退还市场费能量值',
            created_at: new Date().toISOString(),
          });
      }

      // 同时更新 energy_accounts
      try {
        await execute(
          'UPDATE energy_accounts SET balance = balance + $1, total_out = GREATEST(0, total_out - $1), updated_at = NOW() WHERE user_id = $2',
          [order.energy_cost, order.user_id]
        );
      } catch (e) {
        console.log('更新 energy_accounts 失败，跳过:', e);
      }
    }

    // 发送通知给会员
    if (order.product_id) {
      const { data: product } = await client
        .from('products')
        .select('name')
        .eq('id', order.product_id)
        .maybeSingle();

      await client
        .from('notifications')
        .insert({
          receiver_id: order.user_id,
          receiver_role: 'member',
          sender_id: null,
          sender_name: '系统通知',
          type: 'buy_rejected',
          title: '购买申请被拒绝',
          content: `您购买的产品 ${product?.name || ''} 申请已被拒绝，能量值已退还`,
          amount: order.energy_cost || 0,
          related_id: order.product_id,
        });
    }

    return NextResponse.json({
      success: true,
      message: '订单已拒绝，能量值已退还'
    });
  } catch (error) {
    console.error('拒绝订单失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '拒绝订单失败' },
      { status: 500 }
    );
  }
}
