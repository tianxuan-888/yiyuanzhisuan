import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 发布流转（会员卖出产品）
export async function POST(request: NextRequest) {
  try {
    // 鉴权：需要登录
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, userProductId } = body;

    // 参数验证
    if (!userId || !userProductId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 验证操作者权限
    if (user.role !== 'admin' && user.userId !== userId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    // 查询用户产品
    const userProduct = await queryOne<any>(
      'SELECT * FROM user_products WHERE id = $1',
      [userProductId]
    );

    if (!userProduct) {
      return NextResponse.json({ error: '产品记录不存在' }, { status: 404 });
    }

    // 验证产品归属
    if (userProduct.user_id !== userId) {
      return NextResponse.json({ error: '无权操作此产品' }, { status: 403 });
    }

    // 验证产品状态是否为持有中
    if (userProduct.status !== 'holding') {
      return NextResponse.json({ error: '只有持有中的产品才能发布流转' }, { status: 400 });
    }

    // 查询产品信息
    const product = await queryOne<any>(
      'SELECT * FROM products WHERE id = $1',
      [userProduct.product_id]
    );

    if (!product) {
      return NextResponse.json({ error: '产品不存在' }, { status: 404 });
    }

    // ========== 持仓时间锁检查 ==========
    const period = product.period || 7;
    const minHoldHours = period * 24;
    const purchaseTime = new Date(userProduct.purchase_date);
    const now = new Date();
    const holdHours = (now.getTime() - purchaseTime.getTime()) / (1000 * 60 * 60);

    if (holdHours < minHoldHours) {
      const remainingHours = Math.ceil(minHoldHours - holdHours);
      return NextResponse.json({
        success: false,
        error: `${period}天产品需持仓满${minHoldHours}小时才能卖出，还需等待 ${remainingHours} 小时`,
        data: {
          code: 'HOLD_TIME_LOCK',
          holdHours: Math.floor(holdHours),
          minHoldHours,
          remainingHours,
          productPeriod: period,
          canSell: false,
        },
      }, { status: 400 });
    }

    // 检查是否已有进行中的流转
    const existingTransfer = await queryOne<any>(
      "SELECT id FROM product_transfers WHERE product_id = $1 AND status IN ('pending', 'awaiting_payment', 'seller_confirmed')",
      [userProduct.product_id]
    );

    if (existingTransfer) {
      return NextResponse.json({ error: '该产品已有进行中的流转' }, { status: 400 });
    }

    // 流转价格 = 原购买价（不变）
    const transferPrice = parseFloat(userProduct.purchase_price) || parseFloat(product.price);

    // 获取流转过期时间配置（默认48小时）
    const configRow = await queryOne<any>(
      "SELECT value FROM system_config WHERE key = 'transfer_expire_hours'"
    );
    const expireHours = parseInt(configRow?.value || '48');
    const expiresAt = new Date(Date.now() + expireHours * 60 * 60 * 1000);

    // 更新用户产品状态为流转中
    await query(
      "UPDATE user_products SET status = 'transferring', updated_at = NOW() WHERE id = $1",
      [userProductId]
    );

    // 更新产品状态为流转中
    await query(
      "UPDATE products SET status = 'pending_sell', updated_at = NOW() WHERE id = $1",
      [userProduct.product_id]
    );

    // 创建流转记录
    const transferResult = await query(
      `INSERT INTO product_transfers 
       (product_id, from_user_id, from_user_product_id, transfer_price, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *`,
      [userProduct.product_id, userId, userProductId, transferPrice, 'pending', expiresAt.toISOString()]
    );

    const transfer = transferResult[0];

    return NextResponse.json({
      success: true,
      message: '流转发布成功，等待其他会员购买',
      data: {
        transferId: transfer.id,
        transferPrice,
        expiresAt: expiresAt.toISOString(),
        expireHours,
      }
    });
  } catch (error) {
    console.error('发布流转失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
