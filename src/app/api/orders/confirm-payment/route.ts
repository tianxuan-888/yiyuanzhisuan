import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { execute, queryOne } from '@/lib/pg-client';

// 服务商确认收款接口
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅管理员和服务商可操作
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { orderId } = body;

    // 参数验证
    if (!orderId) {
      return NextResponse.json({ error: '订单ID不能为空' }, { status: 400 });
    }

    // 验证操作者权限：必须是管理员或该订单的服务商
    if (user.role !== 'admin' && user.role !== 'provider') {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
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

    // 验证订单状态
    if (order.status !== 'pending') {
      return NextResponse.json({ error: '订单状态不正确' }, { status: 400 });
    }

    // 验证服务商（确保是本人的订单）
    if (user.role === 'provider' && order.provider_id !== user.userId) {
      return NextResponse.json({ error: '无权操作此订单' }, { status: 403 });
    }

    // 获取订单中的能量值费用（如果之前已记录）
    const energyCost = order.energy_cost || 0;

    // 查询产品信息
    const { data: product, error: productError } = await client
      .from('products')
      .select('*')
      .eq('id', order.product_id)
      .maybeSingle();

    if (productError) {
      throw new Error(`查询产品失败: ${productError.message}`);
    }

    if (!product) {
      return NextResponse.json({ error: '产品不存在' }, { status: 404 });
    }

    // 计算到期日期、预期收益、市场费用
    const purchaseDate = new Date();
    const expireDate = new Date(purchaseDate);
    expireDate.setDate(expireDate.getDate() + product.period);

    const price = parseFloat(product.price);
    const totalRate = parseFloat(product.total_rate) / 100;
    const marketRate = parseFloat(product.market_rate) / 100;

    const expectedProfit = price * totalRate;
    const marketFee = price * marketRate;

    // 使用白名单过滤字段
    const allowedUpdates: Record<string, unknown> = {
      status: 'completed',
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // 更新订单状态
    const { error: updateError } = await client
      .from('orders')
      .update(allowedUpdates)
      .eq('id', orderId)
      .eq('status', 'pending'); // 乐观锁

    if (updateError) {
      throw new Error(`更新订单失败: ${updateError.message}`);
    }

    // ========== 扣除会员能量值（审核通过时才扣除）==========
    if (energyCost > 0) {
      // 使用 SQL 直接更新，确保写入成功
      const memberRow = await queryOne('SELECT energy_value FROM users WHERE id = $1', [order.user_id]);
      if (memberRow) {
        const newBalance = (parseFloat(String(memberRow.energy_value)) || 0) - energyCost;
        await execute('UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2', [newBalance, order.user_id]);

        await client.from('energy_transactions').insert({
          id: crypto.randomUUID(), user_id: order.user_id, type: 'market_transfer', amount: energyCost,
          from_user_id: order.provider_id, status: 'completed',
          description: `购买产品 ${product.name} 支付市场费`, created_at: new Date().toISOString(),
        });
      }

      // ========== 发放市场分润给服务商 ==========
      const providerShare = energyCost * 0.70;
      const companyShare = energyCost * 0.05;

      // 给服务商增加能量值
      if (order.provider_id) {
        const providerRow = await queryOne('SELECT energy_value FROM users WHERE id = $1', [order.provider_id]);
        if (providerRow) {
          const newProvBalance = (parseFloat(String(providerRow.energy_value)) || 0) + providerShare;
          await execute('UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2', [newProvBalance, order.provider_id]);

          await client.from('energy_transactions').insert({
            id: crypto.randomUUID(), user_id: order.provider_id, type: 'market_share', amount: providerShare,
            from_user_id: order.user_id, status: 'completed',
            description: '会员购买产品市场分润（70%）', created_at: new Date().toISOString(),
          });
        }
      }
    }

    // 创建用户产品记录
    const { error: createUserProductError } = await client
      .from('user_products')
      .insert({
        user_id: order.user_id,
        product_id: order.product_id,
        purchase_price: price,
        purchase_date: purchaseDate.toISOString(),
        expire_date: expireDate.toISOString(),
        expected_profit: expectedProfit,
        market_fee: marketFee,
        status: 'holding'
      });

    if (createUserProductError) {
      throw new Error(`创建用户产品失败: ${createUserProductError.message}`);
    }

    // 更新产品状态
    await client
      .from('products')
      .update({ status: 'sold', updated_at: new Date().toISOString() })
      .eq('id', order.product_id);

    return NextResponse.json({
      success: true,
      message: '收款确认成功，产品已发放'
    });
  } catch (error) {
    console.error('确认收款失败:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
