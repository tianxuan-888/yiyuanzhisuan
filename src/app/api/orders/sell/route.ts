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

      // 会员收益到账 = profit_rate收益 + 产品价格2%返还（写入energy_value智算金）
      const memberShare = parseFloat(userProduct.purchase_price) * 0.02;  // 会员 2%
      const memberTotalGain = memberProfit + memberShare;
      await execute(
        `UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2`,
        [memberTotalGain, userId]
      );
      await execute(
        `INSERT INTO energy_transactions (user_id, type, amount, note, created_at)
         VALUES ($1, 'profit_release', $2, $3, NOW())`,
        [userId, memberProfit,
         `产品「${product?.name || '未知产品'}」到期释放收益${profitRate}%`]
      );
      if (memberShare > 0) {
        await execute(
          `INSERT INTO energy_transactions (user_id, type, amount, note, created_at)
           VALUES ($1, 'market_fee_return', $2, $3, NOW())`,
          [userId, memberShare, '产品到期市场费返还40%']
        );
      }

      // 服务商收益 2%（写入energy_value智算金）
      const providerShare = parseFloat(userProduct.purchase_price) * 0.02;
      if (product?.provider_id && providerShare > 0) {
        await execute(
          `UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2`,
          [providerShare, product.provider_id]
        );
        await execute(
          `INSERT INTO energy_transactions (user_id, type, amount, note, created_at)
           VALUES ($1, 'provider_revenue', $2, $3, NOW())`,
          [product.provider_id, providerShare, '会员产品到期，服务商分成2%']
        );
      }

      // 直推人收益 0.25%（写入energy_value智算金）
      const directShare = parseFloat(userProduct.purchase_price) * 0.0025;
      const memberData = await queryOne<any>('SELECT inviter_id FROM users WHERE id = $1', [userId]);
      if (memberData?.inviter_id && directShare > 0) {
        await execute(
          `UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2`,
          [directShare, memberData.inviter_id]
        );
      }

      // 上级服务商收益 0.25%（写入energy_value智算金）
      const parentProviderShare = parseFloat(userProduct.purchase_price) * 0.0025;
      let noParentShare = 0;
      if (product?.provider_id) {
        const providerInfo = await queryOne<any>('SELECT branch_id, parent_provider_id FROM providers WHERE user_id = $1', [product.provider_id]);
        if (providerInfo?.parent_provider_id && parentProviderShare > 0) {
          await execute(
            `UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2`,
            [parentProviderShare, providerInfo.parent_provider_id]
          );
        } else if (parentProviderShare > 0) {
          // 无上级服务商时，0.25%归公司运营
          noParentShare = parentProviderShare;
        }
        // 网点收益 0.1%（写入energy_value智算金）
        const branchShare = parseFloat(userProduct.purchase_price) * 0.001;
        if (providerInfo?.branch_id && branchShare > 0) {
          await execute(
            `UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2`,
            [branchShare, providerInfo.branch_id]
          );
        }
      }

      // 总台收益 0.4% + 无上级服务商时的0.25%（写入energy_value智算金）
      const companyShare = parseFloat(userProduct.purchase_price) * 0.004;
      const companyTotalShare = companyShare + noParentShare;
      const adminUser = await queryOne<any>('SELECT id FROM users WHERE role = $1 LIMIT 1', ['admin']);
      if (adminUser && companyTotalShare > 0) {
        await execute(
          `UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2`,
          [companyTotalShare, adminUser.id]
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
        [userId, userProductId, parseFloat(userProduct.purchase_price), memberTotalGain,
         parseFloat(userProduct.purchase_price) + memberTotalGain, 0, 'available',
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
