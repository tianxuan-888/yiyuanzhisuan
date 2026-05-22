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

    // ========== 扣除会员收益（旧流程：审核时才扣除）==========
    if (energyCost > 0) {
      await execute('UPDATE users SET energy_value = COALESCE(energy_value, 0) - $1, updated_at = NOW() WHERE id = $2', [energyCost, order.user_id]);
      await execute('UPDATE energy_accounts SET balance = balance - $1, total_out = total_out + $1 WHERE user_id = $2', [energyCost, order.user_id]);

      await client.from('energy_transactions').insert({
        id: crypto.randomUUID(), user_id: order.user_id, type: 'spend', amount: energyCost,
        note: `购买产品 ${product.name} 支付市场费(${(marketRate * 100).toFixed(1)}%)`, created_at: new Date().toISOString(),
      });

      // ========== 收益分配（市场费→各角色balance收益，按产品价格比例）==========
      // 会员2% + 直推0.3% + 服务商2% + 上级服务商0.3% + 高级服务商0.15% + 服务网点0.15% + 智算平台运营0.10% = 5%
      const memberShare = Math.round(price * 0.02 * 100) / 100;
      const directReward = Math.round(price * 0.003 * 100) / 100;
      const providerShare = Math.round(price * 0.02 * 100) / 100;
      const parentProviderShare = Math.round(price * 0.003 * 100) / 100;
      const seniorProviderShare = Math.round(price * 0.0015 * 100) / 100;
      const branchShare = Math.round(price * 0.0015 * 100) / 100;
      const companyShare = Math.round(price * 0.001 * 100) / 100;

      // 1. 会员收益返还2%
      if (memberShare > 0) {
        await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [memberShare, order.user_id]);
      }

      // 2. 给直推人增加收益余额（0.3%）
      const member = await queryOne('SELECT id, inviter_id FROM users WHERE id = $1', [order.user_id]);
      let directRewardTo = null;
      if (member?.inviter_id && directReward > 0) {
        directRewardTo = member.inviter_id;
        await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [directReward, member.inviter_id]);
      }

      // 3. 给服务商增加收益余额（2%）
      if (order.provider_id && providerShare > 0) {
        await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [providerShare, order.provider_id]);
      }

      // 4. 给上级服务商增加收益余额（0.3%）—— 无上级则归智算平台运营
      const providerInfo = await queryOne('SELECT branch_id, parent_provider_id FROM providers WHERE user_id = $1', [order.provider_id]);
      let actualParentProviderId = providerInfo?.parent_provider_id || null;
      if (providerInfo?.parent_provider_id && parentProviderShare > 0) {
        const parentProvider = await queryOne('SELECT user_id FROM providers WHERE id = $1', [providerInfo.parent_provider_id]);
        if (parentProvider?.user_id) {
          await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [parentProviderShare, parentProvider.user_id]);
        }
      }

      // 5. 给高级服务商增加收益余额（0.15%）—— 向上查找最近的高级服务商，无则归智算平台运营
      let actualSeniorProviderId: string | null = null;
      if (providerInfo?.parent_provider_id) {
        let currentProviderId = providerInfo.parent_provider_id;
        let depth = 0;
        while (currentProviderId && depth < 20) {
          const sp: any = await queryOne('SELECT id, user_id, parent_provider_id, is_senior FROM providers WHERE id = $1', [currentProviderId]);
          if (!sp) break;
          if (sp.is_senior) {
            actualSeniorProviderId = sp.id;
            await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [seniorProviderShare, sp.user_id]);
            break;
          }
          currentProviderId = sp.parent_provider_id;
          depth++;
        }
      }

      // 6. 给服务网点增加收益余额（0.15%）
      if (providerInfo?.branch_id && branchShare > 0) {
        await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [branchShare, providerInfo.branch_id]);
      }

      // 7. 给智算平台运营增加收益余额（0.10% + 无上级服务商时的0.3% + 无高级服务商时的0.15%）
      const noParentExtra = actualParentProviderId ? 0 : parentProviderShare;
      const noSeniorExtra = actualSeniorProviderId ? 0 : seniorProviderShare;
      const finalCompanyShare = companyShare + noParentExtra + noSeniorExtra;
      if (finalCompanyShare > 0) {
        const adminUser = await queryOne("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
        if (adminUser) {
          await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [finalCompanyShare, adminUser.id]);
        }
      }

      // 记录收益分配明细
      const branchId = providerInfo?.branch_id || null;
      const distId = crypto.randomUUID();
      await execute(
        `INSERT INTO provider_revenue_distribution 
          (id, order_id, product_id, provider_id, member_id, member_inviter_id, product_price,
           market_fee, provider_share, direct_reward, direct_reward_to,
           parent_provider_id, parent_provider_share, branch_id, branch_share, company_share, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())`,
        [
          distId, orderId, product.id, order.provider_id, order.user_id, member?.inviter_id || null, price,
          marketFee.toFixed(2), providerShare.toFixed(2),
          directReward.toFixed(2), directRewardTo,
          actualParentProviderId || null,
          actualParentProviderId ? parentProviderShare.toFixed(2) : '0',
          branchId, branchShare.toFixed(2),
          finalCompanyShare.toFixed(2), 'completed',
        ]
      );
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
      seller_id: null, transfer_type: 'provider_match',
    });

    // 更新产品状态
    await client.from('products').update({ status: 'sold', updated_at: new Date().toISOString() }).eq('id', order.product_id);

    return NextResponse.json({ success: true, message: '收款确认成功，产品已发放' });
  } catch (error) {
    console.error('确认收款失败:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
