import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ success: false, message: '无效token' }, { status: 401 });
    }

    if (user.role !== 'provider' && user.role !== 'admin') {
      return NextResponse.json({ success: false, message: '仅服务商可操作' }, { status: 403 });
    }

    const body = await request.json();
    const { productIds } = body as { productIds: string[] };

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json({ success: false, message: '缺少产品ID列表' }, { status: 400 });
    }

    console.log('[MATCH CONFIRM] 确认匹配:', { productIds, userId: user.userId });

    // 获取所有待确认的产品
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, price, period, total_rate, profit_rate, status, provider_id, previous_holder_id, pending_match_user_id')
      .in('id', productIds);

    if (productsError || !products || products.length === 0) {
      return NextResponse.json({ success: false, message: '未找到产品' }, { status: 404 });
    }

    const results: { productId: string; success: boolean; message: string }[] = [];

    for (const product of products) {
      // 验证
      if (product.provider_id !== user.userId) {
        results.push({ productId: product.id, success: false, message: '无权操作' });
        continue;
      }
      if (product.status !== 'pending_match') {
        results.push({ productId: product.id, success: false, message: '产品状态不允许' });
        continue;
      }
      if (!product.pending_match_user_id) {
        results.push({ productId: product.id, success: false, message: '未指定匹配会员' });
        continue;
      }

      // 检查目标会员
      const { data: targetUser } = await supabase
        .from('users')
        .select('id, username, balance, provider_id, inviter_id')
        .eq('id', product.pending_match_user_id)
        .single();

      if (!targetUser) {
        results.push({ productId: product.id, success: false, message: '目标会员不存在' });
        continue;
      }

      const profitAmount = product.price * (product.profit_rate / 100);

      // === 匹配成功，执行所有操作 ===
      // 不再扣除能量值，不再有市场费
      // 总台释放5%收益，按7项分配到各角色balance

      const releaseRate = 0.05; // 总台释放5%
      const memberShare = product.price * 0.02;       // 会员2%
      const directShare = product.price * 0.003;       // 直推0.3%
      const providerShare = product.price * 0.02;      // 服务商2%
      const parentProviderShare = product.price * 0.003; // 上级服务商0.3%
      const seniorProviderShare = product.price * 0.0015; // 高级服务商0.15%
      const branchShare = product.price * 0.0015;      // 服务网点0.15%
      const companyShare = product.price * 0.001;      // 智算平台运营0.10%
      const totalReleased = product.price * releaseRate;

      // 1. 会员收益
      await supabase.rpc('rpc_execute', {
        sql_query: `UPDATE users SET balance = COALESCE(balance, 0) + ${memberShare} WHERE id = '${targetUser.id}'`
      });

      // 2. 直推人收益
      if (targetUser.inviter_id) {
        await supabase.rpc('rpc_execute', {
          sql_query: `UPDATE users SET balance = COALESCE(balance, 0) + ${directShare} WHERE id = '${targetUser.inviter_id}'`
        });
      }

      // 3. 服务商收益
      await supabase.rpc('rpc_execute', {
        sql_query: `UPDATE users SET balance = COALESCE(balance, 0) + ${providerShare} WHERE id = '${user.userId}'`
      });

      // 4. 上级服务商收益
      if (targetUser.provider_id && targetUser.provider_id !== user.userId) {
        await supabase.rpc('rpc_execute', {
          sql_query: `UPDATE users SET balance = COALESCE(balance, 0) + ${parentProviderShare} WHERE id = '${targetUser.provider_id}'`
        });
      }

      // 5. 高级服务商收益（服务商的上级服务商）
      const { data: currentProviderData } = await supabase.from('users').select('provider_id').eq('id', user.userId).single();
      if (currentProviderData?.provider_id) {
        await supabase.rpc('rpc_execute', {
          sql_query: `UPDATE users SET balance = COALESCE(balance, 0) + ${seniorProviderShare} WHERE id = '${currentProviderData.provider_id}'`
        });
      }

      // 6. 服务网点收益
      const { data: providerData } = await supabase.from('providers').select('branch_id').eq('user_id', user.userId).single();
      if (providerData?.branch_id) {
        await supabase.rpc('rpc_execute', {
          sql_query: `UPDATE users SET balance = COALESCE(balance, 0) + ${branchShare} WHERE id = '${providerData.branch_id}'`
        });
      }

      // 7. 智算平台运营收益
      const { data: adminUser } = await supabase.from('users').select('id').eq('role', 'admin').limit(1);
      if (adminUser && adminUser[0]) {
        await supabase.rpc('rpc_execute', {
          sql_query: `UPDATE users SET balance = COALESCE(balance, 0) + ${companyShare} WHERE id = '${adminUser[0].id}'`
        });
      }

      // 8. 创建释放收益记录
      await supabase.from('release_records').insert({
        product_id: product.id,
        product_name: product.name,
        product_price: product.price,
        release_amount: totalReleased,
        release_rate: releaseRate,
        member_id: targetUser.id,
        member_name: targetUser.username,
        member_share: memberShare,
        direct_referral_id: targetUser.inviter_id || null,
        direct_referral_share: directShare,
        provider_id: user.userId,
        provider_share: providerShare,
        parent_provider_id: targetUser.provider_id || null,
        parent_provider_share: parentProviderShare,
        senior_provider_id: currentProviderData?.provider_id || null,
        senior_provider_share: seniorProviderShare,
        branch_id: providerData?.branch_id || null,
        branch_share: branchShare,
        company_share: companyShare
      });

      // 9. 更新原持有人的user_product状态为transferred
      // Token值随产品流转到新持有人，不进智算金（线下交易处理）
      if (product.previous_holder_id) {
        await supabase.rpc('rpc_execute', {
          sql_query: `UPDATE user_products SET status = 'transferred' WHERE user_id = '${product.previous_holder_id}' AND product_id = '${product.id}' AND status = 'pending_sell'`
        });
      }

      // 10. 创建新持有记录（不再扣除市场费）
      const now = new Date();
      const expireDate = new Date(now.getTime() + product.period * 24 * 60 * 60 * 1000);

      const { error: upError } = await supabase
        .from('user_products')
        .insert({
          user_id: targetUser.id,
          product_id: product.id,
          purchase_price: product.price,
          purchase_date: now.toISOString(),
          expire_date: expireDate.toISOString(),
          expected_profit: profitAmount,
          market_fee: 0, // 不再收取市场费
          seller_id: product.previous_holder_id || null,
          transfer_type: product.previous_holder_id ? 'member_transfer' : 'provider_match',
          status: 'holding'
        });

      if (upError) {
        console.error('[MATCH CONFIRM] 创建持有记录失败:', upError);
        results.push({ productId: product.id, success: false, message: '创建持有记录失败' });
        continue;
      }

      // 11. 更新产品状态为sold，清除匹配信息
      await supabase.rpc('rpc_execute', {
        sql_query: `UPDATE products SET status = 'sold', pending_match_user_id = NULL WHERE id = '${product.id}'`
      });

      // 12. 创建订单记录
      await supabase.from('orders').insert({
        user_id: targetUser.id,
        user_product_id: null,
        order_type: 'buy',
        amount: product.price,
        status: 'completed'
      });

      // 13. 通知目标会员
      await supabase.from('notifications').insert({
        receiver_id: targetUser.id,
        receiver_role: 'member',
        type: 'product_matched',
        title: '产品匹配成功',
        content: `您已成功匹配产品「${product.name}」，金额¥${product.price}，到期收益¥${profitAmount}`,
        is_read: false
      });

      // 14. 通知原持有人Token值已转出
      if (product.previous_holder_id) {
        await supabase.from('notifications').insert({
          receiver_id: product.previous_holder_id,
          receiver_role: 'member',
          type: 'product_matched',
          title: '产品已转出',
          content: `您的产品「${product.name}」已成功匹配给新会员，Token值¥${product.price}随产品流转`,
          is_read: false
        });
      }

      console.log('[MATCH CONFIRM] 匹配成功，释放收益:', {
        productId: product.id,
        targetUser: targetUser.username,
        releaseAmount: totalReleased
      });
      results.push({ productId: product.id, success: true, message: '匹配成功' });
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return NextResponse.json({
      success: true,
      message: `匹配完成：${successCount}个成功，${failCount}个失败`,
      data: {
        results,
        successCount,
        failCount
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    console.error('[MATCH CONFIRM] 异常:', error);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
