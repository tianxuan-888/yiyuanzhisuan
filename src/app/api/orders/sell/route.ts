import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/storage/database/pg-client';

// 会员出售产品 - 收益立即到账，产品回到服务商待匹配
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, userProductId } = body;

    if (!userId || !userProductId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 查询用户信息
    const user = await queryOne<any>(
      'SELECT id, username, provider_id, phone, real_name FROM users WHERE id = $1',
      [userId]
    );
    if (!user) {
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

    // 持仓时间锁检查
    const period = product?.period || 7;
    const minHoldHours = period * 24;
    const purchaseTime = new Date(userProduct.purchase_date);
    const now = new Date();
    const holdHours = (now.getTime() - purchaseTime.getTime()) / (1000 * 60 * 60);

    if (holdHours < minHoldHours) {
      const remainingHours = Math.ceil(minHoldHours - holdHours);
      return NextResponse.json({
        success: false,
        error: '持仓时间不足',
        data: {
          code: 'HOLD_TIME_LOCK',
          message: `${period}天产品需持仓满${minHoldHours}小时才能出售，还需等待 ${remainingHours} 小时`,
          canSell: false,
        },
      }, { status: 400 });
    }

    // 计算收益
    const purchasePrice = parseFloat(userProduct.purchase_price);
    const expectedProfit = parseFloat(userProduct.expected_profit || 0);
    const marketFee = purchasePrice * (parseFloat(product?.market_rate || 5) / 100);

    // 1. 收益立即到账（写入balance/智算金）
    await execute(
      `UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2`,
      [expectedProfit, userId]
    );

    // 2. 创建卖出订单（Token值随产品流转，线下交易处理）
    const orderResult = await query(
      `INSERT INTO orders 
       (user_id, user_product_id, product_id, order_type, amount, status, review_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, userProductId, userProduct.product_id, 'sell', purchasePrice, 'pending', 
       `出售产品: ${product?.name || '未知产品'}，收益¥${expectedProfit}已到账智算金，Token值¥${purchasePrice}待匹配成功后由新持有人线下支付`]
    );

    // 3. 写入 member_revenue 收益记录（前端"已到账收益"从此表读取）
    const profitRate = parseFloat(product?.profit_rate || userProduct.profit_rate || 0);
    const totalRate = parseFloat(product?.total_rate || userProduct.total_rate || 0);
    const marketRate = parseFloat(product?.market_rate || userProduct.market_rate || 0);
    const holdingDays = Math.max(1, Math.floor(holdHours / 24));
    const orderId = orderResult?.[0]?.id || '';
    await execute(
      `INSERT INTO member_revenue 
       (user_id, order_id, user_product_id, principal, profit, total_amount, converted_to_energy, status, product_name, product_code, product_period, total_rate, profit_rate, market_rate, holding_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        userId, orderId, userProductId,
        purchasePrice, expectedProfit, purchasePrice + expectedProfit,
        0, 'available',
        product?.name || '未知产品', product?.code || '', product?.period || 1,
        totalRate, profitRate, marketRate, holdingDays
      ]
    );

    // 4. 更新用户产品状态为"售卖中"
    await execute(
      `UPDATE user_products SET status = 'pending_sell', updated_at = NOW() WHERE id = $1`,
      [userProductId]
    );

    // 5. 产品回到服务商 - 状态改为 pending_match（待匹配）
    await execute(
      `UPDATE products SET status = 'pending_match', previous_holder_id = $1, updated_at = NOW() WHERE id = $2`,
      [userId, userProduct.product_id]
    );

    // 6. 通知服务商
    if (user.provider_id) {
      await query(
        `INSERT INTO notifications 
         (receiver_id, receiver_role, sender_id, sender_name, type, title, content, amount, related_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          user.provider_id, 'provider', userId, user.username, 'sell_request',
          '会员出售产品待匹配',
          `${user.username} 出售产品 ${product?.name}，Token值¥${purchasePrice}，收益¥${expectedProfit}已发放到智算金，请匹配给新会员`,
          purchasePrice, userProductId
        ]
      );
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
