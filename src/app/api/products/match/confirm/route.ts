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
      .select('id, name, price, period, total_rate, profit_rate, status, provider_id, previous_holder_id, pending_match_user_id')
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
          `SELECT id, username, balance, provider_id, inviter_id FROM users WHERE id = $1`,
          [product.pending_match_user_id]
        );

        if (!targetUser) {
          results.push({ productId: product.id, success: false, message: '目标会员不存在' });
          continue;
        }

        const profitAmount = product.price * (product.profit_rate / 100);

        // === 匹配成功，执行所有操作 ===
        // 不再扣除能量值，不再有市场费
        // 总台释放5%收益，按7项分配到各角色balance

        const releaseRate = 0.05; // 总台释放5%
        const memberShare = product.price * 0.02;         // 会员2%（延迟到卖出/流转时到账）
        const directShare = product.price * 0.0025;       // 直推0.25%（购买时立即到账）
        const providerShare = product.price * 0.02;       // 服务商2%（购买时立即到账）
        const parentProviderShare = product.price * 0.0025; // 下级服务商0.25%（购买时立即到账）
        const branchShare = product.price * 0.001;        // 服务网点0.1%（购买时立即到账）
        const companyShare = product.price * 0.004;       // 总台运营0.4%（购买时立即到账）
        const totalReleased = product.price * releaseRate;

        // === 购买时：只发放3%（服务商+直推+下级+网点+总台），会员2%延迟到卖出时 ===

        // 1. 会员收益2% → 延迟到卖出/流转时到账，购买时不发放

        // 2. 直推人收益（购买时立即到账）
        if (targetUser.inviter_id) {
          await execute(
            `UPDATE users SET balance = COALESCE(balance, 0) + $1 WHERE id = $2`,
            [directShare, targetUser.inviter_id]
          );
        }

        // 3. 服务商收益
        await execute(
          `UPDATE users SET balance = COALESCE(balance, 0) + $1 WHERE id = $2`,
          [providerShare, user.userId]
        );

        // 4. 下级服务商收益
        if (targetUser.provider_id && targetUser.provider_id !== user.userId) {
          await execute(
            `UPDATE users SET balance = COALESCE(balance, 0) + $1 WHERE id = $2`,
            [parentProviderShare, targetUser.provider_id]
          );
        }

        // 5. 服务网点收益
        const providerData = await queryOne(
          `SELECT branch_id FROM providers WHERE user_id = $1`,
          [user.userId]
        );
        if (providerData?.branch_id) {
          await execute(
            `UPDATE users SET balance = COALESCE(balance, 0) + $1 WHERE id = $2`,
            [branchShare, providerData.branch_id]
          );
        }

        // 6. 总台运营收益
        const adminUser = await queryOne(
          `SELECT id FROM users WHERE role = 'admin' LIMIT 1`
        );
        if (adminUser) {
          await execute(
            `UPDATE users SET balance = COALESCE(balance, 0) + $1 WHERE id = $2`,
            [companyShare, adminUser.id]
          );
        }

        // 8. 记录释放收益到transactions表
        const targetUserAfter = await queryOne(
          `SELECT balance FROM users WHERE id = $1`,
          [targetUser.id]
        );
        const balanceBefore = targetUserAfter ? (targetUserAfter.balance || 0) : 0;
        const safeName = (product.name || '').replace(/'/g, "''");
        await execute(
          `INSERT INTO transactions (user_id, order_id, type, amount, description, balance_before, balance_after)
           VALUES ($1, NULL, 'release', $2, '产品${safeName}释放收益5%，会员2%延迟到账', $3, $4)`,
          [targetUser.id, totalReleased, balanceBefore, balanceBefore]
        );

        // 9. 更新原持有人的user_product状态为transferred
        if (product.previous_holder_id) {
          await execute(
            `UPDATE user_products SET status = 'transferred' WHERE user_id = $1 AND product_id = $2 AND status = 'pending_sell'`,
            [product.previous_holder_id, product.id]
          );
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
            market_fee: 0,
            seller_id: product.previous_holder_id || null,
            transfer_type: product.previous_holder_id ? 'member_transfer' : 'provider_match',
            status: 'holding'
          });

        if (upError) {
          console.error('[MATCH CONFIRM] 创建持有记录失败:', upError);
          results.push({ productId: product.id, success: false, message: '创建持有记录失败: ' + upError.message });
          continue;
        }

        // 11. 更新产品状态为sold，清除匹配信息
        await execute(
          `UPDATE products SET status = 'sold', pending_match_user_id = NULL WHERE id = $1`,
          [product.id]
        );

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
