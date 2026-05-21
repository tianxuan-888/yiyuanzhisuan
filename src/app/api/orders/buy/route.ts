import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

// 辅助函数：将PostgreSQL numeric格式转换为数字
function parseNumeric(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const match = val.match(/\{(\d+)\s+(-?\d+)/);
    if (match) {
      const num = parseFloat(match[1]);
      const exp = parseInt(match[2]);
      return num * Math.pow(10, exp);
    }
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

// 购买产品接口（线下交易模式，无需收益）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, productId } = body;

    if (!userId || !productId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 查询产品信息
    const product = await queryOne<any>(
      `SELECT * FROM products WHERE id = $1`,
      [productId]
    );

    if (!product) {
      return NextResponse.json({ error: '产品不存在' }, { status: 404 });
    }

    if (product.status !== 'available') {
      return NextResponse.json({ error: '产品不可购买' }, { status: 400 });
    }

    // 查询用户信息
    const user = await queryOne<any>(
      `SELECT * FROM users WHERE id = $1`,
      [userId]
    );

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    const productPrice = parseNumeric(product.price);

    // ========== 持仓金额检查（上限2万） ==========
    const holdingsResult: any = await queryOne<any>(
      `SELECT COALESCE(SUM(purchase_price), 0) as total_holding
       FROM user_products 
       WHERE user_id = $1 AND status IN ('holding', 'pending_confirm')`,
      [userId]
    );
    const currentHolding = parseNumeric(holdingsResult?.total_holding);
    const newTotalHolding = currentHolding + productPrice;
    const maxHolding = 20000;
    
    if (newTotalHolding > maxHolding) {
      return NextResponse.json({
        success: false,
        error: '持仓金额超限',
        data: {
          code: 'HOLDING_LIMIT',
          message: `购买后持仓金额为 ${newTotalHolding.toLocaleString()} 元，超过上限 ${maxHolding.toLocaleString()} 元`,
          currentHolding,
          productPrice,
          maxHolding,
          canBuy: false,
        },
      }, { status: 400 });
    }

    // ========== 时间锁检查（超过20天且无有效推荐人则锁定）==========
    let hasValidInviter = false;
    
    if (user.inviter_id) {
      const inviter = await queryOne<any>(
        `SELECT id FROM users WHERE id = $1`,
        [user.inviter_id]
      );
      
      if (inviter) {
        const inviterPurchase = await queryOne<any>(
          `SELECT COUNT(*) as count FROM user_products WHERE user_id = $1 AND status = 'holding'`,
          [inviter.id]
        );
        
        hasValidInviter = parseInt(inviterPurchase?.count || '0') > 0;
      }
    }
    
    if (!hasValidInviter) {
      const firstPurchaseResult: any = await queryOne<any>(
        `SELECT MIN(purchase_date) as first_date
         FROM user_products 
         WHERE user_id = $1 AND status = 'holding'`,
        [userId]
      );
      
      const firstPurchaseDate = firstPurchaseResult?.first_date;
      
      if (firstPurchaseDate) {
        const firstDate = new Date(firstPurchaseDate);
        const graceEndDate = new Date(firstDate.getTime() + 20 * 24 * 60 * 60 * 1000);
        const now = new Date();
        
        if (now >= graceEndDate) {
          return NextResponse.json({
            success: false,
            error: '需要有效推荐人',
            data: {
              code: 'TIME_LOCK',
              message: `已超过20天保护期，需绑定有效推荐人才能继续购买`,
              hasValidInviter: false,
              firstPurchaseDate,
              graceEndDate: graceEndDate.toISOString(),
              canBuy: false,
            },
          }, { status: 400 });
        }
      }
    }

    // ========== 执行购买（无需扣除收益） ==========
    const providerId = product.provider_id;

    // 1. 创建 user_products 记录（pending_confirm 状态）
    const userProductId = crypto.randomUUID();
    const purchaseDate = new Date();
    const expireDate = new Date(purchaseDate.getTime() + product.period * 24 * 60 * 60 * 1000);
    const totalRate = parseNumeric(product.total_rate) / 100;
    const memberActualProfit = Math.floor(productPrice * totalRate);
    const marketRate = parseNumeric(product.market_rate) / 100;
    const marketFee = Math.ceil(productPrice * marketRate);

    await query(
      `INSERT INTO user_products (id, user_id, product_id, purchase_price, purchase_date, expire_date, status, expected_profit, market_fee, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending_confirm', $7, $8, NOW(), NOW())`,
      [
        userProductId, userId, productId, productPrice,
        purchaseDate.toISOString(), expireDate.toISOString(),
        memberActualProfit, marketFee
      ]
    );

    // 2. 更新产品状态为 pending_sell
    await query(
      `UPDATE products SET status = 'pending_sell', updated_at = NOW() WHERE id = $1`,
      [productId]
    );

    // 3. 创建订单
    const orderId = crypto.randomUUID();
    await query(
      `INSERT INTO orders (id, user_id, user_product_id, product_id, order_type, amount, status, energy_cost, created_at)
       VALUES ($1, $2, $3, $4, 'buy', $5, 'pending', $6, NOW())`,
      [orderId, userId, userProductId, productId, productPrice, marketFee]
    );

    // 4. 发送通知给服务商
    if (providerId) {
      const notifId = crypto.randomUUID();
      await query(
        `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, sender_name, type, title, content, amount, related_id, created_at)
         VALUES ($1, $2, 'provider', $3, $4, 'buy_request', '会员购买申请', $5, $6, $7, NOW())`,
        [notifId, providerId, userId, user.username, 
         `${user.username} 申请购买 ${product.name}，金额 ¥${productPrice.toLocaleString()}，待确认收款`,
         productPrice, orderId]
      );
    }

    // 获取订单信息
    const order = await queryOne(
      `SELECT * FROM orders WHERE id = $1`,
      [orderId]
    );

    return NextResponse.json({
      success: true,
      data: {
        order,
        product,
        userProductId,
        providerInfo: providerId ? (await queryOne<any>(
          `SELECT username, phone, real_name FROM users WHERE id = $1`, [providerId]
        )) : null,
        marketFee,
        message: `购买申请已提交，请等待服务商确认收款后完成购买`,
      },
    });
  } catch (error) {
    console.error('购买产品失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '购买产品失败' },
      { status: 500 }
    );
  }
}
