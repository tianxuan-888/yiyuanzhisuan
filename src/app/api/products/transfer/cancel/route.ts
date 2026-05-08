import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 卖家手动取消流转（买家迟迟不付款时）
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

    // 验证操作者权限
    if (user.role !== 'admin' && user.userId !== userId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    // 查询流转记录
    const transfer = await queryOne<any>(
      'SELECT * FROM product_transfers WHERE id = $1',
      [transferId]
    );

    if (!transfer) {
      return NextResponse.json({ error: '流转记录不存在' }, { status: 404 });
    }

    // 验证是否是卖家本人
    if (transfer.from_user_id !== userId) {
      return NextResponse.json({ error: '只有卖家才能取消流转' }, { status: 403 });
    }

    // 只有 awaiting_payment 和 buyer_confirmed 状态可以取消
    if (!['awaiting_payment', 'buyer_confirmed'].includes(transfer.status)) {
      return NextResponse.json({ error: '当前状态无法取消流转' }, { status: 400 });
    }

    // ========== 执行取消操作 ==========

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
        [marketFee, transfer.to_user_id, `流转被卖家取消，退还市场费 ${marketFee}`]
      );
    }

    // 更新流转状态为 cancelled
    await query(
      `UPDATE product_transfers SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [transferId]
    );

    // 重新发布流转（恢复为pending状态，让其他会员可购买）
    // 创建新的流转记录
    await query(
      `UPDATE product_transfers 
       SET status = 'pending', to_user_id = NULL, market_fee = NULL, expected_profit = NULL, 
           buyer_confirmed_at = NULL, seller_confirmed = false,
           expires_at = NOW() + INTERVAL '48 hours', updated_at = NOW()
       WHERE id = $1`,
      [transferId]
    );

    // 恢复产品状态为在售
    await query(
      "UPDATE products SET status = 'available', updated_at = NOW() WHERE id = $1",
      [transfer.product_id]
    );

    // 通知买家流转已取消
    if (transfer.to_user_id) {
      await query(
        `INSERT INTO notifications (user_id, type, title, content, related_id, created_at)
         VALUES ($1, 'transfer_cancelled', '流转已取消', $2, $3, NOW())`,
        [transfer.to_user_id, '卖家已取消流转，市场费已退还到您的账户', transferId]
      );
    }

    return NextResponse.json({
      success: true,
      message: '流转已取消，产品已重新上架到流转市场'
    });
  } catch (error) {
    console.error('取消流转失败:', error);
    const errorMessage = error instanceof Error ? error.message : '取消流转失败';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
