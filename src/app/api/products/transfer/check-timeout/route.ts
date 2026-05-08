import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 检查超时流转产品，超时无人购买自动标记为待回购
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { providerId } = body;

    // 从system_config读取回购超时时间（小时），默认24
    const configRes: any = await query(
      "SELECT value FROM system_config WHERE key = 'repurchase_timeout_hours'"
    );
    const configRows = Array.isArray(configRes) ? configRes : [];
    const timeoutHours = configRows.length > 0
      ? parseInt(configRows[0].value) || 24
      : 24;

    // 查找超时的流转记录：状态为pending（无人购买）且创建时间超过指定小时
    const timeoutResult = await query(
      `UPDATE product_transfers
       SET status = 'pending_repurchase',
           updated_at = NOW()
       WHERE status = 'pending'
         AND expires_at < NOW()
       RETURNING id, from_user_id, product_id, transfer_price`,
      [timeoutHours]
    );

    const timeoutRows = Array.isArray(timeoutResult) ? timeoutResult : [];

    // 同时更新对应的user_products状态为repurchase_pending
    if (timeoutRows.length > 0) {
      for (const transfer of timeoutRows) {
        // 更新卖家的持仓状态
        await query(
          "UPDATE user_products SET status = 'repurchase_pending', updated_at = NOW() WHERE product_id = $1 AND user_id = $2 AND status = 'transferring'",
          [transfer.product_id, transfer.from_user_id]
        );

        // 更新产品状态回 available
        await query(
          "UPDATE products SET status = 'available', updated_at = NOW() WHERE id = $1",
          [transfer.product_id]
        );

        // 通知卖家：产品已被标记为待回购
        await query(
          `INSERT INTO notifications (receiver_id, receiver_role, type, title, content, created_at)
           VALUES ($1, 'member', 'repurchase', '产品待回购', $2, NOW())`,
          [
            transfer.from_user_id,
            `您发布的流转产品因${timeoutHours}小时内无人购买，已进入回购流程。服务商将线下返还本金给您，请确认收款后产品将回到在售列表。`
          ]
        );
      }
    }

    // 查询当前所有待回购的流转记录（给服务商看）
    let pendingRepurchases;
    if (providerId) {
      pendingRepurchases = await query(`
        SELECT pt.id, pt.product_id, pt.from_user_id, pt.to_user_id, pt.transfer_price, pt.status,
               pt.created_at, pt.updated_at,
               p.name as product_name, p.code as product_code, p.period, p.market_rate, p.profit_rate,
               seller.username as seller_name, seller.phone as seller_phone, seller.unique_id as seller_unique_id
        FROM product_transfers pt
        LEFT JOIN products p ON p.id = pt.product_id
        LEFT JOIN users seller ON seller.id = pt.from_user_id
        WHERE pt.status IN ('pending_repurchase', 'repurchase_confirmed')
          AND pt.product_id IN (SELECT id FROM products WHERE provider_id = $1)
        ORDER BY pt.updated_at DESC
      `, [providerId]);
    } else {
      pendingRepurchases = await query(`
        SELECT pt.id, pt.product_id, pt.from_user_id, pt.to_user_id, pt.transfer_price, pt.status,
               pt.created_at, pt.updated_at,
               p.name as product_name, p.code as product_code, p.period, p.market_rate, p.profit_rate,
               seller.username as seller_name, seller.phone as seller_phone, seller.unique_id as seller_unique_id
        FROM product_transfers pt
        LEFT JOIN products p ON p.id = pt.product_id
        LEFT JOIN users seller ON seller.id = pt.from_user_id
        WHERE pt.status IN ('pending_repurchase', 'repurchase_confirmed')
        ORDER BY pt.updated_at DESC
      `);
    }

    const pendingRepurchasesArr = Array.isArray(pendingRepurchases) ? pendingRepurchases : [];

    return NextResponse.json({
      success: true,
      data: {
        markedAsPending: timeoutRows.length,
        timeoutHours,
        pendingRepurchases: pendingRepurchasesArr
      }
    });
  } catch (error: any) {
    console.error('[check-timeout] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
