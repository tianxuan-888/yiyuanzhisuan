import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    // 验证token
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, message: '未授权' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    let user: { userId: string; role: string };
    try {
      user = JSON.parse(Buffer.from(token, 'base64').toString());
    } catch {
      return NextResponse.json({ success: false, message: '无效token' }, { status: 401 });
    }

    if (user.role !== 'provider') {
      return NextResponse.json({ success: false, message: '仅服务商可操作' }, { status: 403 });
    }

    const body = await request.json();
    const { productIds } = body as { productIds: string[] };

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json({ success: false, message: '缺少产品ID列表' }, { status: 400 });
    }

    // 获取所有待确认的产品
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, price, period, total_rate, market_rate, profit_rate, status, provider_id, previous_holder_id, pending_match_user_id')
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

      // 检查目标会员能量值
      const { data: targetUser } = await supabase
        .from('users')
        .select('id, username, energy_value, balance, provider_id')
        .eq('id', product.pending_match_user_id)
        .single();

      if (!targetUser) {
        results.push({ productId: product.id, success: false, message: '目标会员不存在' });
        continue;
      }

      const marketFee = product.price * (product.market_rate / 100);
      const profitAmount = product.price * (product.profit_rate / 100);

      if (targetUser.energy_value < marketFee) {
        // 能量值不足，清除匹配，回到待匹配列表
        await supabase
          .from('products')
          .update({ pending_match_user_id: null })
          .eq('id', product.id);
        results.push({ productId: product.id, success: false, message: `${targetUser.username}能量值不足(${targetUser.energy_value}/${marketFee})` });
        continue;
      }

      // === 匹配成功，执行所有操作 ===

      // 1. 扣除目标会员能量值
      const { error: deductError } = await supabase.rpc('rpc_execute', {
        sql_query: `UPDATE users SET energy_value = energy_value - ${marketFee} WHERE id = '${targetUser.id}' AND energy_value >= ${marketFee}`
      });
      if (deductError) {
        results.push({ productId: product.id, success: false, message: '扣除能量值失败' });
        continue;
      }

      // 2. 分配市场费到各角色收益(balance)
      const providerShare = marketFee * 0.70;
      const companyShare = marketFee * 0.05;
      const directShare = marketFee * 0.10;
      const parentProviderShare = marketFee * 0.10;
      const branchShare = marketFee * 0.05;

      // 服务商收益
      await supabase.rpc('rpc_execute', {
        sql_query: `UPDATE users SET balance = COALESCE(balance, 0) + ${providerShare} WHERE id = '${user.userId}'`
      });

      // 总公司收益
      const { data: adminUser } = await supabase.from('users').select('id').eq('role', 'admin').limit(1);
      if (adminUser && adminUser[0]) {
        await supabase.rpc('rpc_execute', {
          sql_query: `UPDATE users SET balance = COALESCE(balance, 0) + ${companyShare} WHERE id = '${adminUser[0].id}'`
        });
      }

      // 直推人收益
      const { data: prevHolder } = await supabase.from('users').select('inviter_id').eq('id', targetUser.id).single();
      if (prevHolder?.inviter_id) {
        await supabase.rpc('rpc_execute', {
          sql_query: `UPDATE users SET balance = COALESCE(balance, 0) + ${directShare} WHERE id = '${prevHolder.inviter_id}'`
        });
      }

      // 上级服务商收益
      const { data: targetUserData } = await supabase.from('users').select('provider_id').eq('id', targetUser.id).single();
      if (targetUserData?.provider_id && targetUserData.provider_id !== user.userId) {
        await supabase.rpc('rpc_execute', {
          sql_query: `UPDATE users SET balance = COALESCE(balance, 0) + ${parentProviderShare} WHERE id = '${targetUserData.provider_id}'`
        });
      }

      // 分公司收益
      const { data: providerData } = await supabase.from('providers').select('branch_id').eq('user_id', user.userId).single();
      if (providerData?.branch_id) {
        await supabase.rpc('rpc_execute', {
          sql_query: `UPDATE users SET balance = COALESCE(balance, 0) + ${branchShare} WHERE id = '${providerData.branch_id}'`
        });
      }

      // 3. 原持有人本金到账
      if (product.previous_holder_id) {
        await supabase.rpc('rpc_execute', {
          sql_query: `UPDATE users SET balance = COALESCE(balance, 0) + ${product.price} WHERE id = '${product.previous_holder_id}'`
        });

        // 更新原持有人的user_product状态为transferred
        await supabase
          .from('user_products')
          .update({ status: 'transferred' })
          .eq('user_id', product.previous_holder_id)
          .eq('product_id', product.id)
          .eq('status', 'selling');
      }

      // 4. 创建新持有记录
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
          market_fee: marketFee,
          status: 'holding'
        });

      if (upError) {
        results.push({ productId: product.id, success: false, message: '创建持有记录失败' });
        continue;
      }

      // 5. 更新产品状态为sold，清除匹配信息
      await supabase
        .from('products')
        .update({
          status: 'sold',
          pending_match_user_id: null,
        })
        .eq('id', product.id);

      // 6. 创建订单记录
      await supabase.from('orders').insert({
        user_id: targetUser.id,
        user_product_id: null,
        order_type: 'buy',
        amount: product.price,
        status: 'completed'
      });

      // 7. 通知目标会员
      await supabase.from('notifications').insert({
        receiver_id: targetUser.id,
        receiver_role: 'member',
        type: 'product_matched',
        title: '产品匹配成功',
        content: `您已成功匹配产品「${product.name}」，金额¥${product.price}，能量值已扣除${marketFee}`,
        is_read: false
      });

      // 8. 通知原持有人本金到账
      if (product.previous_holder_id) {
        await supabase.from('notifications').insert({
          receiver_id: product.previous_holder_id,
          receiver_role: 'member',
          type: 'product_matched',
          title: '产品已转出',
          content: `您的产品「${product.name}」已成功匹配，本金¥${product.price}已到账`,
          is_read: false
        });
      }

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
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
