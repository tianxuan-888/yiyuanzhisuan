import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { query, queryOne } from '@/lib/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { randomUUID } from 'crypto';

// 确认卖出收益（会员确认收款后执行收益分配）
export async function POST(request: NextRequest) {
  try {
    // 鉴权：所有登录用户都可操作
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { orderId, userId } = body;

    if (!orderId || !userId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 验证操作者权限：管理员或订单所属用户
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

    if (order.order_type !== 'sell') {
      return NextResponse.json({ error: '非卖出订单' }, { status: 400 });
    }

    if (order.status !== 'awaiting_payment') {
      return NextResponse.json({ error: '订单状态不允许确认' }, { status: 400 });
    }

    // 查询用户产品信息
    const { data: userProduct, error: userProductError } = await client
      .from('user_products')
      .select('*, products(*)')
      .eq('id', order.user_product_id)
      .maybeSingle();

    if (userProductError) {
      throw new Error(`查询用户产品失败: ${userProductError.message}`);
    }

    // 查询系统配置
    const { data: configs } = await client
      .from('system_config')
      .select('key, value')
      .in('key', [
        'profit_cash_ratio',
        'profit_points_ratio',
        'energy_allocation_provider',
        'energy_allocation_company',
        'energy_allocation_direct',
        'energy_allocation_parent_provider',
        'energy_allocation_branch',
      ]);

    const configMap: Record<string, string> = {};
    configs?.forEach((c: any) => {
      configMap[c.key] = c.value;
    });

    // 计算各项分配
    const sellPrice = parseFloat(order.amount);
    const cashRatio = parseFloat(configMap.profit_cash_ratio || '0.5');
    const cashAmount = sellPrice * cashRatio;
    const profitAmount = order.actual_profit || cashAmount;

    // 使用白名单过滤字段
    const allowedUpdates: Record<string, unknown> = {
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // 更新订单状态
    const { error: updateOrderError } = await client
      .from('orders')
      .update(allowedUpdates)
      .eq('id', orderId)
      .eq('status', 'awaiting_payment'); // 乐观锁

    if (updateOrderError) {
      throw new Error(`更新订单失败: ${updateOrderError.message}`);
    }

    // 更新用户产品状态
    await client
      .from('user_products')
      .update({ status: 'sold' })
      .eq('id', order.user_product_id);

    // 发放收益给用户（写入智算金balance）
    await client.rpc('increment_balance', {
      p_user_id: userId,
      p_amount: sellPrice
    });

    // 创建会员收益记录（只有在卖出时才记录收益）
    await query(
      `INSERT INTO member_revenue 
       (id, user_id, order_id, user_product_id, principal, profit, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())`,
      [
        randomUUID(),
        userId,
        orderId,
        userProduct?.id,
        sellPrice,
        profitAmount
      ]
    );

    // 记录交易
    await client
      .from('transactions')
      .insert({
        user_id: userId,
        order_id: orderId,
        type: 'sell_profit',
        amount: profitAmount,
        note: `卖出产品获得收益 ${profitAmount}`
      });

    return NextResponse.json({
      success: true,
      message: '收益确认成功',
      data: {
        sellPrice,
        profitAmount,
        cashAmount
      }
    });
  } catch (error) {
    console.error('确认卖出收益失败:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
