import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 买家购买流转产品（仅改变状态为awaiting_payment，不扣费）
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, transferId } = body;

    if (!userId || !transferId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const buyerId = user.userId;

    // 查询流转记录
    let transfer = await queryOne<any>(
      'SELECT * FROM product_transfers WHERE id = $1',
      [transferId]
    );

    // 如果没有找到 product_transfers 记录，检查旧流程
    if (!transfer) {
      const userProduct = await queryOne<any>(
        `SELECT up.*, p.name as product_name, p.code as product_code, p.price, p.period,
                p.total_rate, p.market_rate, p.profit_rate, p.provider_id
         FROM user_products up
         JOIN products p ON p.id = up.product_id
         WHERE up.id = $1 AND up.status = 'pending_sell'`,
        [transferId]
      );

      if (userProduct) {
        const newTransfer = await queryOne<any>(
          `INSERT INTO product_transfers (product_id, from_user_id, transfer_price, status, expires_at, created_at, updated_at)
           VALUES ($1, $2, $3, 'pending', NOW() + INTERVAL '48 hours', NOW(), NOW())
           RETURNING *`,
          [userProduct.product_id, userProduct.user_id, userProduct.purchase_price]
        );
        transfer = newTransfer;

        await query(
          "UPDATE user_products SET status = 'transferring', updated_at = NOW() WHERE id = $1",
          [transferId]
        );
      }
    }

    if (!transfer) {
      return NextResponse.json({ error: '流转记录不存在' }, { status: 404 });
    }

    if (transfer.status !== 'pending') {
      return NextResponse.json({ error: '该流转已结束或已有买家' }, { status: 400 });
    }

    if (transfer.expires_at && new Date(transfer.expires_at) < new Date()) {
      return NextResponse.json({ error: '该流转已过期' }, { status: 400 });
    }

    if (transfer.from_user_id === buyerId) {
      return NextResponse.json({ error: '不能购买自己发布的流转' }, { status: 400 });
    }

    // 查询产品信息
    const product = await queryOne<any>(
      'SELECT * FROM products WHERE id = $1',
      [transfer.product_id]
    );

    if (!product) {
      return NextResponse.json({ error: '产品不存在' }, { status: 404 });
    }

    const transferPrice = parseFloat(transfer.transfer_price) || parseFloat(product.price);
    const profitRate = parseFloat(product.profit_rate) || 0;
    const expectedProfit = Math.floor(transferPrice * profitRate / 100);

    // 更新流转记录状态为 awaiting_payment
    await query(
      `UPDATE product_transfers
       SET to_user_id = $1, status = 'awaiting_payment', expected_profit = $2, updated_at = NOW()
       WHERE id = $3`,
      [buyerId, expectedProfit, transfer.id]
    );

    // 通知卖家
    try {
      const buyerInfo = await queryOne<any>('SELECT username FROM users WHERE id = $1', [buyerId]);
      await query(
        `INSERT INTO notifications (receiver_id, receiver_role, type, title, content, status, created_at)
         VALUES ($1, 'seller', 'transfer', '有会员购买您的流转产品', $2, 'unread', NOW())`,
        [transfer.from_user_id, `会员 ${buyerInfo?.username || '未知'} 购买了您的流转产品，请等待买家付款`]
      );
    } catch (e) {
      console.error('通知卖家失败:', e);
    }

    return NextResponse.json({
      success: true,
      message: '购买申请已提交，请线下付款给卖家',
      data: {
        transferId: transfer.id,
        transferPrice,
        expectedProfit,
        profitRate,
        sellerId: transfer.from_user_id,
        sellerInfo: await getSellerInfo(transfer.from_user_id),
      }
    });
  } catch (error) {
    console.error('购买流转失败:', error);
    const errorMessage = error instanceof Error ? error.message : '购买流转产品失败';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

async function getSellerInfo(sellerId: string) {
  const seller = await queryOne<any>(
    'SELECT id, username, phone, real_name, alipay_account FROM users WHERE id = $1',
    [sellerId]
  );
  if (!seller) return null;
  return {
    username: seller.username,
    phone: seller.phone,
    realName: seller.real_name,
    alipayAccount: seller.alipay_account,
  };
}
