import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 获取管理员 Supabase 客户端（绕过 RLS）
function getAdminSupabase() {
  const url = process.env.COZE_SUPABASE_URL;
  const key = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing Supabase configuration');
  }
  return createClient(url, key);
}

// 服务商确认收款接口
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅服务商可操作
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const providerId = authUser.userId;

    const body = await request.json();
    const { orderId } = body;

    if (!orderId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 使用管理员客户端绕过RLS
    const client = getAdminSupabase();

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
    if (!order.status) {
      return NextResponse.json({ error: '订单状态异常' }, { status: 400 });
    }
    
    if (order.status !== 'pending') {
      return NextResponse.json({ error: `订单状态为 ${order.status}，无法审核` }, { status: 400 });
    }

    // 先更新订单状态为已支付，防止重复点击
    const { error: updateOrderStatusError, data: updateData } = await client
      .from('orders')
      .update({ status: 'paid' })
      .eq('id', orderId)
      .eq('status', 'pending') // 只有pending状态才能更新
      .select();

    // 如果没有更新任何记录，说明订单已被处理
    if (updateOrderStatusError || !updateData || updateData.length === 0) {
      return NextResponse.json({ error: '订单已被处理，请刷新页面' }, { status: 400 });
    }

    let userProduct = null;
    let price = 0;
    let productName = '';

    // 如果有 product_id，验证服务商权限并创建用户产品记录
    if (order.product_id) {
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

      // 验证服务商权限
      if (product.provider_id !== providerId) {
        return NextResponse.json({ error: '无权操作此订单' }, { status: 403 });
      }

      price = parseFloat(product.price);
      productName = product.name;

      // ========== 持仓金额检查（上限2万）- 在确认支付时也要检查 ==========
      const maxHolding = 20000;
      const currentHoldingResult: any = await client
        .from('user_products')
        .select('purchase_price')
        .eq('user_id', order.user_id)
        .eq('status', 'holding');

      const currentHolding = (currentHoldingResult?.data || []).reduce(
        (sum: number, up: any) => sum + parseFloat(up.purchase_price || 0), 0
      );
      const newTotalHolding = currentHolding + price;

      if (newTotalHolding > maxHolding) {
        // 回滚订单状态
        await client
          .from('orders')
          .update({ status: 'pending' })
          .eq('id', orderId)
          .eq('status', 'paid');

        return NextResponse.json({
          success: false,
          error: '持仓金额超限',
          data: {
            code: 'HOLDING_LIMIT',
            message: `购买后持仓金额为 ${newTotalHolding.toLocaleString()} 元，超过上限 ${maxHolding.toLocaleString()} 元`,
            currentHolding,
            productPrice: price,
            maxHolding,
          }
        }, { status: 400 });
      }

      // 计算到期日期、预期收益、市场费用
      const purchaseDate = new Date();
      const expireDate = new Date(purchaseDate);
      expireDate.setDate(expireDate.getDate() + product.period);

      const totalRate = parseFloat(product.total_rate) / 100;
      const marketRate = parseFloat(product.market_rate) / 100;

      const expectedProfit = price * totalRate;
      const marketFee = price * marketRate;

      // 创建用户产品记录
      const { data: newUserProduct, error: createUserProductError } = await client
        .from('user_products')
        .insert({
          user_id: order.user_id,
          product_id: order.product_id,
          purchase_price: product.price,
          purchase_date: purchaseDate.toISOString(),
          expire_date: expireDate.toISOString(),
          expected_profit: expectedProfit.toFixed(2),
          market_fee: marketFee.toFixed(2),
          status: 'holding',
        })
        .select()
        .single();

      if (createUserProductError) {
        // 回滚订单状态
        await client
          .from('orders')
          .update({ status: 'pending' })
          .eq('id', orderId);
        throw new Error(`创建用户产品记录失败: ${createUserProductError.message}`);
      }

      userProduct = newUserProduct;

      // 更新产品状态为已售
      const { error: updateProductError } = await client
        .from('products')
        .update({
          status: 'sold',
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.product_id);

      if (updateProductError) {
        throw new Error(`更新产品状态失败: ${updateProductError.message}`);
      }

      // 计算收益分配（基于市场费）- marketFee 已在上面定义
      const providerShare = marketFee * 0.70;  // 服务商获得70%
      const directReward = marketFee * 0.10;   // 直推奖励10%
      const parentProviderShare = marketFee * 0.10; // 上级服务商10%
      const branchShare = marketFee * 0.05;    // 分公司5%
      const companyShare = marketFee * 0.05;   // 公司运营5%

      // ========== 能量值变动逻辑 ==========
      // 1. 扣除会员能量值（市场费）
      if (marketFee > 0) {
        // 更新会员能量值
        const { data: memberData } = await client
          .from('users')
          .select('energy_value')
          .eq('id', order.user_id)
          .single();
        
        if (memberData) {
          const newMemberBalance = Math.max(0, (parseFloat(memberData.energy_value) || 0) - marketFee);
          await client
            .from('users')
            .update({ energy_value: newMemberBalance })
            .eq('id', order.user_id);
          
          // 记录会员能量值减少
          await client
            .from('energy_transactions')
            .insert({
              id: crypto.randomUUID(),
              user_id: order.user_id,
              type: 'market_transfer',
              amount: marketFee,
              from_user_id: providerId,
              to_user_id: null,
              status: 'completed',
              description: `购买产品 ${productName} 支付市场费`,
              created_at: new Date().toISOString(),
            });
        }

        // 2. 给服务商增加能量值（70%）
        if (providerShare > 0) {
          const { data: providerData } = await client
            .from('users')
            .select('energy_value')
            .eq('id', providerId)
            .single();
          
          if (providerData) {
            const newProviderBalance = (parseFloat(providerData.energy_value) || 0) + providerShare;
            await client
              .from('users')
              .update({ energy_value: newProviderBalance })
              .eq('id', providerId);
            
            // 记录服务商能量值增加
            await client
              .from('energy_transactions')
              .insert({
                id: crypto.randomUUID(),
                user_id: providerId,
                type: 'market_share',
                amount: providerShare,
                from_user_id: order.user_id,
                to_user_id: null,
                status: 'completed',
                description: `会员购买产品市场分润（70%）`,
                created_at: new Date().toISOString(),
              });
          }
        }
      }

      // 查询服务商信息（获取分公司ID和上级服务商）
      const { data: providerInfo, error: providerInfoError } = await client
        .from('providers')
        .select('branch_id, parent_provider_id')
        .eq('user_id', providerId)
        .maybeSingle();

      // 查询会员的推荐人
      const { data: member, error: memberError } = await client
        .from('users')
        .select('id, inviter_id, provider_id')
        .eq('id', order.user_id)
        .maybeSingle();

      // 查询直推人
      let directRewardTo = null;
      if (member?.inviter_id) {
        const { data: inviter } = await client
          .from('users')
          .select('id')
          .eq('id', member.inviter_id)
          .maybeSingle();
        if (inviter) {
          directRewardTo = inviter.id;
        }
      }

      // 记录收益分配到 provider_revenue_distribution 表
      await client
        .from('provider_revenue_distribution')
        .insert({
          order_id: orderId,
          product_id: product.id,
          provider_id: providerId,
          member_id: order.user_id,
          market_fee: marketFee.toFixed(2),
          provider_share: providerShare.toFixed(2),
          direct_reward: directReward.toFixed(2),
          direct_reward_to: directRewardTo,
          parent_provider_id: providerInfo?.parent_provider_id || null,
          parent_provider_share: parentProviderShare.toFixed(2),
          branch_id: providerInfo?.branch_id || null,
          branch_share: branchShare.toFixed(2),
          company_share: companyShare.toFixed(2),
          status: 'pending',
          created_at: new Date().toISOString(),
        });

      // 发送通知给会员
      await client
        .from('notifications')
        .insert({
          receiver_id: order.user_id,
          receiver_role: 'member',
          sender_id: providerId,
          sender_name: '系统通知',
          type: 'buy_confirmed',
          title: '购买申请已确认',
          content: `您购买的产品 ${productName} 已分配成功`,
          amount: price,
          related_id: userProduct?.id,
        });
    }

    // 最后更新订单状态为已完成
    await client
      .from('orders')
      .update({ 
        status: 'completed',
        user_product_id: userProduct?.id || null,
        payment_confirmed: true,
        payment_confirmed_at: new Date().toISOString(),
        payment_confirmed_by: providerId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    return NextResponse.json({
      success: true,
      data: {
        order,
        userProduct,
        message: '收款已确认，产品分配成功',
      },
    });
  } catch (error) {
    console.error('确认收款失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '确认收款失败' },
      { status: 500 }
    );
  }
}
