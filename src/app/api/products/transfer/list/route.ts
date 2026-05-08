import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取流转列表（支持流转市场 + 我的流转 + 回购查询）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sellerId = searchParams.get('sellerId');
    const buyerId = searchParams.get('buyerId');
    const userId = searchParams.get('userId'); // 同时查卖家和买家
    const statusFilter = searchParams.get('status');
    const marketMode = searchParams.get('market'); // 'true' 表示获取流转市场

    // ========== 自动超时取消：2小时未付款的流转 ==========
    try {
      const timeoutTransfers = await query(
        `SELECT id, product_id, from_user_id, to_user_id, market_fee 
         FROM product_transfers 
         WHERE status = 'awaiting_payment' 
           AND updated_at < NOW() - INTERVAL '2 hours'`
      );

      if (Array.isArray(timeoutTransfers) && timeoutTransfers.length > 0) {
        for (const t of timeoutTransfers) {
          // 恢复产品状态
          await query(
            "UPDATE products SET status = 'available', updated_at = NOW() WHERE id = $1",
            [t.product_id]
          );

          // 恢复卖家持仓状态
          const sellerUp = await query(
            "SELECT id FROM user_products WHERE product_id = $1 AND user_id = $2 AND status = 'transferring'",
            [t.product_id, t.from_user_id]
          );
          if (Array.isArray(sellerUp) && sellerUp.length > 0) {
            await query(
              "UPDATE user_products SET status = 'holding', updated_at = NOW() WHERE id = $1",
              [sellerUp[0].id]
            );
          }

          // 退还买家能量值
          const marketFee = parseFloat(t.market_fee) || 0;
          if (marketFee > 0 && t.to_user_id) {
            await query(
              'UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2',
              [marketFee, t.to_user_id]
            );
            await query(
              `INSERT INTO energy_transactions (user_id, type, amount, from_user_id, to_user_id, note, status, created_at)
               VALUES ($2, 'transfer_in', $1, NULL, $2, $3, 'completed', NOW())`,
              [marketFee, t.to_user_id, `流转超时取消，退还市场费 ${marketFee}`]
            );
          }

          // 重新发布流转（恢复为pending，让其他会员可购买）
          await query(
            `UPDATE product_transfers 
             SET status = 'pending', to_user_id = NULL, market_fee = NULL, expected_profit = NULL,
                 buyer_confirmed_at = NULL, seller_confirmed = false,
                 expires_at = NOW() + INTERVAL '48 hours', updated_at = NOW()
             WHERE id = $1`,
            [t.id]
          );

          // 通知卖家和买家
          if (t.from_user_id) {
            await query(
              `INSERT INTO notifications (user_id, type, title, content, related_id, created_at)
               VALUES ($1, 'transfer_cancelled', '流转超时取消', $2, $3, NOW())`,
              [t.from_user_id, '买家付款超时，流转已自动取消，产品已重新上架到流转市场', t.id]
            );
          }
          if (t.to_user_id) {
            await query(
              `INSERT INTO notifications (user_id, type, title, content, related_id, created_at)
               VALUES ($1, 'transfer_cancelled', '流转超时取消', $2, $3, NOW())`,
              [t.to_user_id, '付款超时，流转已自动取消，市场费已退还', t.id]
            );
          }
        }
      }
    } catch (timeoutErr) {
      console.error('自动超时处理失败:', timeoutErr);
      // 不影响主查询
    }

    // 构建SQL查询
    let whereClause = '1=1';
    const params: any[] = [];
    let paramIdx = 1;

    // 流转市场模式：只显示 pending 且未过期的
    if (marketMode === 'true') {
      whereClause += ` AND pt.status = 'pending' AND pt.expires_at > NOW()`;
    } else {
      // 按状态过滤
      if (statusFilter) {
        if (statusFilter.includes(',')) {
          const statuses = statusFilter.split(',').map((s: string) => `'${s}'`).join(',');
          whereClause += ` AND pt.status IN (${statuses})`;
        } else {
          params.push(statusFilter);
          whereClause += ` AND pt.status = $${paramIdx++}`;
        }
      }

      // 按卖家过滤
      if (sellerId) {
        params.push(sellerId);
        whereClause += ` AND pt.from_user_id = $${paramIdx++}`;
      }

      // 按买家过滤
      if (buyerId) {
        params.push(buyerId);
        whereClause += ` AND pt.to_user_id = $${paramIdx++}`;
      }

      // 按用户过滤（同时查卖家和买家）
      if (userId) {
        params.push(userId);
        params.push(userId);
        whereClause += ` AND (pt.from_user_id = $${paramIdx++} OR pt.to_user_id = $${paramIdx++})`;
      }
    }

    const transfers = await query(
      `SELECT pt.*,
              p.name as product_name, p.code as product_code, p.price, p.period,
              p.total_rate, p.market_rate, p.profit_rate, p.image_url, p.provider_id,
              seller.username as seller_name, seller.phone as seller_phone, seller.unique_id as seller_unique_id,
              seller.alipay_account as seller_alipay_account,
              buyer.username as buyer_name, buyer.phone as buyer_phone, buyer.unique_id as buyer_unique_id
       FROM product_transfers pt
       LEFT JOIN products p ON p.id = pt.product_id
       LEFT JOIN users seller ON seller.id = pt.from_user_id
       LEFT JOIN users buyer ON buyer.id = pt.to_user_id
       WHERE ${whereClause}
       ORDER BY pt.created_at DESC`,
      params
    );

    // 计算每个产品的剩余时间 + 付款倒计时
    const now = Date.now();
    const result = (Array.isArray(transfers) ? transfers : []).map((t: any) => {
      // 付款倒计时：2小时减去已过时间
      let paymentCountdown = 0;
      if (t.status === 'awaiting_payment' && t.updated_at) {
        const elapsed = (now - new Date(t.updated_at).getTime()) / 1000;
        paymentCountdown = Math.max(0, 7200 - elapsed); // 2小时 = 7200秒
      }

      return {
        ...t,
        remainingSeconds: t.expires_at 
          ? Math.max(0, Math.floor((new Date(t.expires_at).getTime() - now) / 1000))
          : 0,
        paymentCountdown, // 付款剩余秒数
        price: t.transfer_price,
      };
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('获取流转列表失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    );
  }
}
