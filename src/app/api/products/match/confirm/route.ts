import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute, getSupabase } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';

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
    let { productIds } = body;

    // 兼容：前端可能传单个字符串而非数组
    if (typeof productIds === 'string') {
      productIds = [productIds];
    }

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json({ success: false, message: '缺少产品ID列表' }, { status: 400 });
    }

    console.log('[MATCH CONFIRM] 确认匹配:', { productIds, userId: user.userId });

    const supabase = getSupabase();

    // 获取所有待确认的产品
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, code, price, period, total_rate, profit_rate, market_rate, status, provider_id, previous_holder_id, pending_match_user_id')
      .in('id', productIds);

    if (productsError || !products || products.length === 0) {
      console.error('[MATCH CONFIRM] 查询产品失败:', productsError);
      return NextResponse.json({ success: false, message: '未找到产品' }, { status: 404 });
    }

    const results: { productId: string; success: boolean; message: string }[] = [];

    for (const product of products) {
      try {
        // 验证
        if (product.provider_id !== user.userId) {
          results.push({ productId: product.id, success: false, message: '无权操作' });
          continue;
        }
        if (product.status !== 'pending_match') {
          results.push({ productId: product.id, success: false, message: `产品状态不允许(当前: ${product.status})` });
          continue;
        }
        if (!product.pending_match_user_id) {
          results.push({ productId: product.id, success: false, message: '未指定匹配会员' });
          continue;
        }

        // 检查目标会员
        const targetUser = await queryOne(
          `SELECT id, username, balance, provider_id, inviter_id, buy_locked FROM users WHERE id = $1`,
          [product.pending_match_user_id]
        );

        if (!targetUser) {
          results.push({ productId: product.id, success: false, message: '目标会员不存在' });
          continue;
        }

        // 检查目标会员是否被锁定
        if (targetUser.buy_locked) {
          results.push({ productId: product.id, success: false, message: '目标会员已被锁定，无法购买产品' });
          continue;
        }

        const profitRate = parseFloat(product.profit_rate || 0);
        const profitAmount = product.price * (profitRate / 100);

        // === 匹配成功，只创建持有记录，不发放任何收益 ===
        // 收益在产品到期后统一释放（所有角色同时到账）

        // 1. 更新原持有人的user_product状态为transferred
        if (product.previous_holder_id) {
          await execute(
            `UPDATE user_products SET status = 'transferred' WHERE user_id = $1 AND product_id = $2 AND status = 'pending_sell'`,
            [product.previous_holder_id, product.id]
          );
        }

        // 2. 创建新持有记录
        // expire_date = 购买日期 + period天，当天中午12:00
        const now = new Date();
        const expireDate = new Date(now);
        expireDate.setDate(expireDate.getDate() + product.period);
        expireDate.setHours(12, 0, 0, 0);

        const { error: upError } = await supabase
          .from('user_products')
          .insert({
            user_id: targetUser.id,
            product_id: product.id,
            purchase_price: product.price,
            purchase_date: now.toISOString(),
            expire_date: expireDate.toISOString(),
            expected_profit: profitAmount,
            market_fee: 0,
            status: 'holding',
            revenue_released: false
          });

        if (upError) {
          console.error('[MATCH CONFIRM] 创建持有记录失败:', upError);
          results.push({ productId: product.id, success: false, message: '创建持有记录失败: ' + upError.message });
          continue;
        }

        // 3. 更新产品状态为sold，清除匹配信息
        await execute(
          `UPDATE products SET status = 'sold', pending_match_user_id = NULL WHERE id = $1`,
          [product.id]
        );

        // 4. 创建订单记录
        await supabase.from('orders').insert({
          user_id: targetUser.id,
          user_product_id: null,
          order_type: 'buy',
          amount: product.price,
          status: 'completed'
        });

        // 5. 通知目标会员
        await supabase.from('notifications').insert({
          receiver_id: targetUser.id,
          receiver_role: 'member',
          type: 'product_matched',
          title: '产品匹配成功',
          content: `您已成功匹配产品「${product.name}」，金额¥${product.price}，${product.period}天后到期（${expireDate.toLocaleDateString('zh-CN')} 中午12:00解锁），到期后收益自动释放`,
          is_read: false
        });

        // 6. 通知原持有人Token值已转出
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

        // 7. 写入产品流转记录
        try {
          // 获取买卖双方信息
          const sellerId = product.previous_holder_id || user.userId;
          const sellerInfo = await queryOne(
            `SELECT id, username, unique_id, phone FROM users WHERE id = $1`,
            [sellerId]
          );
          const buyerInfo = await queryOne(
            `SELECT id, username, unique_id, phone FROM users WHERE id = $1`,
            [targetUser.id]
          );
          const providerInfo = await queryOne(
            `SELECT id, username FROM users WHERE id = $1`,
            [product.provider_id]
          );
          const flowType = product.previous_holder_id ? 'member_transfer' : 'provider_match';
          const sellerProfit = product.previous_holder_id
            ? product.price * (profitRate / 100)
            : 0;

          await supabase.from('product_flow_records').insert({
            product_id: product.id,
            product_code: product.code,
            product_name: product.name,
            product_price: product.price,
            period: product.period,
            profit_rate: product.profit_rate,
            market_rate: product.market_rate,
            flow_type: flowType,
            seller_id: sellerId,
            seller_name: sellerInfo?.username || '',
            seller_unique_id: sellerInfo?.unique_id || '',
            seller_phone: sellerInfo?.phone || '',
            buyer_id: targetUser.id,
            buyer_name: buyerInfo?.username || '',
            buyer_unique_id: buyerInfo?.unique_id || '',
            buyer_phone: buyerInfo?.phone || '',
            transfer_amount: product.price,
            seller_profit: sellerProfit,
            provider_id: product.provider_id,
            provider_name: providerInfo?.username || '',
          });
        } catch (flowErr) {
          console.error('[MATCH CONFIRM] 写入流转记录失败:', flowErr);
        }

        console.log('[MATCH CONFIRM] 匹配成功，收益待到期释放:', {
          productId: product.id,
          targetUser: targetUser.username,
          expireDate: expireDate.toISOString(),
          profitAmount
        });
        results.push({ productId: product.id, success: true, message: '匹配成功，收益待到期释放' });
      } catch (productError: unknown) {
        const errMsg = productError instanceof Error ? productError.message : '未知错误';
        console.error('[MATCH CONFIRM] 单个产品匹配异常:', productError);
        results.push({ productId: product.id, success: false, message: errMsg });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return NextResponse.json({
      success: successCount > 0,
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
