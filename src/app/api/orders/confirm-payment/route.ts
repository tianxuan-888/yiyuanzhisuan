import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { execute, queryOne } from '@/lib/pg-client';

// 服务商确认收款接口
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

    // 查询产品信息
    const { data: product, error: productError } = await client
      .from('products')
      .select('*')
      .eq('id', order.product_id)
      .maybeSingle();

    if (productError) throw new Error(`查询产品失败: ${productError.message}`);
    if (!product) return NextResponse.json({ error: '产品不存在' }, { status: 404 });

    const price = parseFloat(product.price);

    // 更新订单状态
    const { error: updateError } = await client
      .from('orders')
      .update({ status: 'completed', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('status', 'pending');

    if (updateError) throw new Error(`更新订单失败: ${updateError.message}`);

    // ========== 总台释放5%收益，按6项分配（无高级服务商） ==========
    const releaseRate = 0.05;
    const memberShare = Math.round(price * 0.02 * 100) / 100;
    const directShare = Math.round(price * 0.0025 * 100) / 100;
    const providerShare = Math.round(price * 0.02 * 100) / 100;
    const parentProviderShare = Math.round(price * 0.0025 * 100) / 100;
    const branchShare = Math.round(price * 0.001 * 100) / 100;
    const companyBaseShare = Math.round(price * 0.004 * 100) / 100;
    const totalReleased = price * releaseRate;

    // 1. 会员收益2%
    if (memberShare > 0) {
      await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [memberShare, order.user_id]);
    }

    // 2. 直推人0.25%
    const member = await queryOne('SELECT id, inviter_id FROM users WHERE id = $1', [order.user_id]);
    let directRewardTo: string | null = null;
    if (member?.inviter_id && directShare > 0) {
      directRewardTo = member.inviter_id;
      await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [directShare, member.inviter_id]);
    }

    // 3. 服务商2%
    if (order.provider_id && providerShare > 0) {
      await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [providerShare, order.provider_id]);
    }

    // 4. 下级服务商0.25%
    const providerInfo = await queryOne('SELECT branch_id, parent_provider_id FROM providers WHERE user_id = $1', [order.provider_id]);
    let actualParentProviderId: string | null = null;
    if (providerInfo?.parent_provider_id && parentProviderShare > 0) {
      const parentProvider = await queryOne('SELECT user_id FROM providers WHERE id = $1', [providerInfo.parent_provider_id]);
      if (parentProvider?.user_id) {
        actualParentProviderId = providerInfo.parent_provider_id;
        await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [parentProviderShare, parentProvider.user_id]);
      }
    }

    // 5. 服务网点0.1%
    if (providerInfo?.branch_id && branchShare > 0) {
      await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [branchShare, providerInfo.branch_id]);
    }

    // 6. 总台运营0.4% + 无上级时的0.25%
    const noParentExtra = actualParentProviderId ? 0 : parentProviderShare;
    const finalCompanyShare = companyBaseShare + noParentExtra;
    if (finalCompanyShare > 0) {
      const adminUser = await queryOne("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      if (adminUser) {
        await execute('UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2', [finalCompanyShare, adminUser.id]);
      }
    }

    // 创建释放收益记录
    await execute(
      `INSERT INTO release_records 
        (product_id, product_name, product_price, release_amount, release_rate,
         member_id, member_name, member_share,
         direct_referral_id, direct_referral_share,
         provider_id, provider_share,
         parent_provider_id, parent_provider_share,
         senior_provider_id, senior_provider_share,
         branch_id, branch_share, company_share)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        product.id, product.name, price, totalReleased, releaseRate,
        order.user_id, member?.username || order.user_id, memberShare,
        directRewardTo, directShare,
        order.provider_id, providerShare,
        actualParentProviderId, actualParentProviderId ? parentProviderShare : 0,
        null, 0,
        providerInfo?.branch_id || null, branchShare, finalCompanyShare
      ]
    );

    // 创建用户产品记录（不再收取市场费）
    const purchaseDate = new Date();
    const expireDate = new Date(purchaseDate.getTime() + product.period * 24 * 60 * 60 * 1000);
    const totalRate = parseFloat(product.total_rate) / 100;
    const expectedProfit = price * totalRate;

    await client.from('user_products').insert({
      user_id: order.user_id, product_id: order.product_id,
      purchase_price: price, purchase_date: purchaseDate.toISOString(),
      expire_date: expireDate.toISOString(), expected_profit: expectedProfit.toFixed(2),
      market_fee: 0, status: 'holding',
      seller_id: null, transfer_type: 'provider_match',
    });

    // 更新产品状态
    await client.from('products').update({ status: 'sold', updated_at: new Date().toISOString() }).eq('id', order.product_id);

    return NextResponse.json({ success: true, message: '收款确认成功，产品已发放，收益已释放' });
  } catch (error) {
    console.error('确认收款失败:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
