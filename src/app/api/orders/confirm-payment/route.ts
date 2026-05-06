import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { execute, queryOne } from '@/lib/pg-client';

// 服务商确认收款接口（旧流程兼容）
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { orderId } = body;

    if (!orderId) {
      return NextResponse.json({ error: '订单ID不能为空' }, { status: 400 });
    }

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

    if (orderError) throw new Error(`查询订单失败: ${orderError.message}`);
    if (!order) return NextResponse.json({ error: '订单不存在' }, { status: 404 });
    if (order.status !== 'pending') return NextResponse.json({ error: '订单状态不正确' }, { status: 400 });

    if (user.role === 'provider' && order.provider_id !== user.userId) {
      return NextResponse.json({ error: '无权操作此订单' }, { status: 403 });
    }

    const energyCost = order.energy_cost || 0;

    // 查询产品信息
    const { data: product, error: productError } = await client
      .from('products')
      .select('*')
      .eq('id', order.product_id)
      .maybeSingle();

    if (productError) throw new Error(`查询产品失败: ${productError.message}`);
    if (!product) return NextResponse.json({ error: '产品不存在' }, { status: 404 });

    const price = parseFloat(product.price);
    const marketRate = parseFloat(product.market_rate) / 100;
    const marketFee = price * marketRate;

    // 更新订单状态
    const { error: updateError } = await client
      .from('orders')
      .update({ status: 'completed', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('status', 'pending');

    if (updateError) throw new Error(`更新订单失败: ${updateError.message}`);

    // ========== 扣除会员能量值（旧流程：审核时才扣除）==========
    if (energyCost > 0) {
      await execute('UPDATE users SET energy_value = COALESCE(energy_value, 0) - $1, updated_at = NOW() WHERE id = $2', [energyCost, order.user_id]);
      await execute('UPDATE energy_accounts SET balance = balance - $1, total_out = total_out + $1 WHERE user_id = $2', [energyCost, order.user_id]);

      await client.from('energy_transactions').insert({
        id: crypto.randomUUID(), user_id: order.user_id, type: 'spend', amount: energyCost,
        note: `购买产品 ${product.name} 支付市场费(${(marketRate * 100).toFixed(1)}%)`, created_at: new Date().toISOString(),
      });

      // ========== 收益分配（市场费→各角色balance收益）==========
      const providerShare = Math.round(energyCost * 0.70 * 100) / 100;
      const directReward = Math.round(energyCost * 0.10 * 100) / 100;
      const parentProviderShare = Math.round(energyCost * 0.10 * 100) / 100;
      const branchShare = Math.round(energyCost * 0.05 * 100) / 100;
      const companyShare = Math.round(energyCost * 0.05 * 100) / 100;

      // 1. 给服务商增加收益余额（70%）
      if (order.provider_id && providerShare > 0) {
        await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [providerShare, order.provider_id]);
      }

      // 2. 给直推人增加收益余额（10%）
      const member = await queryOne('SELECT id, inviter_id FROM users WHERE id = $1', [order.user_id]);
      let directRewardTo = null;
      if (member?.inviter_id && directReward > 0) {
        directRewardTo = member.inviter_id;
        await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [directReward, member.inviter_id]);
      }

      // 3. 给上级服务商增加收益余额（10%）—— 无上级则归总公司
      const providerInfo = await queryOne('SELECT branch_id, parent_provider_id FROM providers WHERE user_id = $1', [order.provider_id]);
      let actualParentProviderId = providerInfo?.parent_provider_id || null;
      if (providerInfo?.parent_provider_id && parentProviderShare > 0) {
        const parentProvider = await queryOne('SELECT user_id FROM providers WHERE id = $1', [providerInfo.parent_provider_id]);
        if (parentProvider?.user_id) {
          await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [parentProviderShare, parentProvider.user_id]);
        }
      } else if (parentProviderShare > 0) {
        // 无上级服务商，10%归总公司
        const adminUser = await queryOne("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
        if (adminUser) {
          await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [parentProviderShare, adminUser.id]);
          actualParentProviderId = null;
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
      const finalCompanyShare = companyShare + (actualParentProviderId ? 0 : parentProviderShare);
      await client.from('provider_revenue_distribution').insert({
        order_id: orderId, product_id: product.id, provider_id: order.provider_id, member_id: order.user_id,
        market_fee: marketFee.toFixed(2), provider_share: providerShare.toFixed(2),
        direct_reward: directReward.toFixed(2), direct_reward_to: directRewardTo,
        parent_provider_id: actualParentProviderId,
        parent_provider_share: actualParentProviderId ? parentProviderShare.toFixed(2) : '0',
        branch_id: providerInfo?.branch_id || null, branch_share: branchShare.toFixed(2),
        company_share: finalCompanyShare.toFixed(2), status: 'completed', created_at: new Date().toISOString(),
      });
    }

    // 创建用户产品记录
    const purchaseDate = new Date();
    const expireDate = new Date(purchaseDate.getTime() + product.period * 24 * 60 * 60 * 1000);
    const totalRate = parseFloat(product.total_rate) / 100;
    const expectedProfit = price * totalRate;

    await client.from('user_products').insert({
      user_id: order.user_id, product_id: order.product_id,
      purchase_price: price, purchase_date: purchaseDate.toISOString(),
      expire_date: expireDate.toISOString(), expected_profit: expectedProfit.toFixed(2),
      market_fee: marketFee.toFixed(2), status: 'holding',
    });

    // 更新产品状态
    await client.from('products').update({ status: 'sold', updated_at: new Date().toISOString() }).eq('id', order.product_id);

    return NextResponse.json({ success: true, message: '收款确认成功，产品已发放' });
  } catch (error) {
    console.error('确认收款失败:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
