import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 买家确认已线下付款
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { transferId } = body;

    // 使用 token 中的 userId 作为操作者身份
    const operatorUserId = user.userId;

    if (!transferId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 查询流转记录
    const transfer = await queryOne<any>(
      'SELECT * FROM product_transfers WHERE id = $1',
      [transferId]
    );

    if (!transfer) {
      return NextResponse.json({ error: '流转记录不存在' }, { status: 404 });
    }

    // 验证是否是买家本人
    if (transfer.to_user_id !== operatorUserId) {
      return NextResponse.json({ error: '只有买家才能确认付款' }, { status: 403 });
    }

    // 验证流转状态必须是 awaiting_payment
    if (transfer.status !== 'awaiting_payment') {
      return NextResponse.json({
        error: transfer.status === 'buyer_confirmed'
          ? '您已确认过付款'
          : '当前状态无法确认付款'
      }, { status: 400 });
    }

    // 检查是否超时（2小时）
    const createdAt = new Date(transfer.updated_at || transfer.created_at);
    const now = new Date();
    const hoursDiff = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursDiff > 2) {
      // 超时自动取消
      await cancelTransfer(transfer);
      return NextResponse.json({ error: '已超过2小时付款时限，流转已自动取消' }, { status: 400 });
    }

    // 更新流转状态为 buyer_confirmed
    await query(
      `UPDATE product_transfers 
       SET status = 'buyer_confirmed', buyer_confirmed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [transferId]
    );

    // 通知卖家买家已确认付款
    const product = await queryOne<any>(
      'SELECT * FROM products WHERE id = $1',
      [transfer.product_id]
    );

    const buyer = await queryOne<any>(
      'SELECT username FROM users WHERE id = $1',
      [operatorUserId]
    );

    if (transfer.from_user_id) {
      const fromUser = await queryOne<any>('SELECT role FROM users WHERE id = $1', [transfer.from_user_id]);
      await query(
        `INSERT INTO notifications (receiver_id, receiver_role, type, title, content, related_id, status, created_at)
         VALUES ($1, $2, 'transfer_payment', '买家已确认付款', $3, $4, 'unread', NOW())`,
        [
          transfer.from_user_id,
          fromUser?.role || 'member',
          `买家 ${buyer?.username || ''}已确认线下付款，产品 ${product?.name || ''}，请确认收款`,
          transferId
        ]
      );
    }

    return NextResponse.json({
      success: true,
      message: '已确认付款，等待卖家确认收款'
    });
  } catch (error) {
    console.error('买家确认付款失败:', error);
    const errorMessage = error instanceof Error ? error.message : '确认付款失败';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// 取消超时流转（恢复产品状态）
async function cancelTransfer(transfer: any) {
  // 恢复产品状态
  await query(
    "UPDATE products SET status = 'available', updated_at = NOW() WHERE id = $1",
    [transfer.product_id]
  );

  // 恢复卖家持仓状态
  const sellerUserProduct = await queryOne<any>(
    "SELECT id FROM user_products WHERE product_id = $1 AND user_id = $2 AND status = 'transferring'",
    [transfer.product_id, transfer.from_user_id]
  );
  if (sellerUserProduct) {
    await query(
      "UPDATE user_products SET status = 'holding', updated_at = NOW() WHERE id = $1",
      [sellerUserProduct.id]
    );
  }

  // 退还买家能量值（市场费）
  const marketFee = parseFloat(transfer.market_fee) || 0;
  if (marketFee > 0 && transfer.to_user_id) {
    await query(
      'UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2',
      [marketFee, transfer.to_user_id]
    );
    await query(
      `INSERT INTO energy_transactions (user_id, type, amount, from_user_id, to_user_id, note, status, created_at)
       VALUES ($2, 'transfer_in', $1, NULL, $2, $3, 'completed', NOW())`,
      [marketFee, transfer.to_user_id, `流转超时取消，退还市场费 ${marketFee}`]
    );

    // TODO: 退还市场费分成（复杂操作，暂不处理，后续可补充）
  }

  // 更新流转状态为 cancelled
  await query(
    `UPDATE product_transfers SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
    [transfer.id]
  );

  // 通知卖家和买家
  if (transfer.from_user_id) {
    const fromUser = await queryOne<any>('SELECT role FROM users WHERE id = $1', [transfer.from_user_id]);
    await query(
      `INSERT INTO notifications (receiver_id, receiver_role, type, title, content, related_id, status, created_at)
       VALUES ($1, $2, 'transfer_cancelled', '流转已取消', $3, $4, 'unread', NOW())`,
      [transfer.from_user_id, fromUser?.role || 'member', '买家付款超时，流转已自动取消，产品已恢复到您的持仓', transfer.id]
    );
  }
  if (transfer.to_user_id) {
    const toUser = await queryOne<any>('SELECT role FROM users WHERE id = $1', [transfer.to_user_id]);
    await query(
      `INSERT INTO notifications (receiver_id, receiver_role, type, title, content, related_id, status, created_at)
       VALUES ($1, $2, 'transfer_cancelled', '流转已取消', $3, $4, 'unread', NOW())`,
      [transfer.to_user_id, toUser?.role || 'member', '付款超时，流转已自动取消，市场费已退还', transfer.id]
    );
  }
}
