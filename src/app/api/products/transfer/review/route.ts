import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 审核流转（服务商审核）
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { transferId, reviewerId, action, reviewNote } = body;

    if (!transferId || !reviewerId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '无效的审核动作' }, { status: 400 });
    }

    // 查询流转记录
    const transfer = await queryOne<any>(
      'SELECT * FROM product_transfers WHERE id = $1',
      [transferId]
    );

    if (!transfer) {
      return NextResponse.json({ error: '流转记录不存在' }, { status: 404 });
    }

    // 验证流转状态
    if (!['awaiting_payment', 'buyer_confirmed', 'seller_confirmed'].includes(transfer.status)) {
      return NextResponse.json({ error: '该流转已被处理或状态不允许审核' }, { status: 400 });
    }

    // 查询产品信息
    const product = await queryOne<any>(
      'SELECT * FROM products WHERE id = $1',
      [transfer.product_id]
    );

    if (!product) {
      return NextResponse.json({ error: '产品不存在' }, { status: 404 });
    }

    // 验证服务商权限
    const userAny = user as { role: string; userId?: string };
    if (userAny.role === 'provider' && product.provider_id !== userAny.userId) {
      return NextResponse.json({ error: '无权审核此流转' }, { status: 403 });
    }

    // ========== 拒绝审核 ==========
    if (action === 'reject') {
      await query(
        `UPDATE product_transfers 
         SET status = 'rejected', updated_at = NOW()
         WHERE id = $1`,
        [transferId]
      );

      // 恢复用户产品状态为持有中
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

      // 恢复产品状态
      await query(
        "UPDATE products SET status = 'available', updated_at = NOW() WHERE id = $1",
        [transfer.product_id]
      );

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
          [marketFee, transfer.to_user_id, `流转审核拒绝，退还市场费 ${marketFee}`]
        );
      }

      return NextResponse.json({ success: true, message: '流转申请已拒绝，市场费已退还买家' });
    }

    // ========== 审核通过 ==========
    
    // 关键检查：卖家必须已确认收款
    if (transfer.status !== 'seller_confirmed') {
      return NextResponse.json({ 
        error: '卖家尚未确认收款，无法审核通过',
        data: { currentStatus: transfer.status }
      }, { status: 400 });
    }

    // 验证买家存在
    if (!transfer.to_user_id) {
      return NextResponse.json({ error: '买家信息缺失' }, { status: 400 });
    }

    // 查询原持有用户（卖方）的购买信息
    const userProduct = await queryOne<any>(
      "SELECT * FROM user_products WHERE product_id = $1 AND user_id = $2 AND status IN ('transferring', 'pending_sell')",
      [transfer.product_id, transfer.from_user_id]
    );

    if (!userProduct) {
      return NextResponse.json({ error: '持仓记录不存在' }, { status: 404 });
    }

    const transferPrice = parseFloat(transfer.transfer_price) || parseFloat(product.price);
    const profitRate = parseFloat(product.profit_rate) || 0;
    const marketRate = parseFloat(product.market_rate) || 0;

    // 卖家收益 = 本金 × profit_rate%
    const sellerProfit = Math.floor(transferPrice * profitRate / 100);

    const completedDate = new Date();

    // 更新流转状态为 completed
    await query(
      `UPDATE product_transfers 
       SET status = 'completed', updated_at = NOW()
       WHERE id = $1`,
      [transferId]
    );

    // 更新卖家的用户产品状态为 transferred
    await query(
      "UPDATE user_products SET status = 'transferred', updated_at = NOW() WHERE id = $1",
      [userProduct.id]
    );

    // 为买家创建新的用户产品记录
    const expectedProfit = Math.floor(transferPrice * profitRate / 100);
    const marketFee = Math.floor(transferPrice * marketRate / 100);
    const periodDays = product.period || 7;

    await query(
      `INSERT INTO user_products 
       (user_id, product_id, purchase_price, purchase_date, expire_date, expected_profit, market_fee, status, created_at)
       VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '1 day' * $4, $5, $6, 'holding', NOW())`,
      [transfer.to_user_id, transfer.product_id, transferPrice, periodDays, expectedProfit, marketFee]
    );

    // 更新产品状态为已售出
    await query(
      "UPDATE products SET status = 'sold', updated_at = NOW() WHERE id = $1",
      [transfer.product_id]
    );

    // 发放收益给卖方（线上收益部分）
    if (sellerProfit > 0) {
      await query(
        'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
        [sellerProfit, transfer.from_user_id]
      );

      // 记录收益交易
      await query(
        `INSERT INTO transactions (user_id, order_id, type, amount, created_at)
         VALUES ($1, NULL, 'sell_profit', $2, NOW())`,
        [
          transfer.from_user_id,
          sellerProfit
        ]
      );

      // 写入会员收益表，以便"我的收益"页面展示
      const [sellerProduct] = await query(
        "SELECT id, purchase_date FROM user_products WHERE product_id = $1 AND user_id = $2 LIMIT 1",
        [transfer.product_id, transfer.from_user_id]
      );
      // 计算持有天数
      let holdingDays = product.period;
      if (sellerProduct?.purchase_date) {
        const purchaseDate = new Date(sellerProduct.purchase_date);
        const now = new Date();
        holdingDays = Math.max(1, Math.floor((now.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24)));
      }
      await query(
        `INSERT INTO member_revenue (user_id, order_id, user_product_id, principal, profit, total_amount, converted_to_energy, status, product_name, product_code, product_period, total_rate, profit_rate, market_rate, holding_days, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 'available', $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
        [
          transfer.from_user_id,
          transfer.id,
          sellerProduct?.id || '',
          transfer.transfer_price,
          sellerProfit,
          transfer.transfer_price + sellerProfit,
          product.name,
          product.code,
          product.period,
          product.total_rate,
          product.profit_rate,
          product.market_rate,
          holdingDays,
        ]
      );
    }

    // 记录流转完成日志
    await query(
      `INSERT INTO transactions (user_id, order_id, type, amount, created_at)
       VALUES ($1, NULL, 'transfer_out', $2, NOW())`,
      [
        transfer.from_user_id,
        transferPrice
      ]
    );

    // 记录买家购买日志
    await query(
      `INSERT INTO transactions (user_id, order_id, type, amount, created_at)
       VALUES ($1, NULL, 'transfer_in', $2, NOW())`,
      [
        transfer.to_user_id,
        transferPrice
      ]
    );

    // 通知卖家流转完成
    await query(
      `INSERT INTO notifications (receiver_id, receiver_role, type, title, content, related_id, status, created_at)
       VALUES ($1, 'member', 'transfer_completed', '流转完成', $2, $3, 'unread', NOW())`,
      [
        transfer.from_user_id,
        `产品 ${product.name} 流转已完成，收益 ¥${sellerProfit} 已到账`,
        transferId
      ]
    );

    // 通知买家流转完成
    await query(
      `INSERT INTO notifications (receiver_id, receiver_role, type, title, content, related_id, status, created_at)
       VALUES ($1, 'member', 'transfer_completed', '流转完成', $2, $3, 'unread', NOW())`,
      [
        transfer.to_user_id,
        `产品 ${product.name} 流转已完成，您已获得产品持仓`,
        transferId
      ]
    );

    return NextResponse.json({
      success: true,
      message: '流转审核通过，产品已转移',
      data: {
        transferId,
        fromUser: transfer.from_user_id,
        toUser: transfer.to_user_id,
        productName: product.name,
        transferPrice,
        sellerProfit,
        profitRate,
        marketFee,
        marketRate,
      }
    });
  } catch (error) {
    console.error('审核流转失败:', error);
    const errorMessage = error instanceof Error ? error.message : '审核流转失败';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
