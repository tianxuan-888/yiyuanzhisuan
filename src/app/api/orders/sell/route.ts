import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';

// 会员出售产品 - 到期解锁后可卖出流转（收益已自动到账，卖出只是流转产品）
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ success: false, message: '无效token' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, userProductId } = body;

    if (!userId || !userProductId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 验证操作权限
    if (user.role !== 'admin' && user.userId !== userId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    // 查询用户信息
    const dbUser = await queryOne<any>(
      'SELECT id, username, provider_id, phone, real_name FROM users WHERE id = $1',
      [userId]
    );
    if (!dbUser) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    // 查询用户产品
    const userProduct = await queryOne<any>(
      'SELECT * FROM user_products WHERE id = $1',
      [userProductId]
    );
    if (!userProduct) {
      return NextResponse.json({ error: '产品不存在' }, { status: 404 });
    }

    // 验证归属
    if (userProduct.user_id !== userId) {
      return NextResponse.json({ error: '无权操作此产品' }, { status: 403 });
    }

    // 验证状态
    if (userProduct.status !== 'holding') {
      return NextResponse.json({ error: '产品状态不允许出售' }, { status: 400 });
    }

    // 查询产品信息
    const product = await queryOne<any>(
      'SELECT * FROM products WHERE id = $1',
      [userProduct.product_id]
    );

    // 持仓时间锁检查 - 按天数计算，到期当天中午12点解锁
    const expireDate = new Date(userProduct.expire_date);
    const unlockTime = new Date(expireDate);
    unlockTime.setHours(12, 0, 0, 0);
    const now = new Date();

    if (now < unlockTime) {
      const remainingMs = unlockTime.getTime() - now.getTime();
      const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
      const remainingDays = Math.floor(remainingHours / 24);
      const hoursLeft = remainingHours % 24;
      return NextResponse.json({
        success: false,
        error: '持仓时间不足',
        data: {
          code: 'HOLD_TIME_LOCK',
          message: `${product?.period || 7}天产品需到期后才能出售，还需等待${remainingDays > 0 ? remainingDays + '天' : ''}${hoursLeft}小时（到期日中午12:00解锁）`,
          canSell: false,
          expireDate: userProduct.expire_date,
        },
      }, { status: 400 });
    }

    // 如果收益尚未释放，自动释放（兜底逻辑，正常情况到期时已自动释放）
    if (!userProduct.revenue_released) {
      const profitRate = parseFloat(product?.profit_rate || userProduct.profit_rate || 0);
      const memberProfit = parseFloat(userProduct.purchase_price) * (profitRate / 100);
      const marketRate = parseFloat(product?.market_rate || 0);
      const marketPool = parseFloat(userProduct.purchase_price) * (marketRate / 100);

      // 会员收益到账
      const memberBefore = await queryOne<any>('SELECT balance FROM users WHERE id = $1', [userId]);
      const memberBalanceBefore = parseFloat(memberBefore?.balance || 0);
      await execute(
        `UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2`,
        [memberProfit, userId]
      );
      await execute(
        `INSERT INTO transactions (user_id, type, amount, description, balance_before, balance_after)
         VALUES ($1, 'profit_release', $2, $3, $4, $5)`,
        [userId, memberProfit,
         `产品「${product?.name || '未知产品'}」到期释放收益${profitRate}%`,
         memberBalanceBefore, memberBalanceBefore + memberProfit]
      );

      // 服务商收益 70%
      const providerShare = marketPool * 0.70;
      if (product?.provider_id && providerShare > 0) {
        const providerBefore = await queryOne<any>('SELECT balance FROM users WHERE id = $1', [product.provider_id]);
        const providerBalanceBefore = parseFloat(providerBefore?.balance || 0);
        await execute(
          `UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2`,
          [providerShare, product.provider_id]
        );
        await execute(
          `INSERT INTO transactions (user_id, type, amount, description, balance_before, balance_after)
           VALUES ($1, 'provider_revenue', $2, '会员产品到期，服务商分成70%', $3, $4)`,
          [product.provider_id, providerShare, providerBalanceBefore, providerBalanceBefore + providerShare]
        );
      }

      // 直推人收益 10%
      const directShare = marketPool * 0.10;
      const memberData = await queryOne<any>('SELECT inviter_id FROM users WHERE id = $1', [userId]);
      if (memberData?.inviter_id && directShare > 0) {
        await execute(
          `UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2`,
          [directShare, memberData.inviter_id]
        );
      }

      // 上级服务商收益 10%
      const parentProviderShare = marketPool * 0.10;
      if (dbUser.provider_id && dbUser.provider_id !== product?.provider_id && parentProviderShare > 0) {
        await execute(
          `UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2`,
          [parentProviderShare, dbUser.provider_id]
        );
      }

      // 网点收益 5%
      const branchShare = marketPool * 0.05;
      if (product?.provider_id) {
        const providerData = await queryOne<any>('SELECT branch_id FROM providers WHERE user_id = $1', [product.provider_id]);
        if (providerData?.branch_id && branchShare > 0) {
          await execute(
            `UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2`,
            [branchShare, providerData.branch_id]
          );
        }
      }

      // 总台收益 5%
      const companyShare = marketPool * 0.05;
      const adminUser = await queryOne<any>('SELECT id FROM users WHERE role = $1 LIMIT 1', ['admin']);
      if (adminUser && companyShare > 0) {
        await execute(
          `UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2`,
          [companyShare, adminUser.id]
        );
      }

      // 记录member_revenue
      const holdingHours = (now.getTime() - new Date(userProduct.purchase_date).getTime()) / (1000 * 60 * 60);
      const holdingDays = Math.max(1, Math.floor(holdingHours / 24));
      const totalRate = parseFloat(product?.total_rate || 0);
      await execute(
        `INSERT INTO member_revenue 
         (user_id, user_product_id, principal, profit, total_amount, converted_to_energy, status, product_name, product_code, product_period, total_rate, profit_rate, market_rate, holding_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [userId, userProductId, parseFloat(userProduct.purchase_price), memberProfit,
         parseFloat(userProduct.purchase_price) + memberProfit, 0, 'available',
         product?.name || '未知产品', product?.code || '', product?.period || 1,
         totalRate, profitRate, marketRate, holdingDays]
      );

      // 标记收益已释放
      await execute(
        `UPDATE user_products SET revenue_released = true, updated_at = NOW() WHERE id = $1`,
        [userProductId]
      );
    }

    const purchasePrice = parseFloat(userProduct.purchase_price);
    const expectedProfit = parseFloat(userProduct.expected_profit || 0);

    // 创建卖出订单
    const orderResult = await query(
      `INSERT INTO orders 
       (user_id, user_product_id, product_id, order_type, amount, status, review_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, userProductId, userProduct.product_id, 'sell', purchasePrice, 'pending', 
       `出售产品: ${product?.name || '未知产品'}，Token值¥${purchasePrice}待匹配成功后由新持有人线下支付`]
    );

    // 更新用户产品状态为"售卖中"
    await execute(
      `UPDATE user_products SET status = 'pending_sell', updated_at = NOW() WHERE id = $1`,
      [userProductId]
    );

    // 产品回到服务商 - 状态改为 pending_match（待匹配）
    await execute(
      `UPDATE products SET status = 'pending_match', previous_holder_id = $1, updated_at = NOW() WHERE id = $2`,
      [userId, userProduct.product_id]
    );

    // 通知服务商
    if (dbUser.provider_id) {
      const { getSupabase } = await import('@/lib/supabase-client');
      const supabase = getSupabase();
      await supabase.from('notifications').insert({
        receiver_id: dbUser.provider_id,
        receiver_role: 'provider',
        type: 'sell_request',
        title: '会员出售产品待匹配',
        content: `${dbUser.username} 出售产品 ${product?.name}，Token值¥${purchasePrice}，请匹配给新会员`,
        is_read: false
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        order: orderResult[0],
        profitCredited: expectedProfit,
        principalPending: purchasePrice,
        message: `出售成功！收益¥${expectedProfit.toFixed(2)}已到账智算金，Token值¥${purchasePrice.toFixed(2)}待匹配成功后由新持有人线下支付`,
      },
    });
  } catch (error) {
    console.error('出售产品失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '出售产品失败' },
      { status: 500 }
    );
  }
}
