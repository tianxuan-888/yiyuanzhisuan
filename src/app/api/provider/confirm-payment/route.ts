import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
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

// 服务商确认收款接口
// 新流程：购买时已创建 user_products(pending_confirm) + 扣除能量值
// 确认时：更新 user_products → holding, 产品 → sold, 分配收益
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
      .eq('status', 'pending')
      .select();

    if (updateOrderStatusError || !updateData || updateData.length === 0) {
      return NextResponse.json({ error: '订单已被处理，请刷新页面' }, { status: 400 });
    }

    let userProduct = null;
    let price = 0;
    let productName = '';
    let marketFee = 0;

    // 如果有 product_id，验证服务商权限并更新用户产品记录
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
      marketFee = price * (parseFloat(product.market_rate) / 100);

      // ========== 持仓金额检查（上限2万）==========
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

      // ========== 更新已有的 user_products 记录（pending_confirm → holding）==========
      if (order.user_product_id) {
        const { data: updatedUP, error: updateUPError } = await client
          .from('user_products')
          .update({
            status: 'holding',
            purchase_date: new Date().toISOString(),
            expire_date: new Date(Date.now() + product.period * 24 * 60 * 60 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.user_product_id)
          .eq('status', 'pending_confirm')
          .select()
          .single();

        if (updateUPError) {
          console.error('更新持仓记录失败:', updateUPError);
          throw new Error(`更新持仓记录失败: ${updateUPError.message}`);
        }

        userProduct = updatedUP;
      } else {
        // 兼容旧流程：没有 user_product_id 时创建新记录
        const purchaseDate = new Date();
        const expireDate = new Date(purchaseDate);
        expireDate.setDate(expireDate.getDate() + product.period);

        const totalRate = parseFloat(product.total_rate) / 100;
        const expectedProfit = price * totalRate;

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
            energy_cost: order.energy_cost || marketFee,
            status: 'holding',
          })
          .select()
          .single();

        if (createUserProductError) {
          await client
            .from('orders')
            .update({ status: 'pending' })
            .eq('id', orderId);
          throw new Error(`创建用户产品记录失败: ${createUserProductError.message}`);
        }

        userProduct = newUserProduct;
      }

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

      // ========== 收益分配（市场费→各角色balance收益，不再是energy_value）==========
      if (marketFee > 0) {
        const providerShare = Math.round(marketFee * 0.70 * 100) / 100;
        const directReward = Math.round(marketFee * 0.10 * 100) / 100;
        const parentProviderShare = Math.round(marketFee * 0.10 * 100) / 100;
        const branchShare = Math.round(marketFee * 0.05 * 100) / 100;
        const companyShare = Math.round(marketFee * 0.05 * 100) / 100;

        // 1. 给服务商增加收益余额（70%）
        if (providerShare > 0) {
          await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [providerShare, providerId]);
        }

        // 2. 给直推人增加收益余额（10%）
        const member = await queryOne('SELECT id, inviter_id, provider_id FROM users WHERE id = $1', [order.user_id]);
        let directRewardTo = null;
        if (member?.inviter_id) {
          const inviter = await queryOne('SELECT id FROM users WHERE id = $1', [member.inviter_id]);
          if (inviter) {
            directRewardTo = inviter.id;
            if (directReward > 0) {
              await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [directReward, inviter.id]);
            }
          }
        }

        // 3. 给上级服务商增加收益余额（10%）
        const providerInfo = await queryOne('SELECT branch_id, parent_provider_id FROM providers WHERE user_id = $1', [providerId]);

        if (providerInfo?.parent_provider_id && parentProviderShare > 0) {
          const parentProvider = await queryOne('SELECT user_id FROM providers WHERE id = $1', [providerInfo.parent_provider_id]);
          if (parentProvider?.user_id) {
            await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [parentProviderShare, parentProvider.user_id]);
          }
        }

        // 4. 给分公司增加收益余额（5%）
        if (providerInfo?.branch_id && branchShare > 0) {
          await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [branchShare, providerInfo.branch_id]);
        }

        // 5. 给总公司增加收益余额（5%）
        if (companyShare > 0) {
          const adminUser = await queryOne("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
          if (adminUser) {
            await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [companyShare, adminUser.id]);
          }
        }

        // 记录收益分配明细
        await client.from('provider_revenue_distribution').insert({
          order_id: orderId, product_id: product.id, provider_id: providerId, member_id: order.user_id,
          market_fee: marketFee.toFixed(2), provider_share: providerShare.toFixed(2),
          direct_reward: directReward.toFixed(2), direct_reward_to: directRewardTo,
          parent_provider_id: providerInfo?.parent_provider_id || null,
          parent_provider_share: parentProviderShare.toFixed(2),
          branch_id: providerInfo?.branch_id || null, branch_share: branchShare.toFixed(2),
          company_share: companyShare.toFixed(2), status: 'completed', created_at: new Date().toISOString(),
        });
      }

      // 发送通知给会员
      await client.from('notifications').insert({
        receiver_id: order.user_id, receiver_role: 'member', sender_id: providerId,
        sender_name: '系统通知', type: 'buy_confirmed', title: '购买申请已确认',
        content: `您购买的产品 ${productName} 已分配成功`, amount: price, related_id: userProduct?.id,
      });
    }

    // 最后更新订单状态为已完成
    await client.from('orders').update({ 
      status: 'completed', user_product_id: userProduct?.id || order.user_product_id || null,
      payment_confirmed: true, payment_confirmed_at: new Date().toISOString(),
      payment_confirmed_by: providerId, updated_at: new Date().toISOString(),
    }).eq('id', orderId);

    return NextResponse.json({
      success: true,
      data: { order, userProduct, message: '收款已确认，产品分配成功' },
    });
  } catch (error) {
    console.error('确认收款失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '确认收款失败' },
      { status: 500 }
    );
  }
}
