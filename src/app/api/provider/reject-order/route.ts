import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseServiceRoleKey } from '@/lib/env';

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

    // 更新订单状态为已取消（order_status 枚举没有 rejected，使用 cancelled）
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

    // 如果之前扣除了能量值，需要退还
    if (order.energy_cost && order.energy_cost > 0) {
      try {
        await client.rpc('increment_energy', {
          user_id: order.user_id,
          amount: order.energy_cost
        });
      } catch (e) {
        // 如果存储过程不存在，跳过
        console.log('Storage function not found, skipping energy refund');
      }
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
