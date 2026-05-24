import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { getSupabaseUrl, getSupabaseServiceRoleKey } from '@/lib/env';
import { execute, queryOne } from '@/lib/pg-client';

function getAdminSupabase() {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) throw new Error('Missing Supabase configuration');
  return createClient(url, key);
}

// 服务商确认收款（确认线下收到Token值后执行）
// 新流程：确认后产品进入持有状态，总台释放5%收益按7项分配
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const providerId = authUser.userId;
    const body = await request.json();
    const { orderId } = body;

    if (!orderId) return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });

    const client = getAdminSupabase();

    // 查询订单
    const { data: order, error: orderError } = await client
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) throw new Error(`查询订单失败: ${orderError.message}`);
    if (!order) return NextResponse.json({ error: '订单不存在' }, { status: 404 });
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

    if (order.product_id) {
      const { data: product, error: productError } = await client
        .from('products')
        .select('*')
        .eq('id', order.product_id)
        .maybeSingle();

      if (productError) throw new Error(`查询产品失败: ${productError.message}`);
      if (!product) return NextResponse.json({ error: '产品不存在' }, { status: 404 });
      if (product.provider_id !== providerId) {
        return NextResponse.json({ error: '无权操作此订单' }, { status: 403 });
      }

      price = parseFloat(product.price);
      productName = product.name;

      // 更新已有的 user_products 记录（pending_confirm → holding）
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

        if (updateUPError) throw new Error(`更新持仓记录失败: ${updateUPError.message}`);
        userProduct = updatedUP;
      } else {
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
            status: 'holding',
            seller_id: providerId,
            transfer_type: 'provider_match',
          })
          .select()
          .single();

        if (createUserProductError) {
          await client.from('orders').update({ status: 'pending' }).eq('id', orderId);
          throw new Error(`创建用户产品记录失败: ${createUserProductError.message}`);
        }
        userProduct = newUserProduct;
      }

      // 更新产品状态为已售
      await client.from('products').update({
        status: 'sold',
        updated_at: new Date().toISOString(),
      }).eq('id', order.product_id);

      // ========== 总台释放5%收益，按6项分配（无高级服务商） ==========
      const releaseAmount = price * 0.05;

      const memberShare = Math.round(price * 0.02 * 100) / 100;
      const directReward = Math.round(price * 0.0025 * 100) / 100;
      const providerShare = Math.round(price * 0.02 * 100) / 100;
      const parentShare = Math.round(price * 0.0025 * 100) / 100;
      const branchShare = Math.round(price * 0.001 * 100) / 100;
      const companyBaseShare = Math.round(price * 0.004 * 100) / 100;

      // 获取会员信息
      const member = await queryOne('SELECT id, inviter_id, provider_id, username FROM users WHERE id = $1', [order.user_id]);

      // 1. 会员2% → balance
      if (memberShare > 0) {
        await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [memberShare, order.user_id]);
      }

      // 2. 直推人0.25% → balance
      let directRewardTo: string | null = null;
      if (directReward > 0 && member?.inviter_id) {
        const inviter = await queryOne('SELECT id FROM users WHERE id = $1', [member.inviter_id]);
        if (inviter) {
          directRewardTo = inviter.id;
          await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [directReward, inviter.id]);
        }
      }

      // 3. 服务商2% → balance
      if (providerShare > 0) {
        await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [providerShare, providerId]);
      }

      // 4. 下级服务商0.25% → balance
      const providerInfo = await queryOne('SELECT branch_id, parent_provider_id FROM providers WHERE user_id = $1', [providerId]);
      let actualParentProviderId: string | null = null;
      if (providerInfo?.parent_provider_id && parentShare > 0) {
        const parentProvider = await queryOne('SELECT user_id FROM providers WHERE id = $1', [providerInfo.parent_provider_id]);
        if (parentProvider?.user_id) {
          actualParentProviderId = providerInfo.parent_provider_id;
          await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [parentShare, parentProvider.user_id]);
        }
      }

      // 5. 服务网点0.1% → balance
      let distributionBranchId: string | null = providerInfo?.branch_id || null;
      if (providerInfo?.branch_id && branchShare > 0) {
        await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [branchShare, providerInfo.branch_id]);
      }

      // 6. 总台运营0.4%（+无上级时的0.25%）→ balance
      const noParentExtra = actualParentProviderId ? 0 : parentShare;
      const finalCompanyShare = companyBaseShare + noParentExtra;
      if (finalCompanyShare > 0) {
        const adminUser = await queryOne("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
        if (adminUser) {
          await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [finalCompanyShare, adminUser.id]);
        }
      }

      // 记录释放收益
      try {
        await execute(
          `INSERT INTO release_records 
           (product_id, product_name, product_price, release_amount, release_rate,
            member_id, member_name, member_share,
            direct_referral_id, direct_referral_share,
            provider_id, provider_share,
            parent_provider_id, parent_provider_share,
            senior_provider_id, senior_provider_share,
            branch_id, branch_share, company_share)
           VALUES ($1, $2, $3, $4, 0.05, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
          [
            product.id, productName, price, releaseAmount,
            order.user_id, member?.username || order.user_id, memberShare,
            directRewardTo, directReward,
            providerId, providerShare,
            actualParentProviderId, actualParentProviderId ? parentShare : 0,
            null, 0,
            distributionBranchId, branchShare, finalCompanyShare
          ]
        );
      } catch (e) {
        console.error('记录释放收益失败:', e);
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
      data: { order, userProduct, message: '收款已确认，产品分配成功，收益已释放' },
    });
  } catch (error) {
    console.error('确认收款失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '确认收款失败' },
      { status: 500 }
    );
  }
}
