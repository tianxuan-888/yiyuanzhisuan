import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

// 卖出产品接口（线下交易模式）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, userProductId } = body;

    // 参数验证
    if (!userId || !userProductId) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 查询用户信息
    const user = await queryOne<any>(
      'SELECT id, username, provider_id, phone, real_name FROM users WHERE id = $1',
      [userId]
    );

    if (!user) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      );
    }

    // 查询用户产品信息
    const userProduct = await queryOne<any>(
      'SELECT * FROM user_products WHERE id = $1',
      [userProductId]
    );

    if (!userProduct) {
      return NextResponse.json(
        { error: '用户产品不存在' },
        { status: 404 }
      );
    }

    // 查询产品信息
    const product = await queryOne<any>(
      'SELECT * FROM products WHERE id = $1',
      [userProduct.product_id]
    );

    // 验证产品归属
    if (userProduct.user_id !== userId) {
      return NextResponse.json(
        { error: '无权操作此产品' },
        { status: 403 }
      );
    }

    // 验证产品状态
    if (userProduct.status !== 'holding') {
      return NextResponse.json(
        { error: '产品状态不允许卖出' },
        { status: 400 }
      );
    }

    // ========== 持仓时间锁检查（按产品周期解锁）==========
    // 获取产品周期
    const period = product?.period || 7;
    
    // 根据产品周期计算最低持仓时间：周期天数 × 24小时
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
          message: `${product?.period}天产品需持仓满${minHoldHours}小时才能卖出，还需等待 ${remainingHours} 小时`,
          purchaseDate: userProduct.purchase_date,
          holdHours: Math.floor(holdHours),
          minHoldHours,
          remainingHours,
          productPeriod: product?.period,
          canSell: false,
        },
      }, { status: 400 });
    }

    // 更新用户产品状态为待审核
    await query(
      'UPDATE user_products SET status = $1, updated_at = NOW() WHERE id = $2',
      ['pending_sell', userProductId]
    );

    // 创建卖出订单
    const sellPrice = parseFloat(userProduct.purchase_price) + parseFloat(userProduct.expected_profit);
    const orderResult = await query(
      `INSERT INTO orders 
       (user_id, user_product_id, product_id, provider_id, order_type, amount, status, payment_confirmed, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [userId, userProductId, userProduct.product_id, user.provider_id, 'sell', sellPrice, 'pending', false, `卖出产品: ${product?.name || '未知产品'}`]
    );

    const order = orderResult[0];

    // 发送通知给服务商
    if (user.provider_id) {
      await query(
        `INSERT INTO notifications 
         (receiver_id, receiver_role, sender_id, sender_name, type, title, content, amount, related_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          user.provider_id, 
          'provider', 
          userId, 
          user.username, 
          'sell_request', 
          '会员申请卖出产品',
          `${user.username} 申请卖出产品，本金 ¥${userProduct.purchase_price}，预期收益 ¥${userProduct.expected_profit}，总金额 ¥${sellPrice.toFixed(2)}，待审核`,
          sellPrice,
          userProductId
        ]
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        order,
        message: '卖出申请已提交，等待服务商审核',
      },
    });
  } catch (error) {
    console.error('卖出产品失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '卖出产品失败' },
      { status: 500 }
    );
  }
}
