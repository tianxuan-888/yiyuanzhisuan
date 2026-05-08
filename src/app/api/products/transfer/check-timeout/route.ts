import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 检查超时流转产品，24小时无人购买自动标记为待回购
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { providerId } = body;

    // 从system_config读取回购超时时间（小时），默认24
    const configRes: any = await query(
      "SELECT value FROM system_config WHERE key = 'repurchase_timeout_hours'"
    );
    const configRows = Array.isArray(configRes) ? configRes : (configRes as any)?.rows || [];
    const timeoutHours = configRows.length > 0
      ? parseInt(configRows[0].value) || 24
      : 24;

    // 查找超时的流转记录：状态为pending（无人购买）且创建时间超过指定小时
    const timeoutResult = await query(
      `UPDATE product_transfers
       SET status = 'repurchase_pending',
           updated_at = NOW()
       WHERE status = 'pending'
         AND created_at < NOW() - INTERVAL '1 hour' * $1
       RETURNING id, seller_id, product_id, user_product_id, price`,
      [timeoutHours]
    );

    const timeoutRows = Array.isArray(timeoutResult) ? timeoutResult : (timeoutResult as any)?.rows || [];

    // 同时更新对应的user_products状态为repurchase_pending
    if (timeoutRows.length > 0) {
      const transferIds = timeoutRows.map((t: any) => t.user_product_id);
      for (const upId of transferIds) {
        await query(
          "UPDATE user_products SET status = 'repurchase_pending' WHERE id = $1",
          [upId]
        );
      }

      // 通知卖家：产品已被标记为待回购
      for (const transfer of timeoutRows) {
        await query(
          `INSERT INTO notifications (user_id, type, title, content, is_read, created_at)
           VALUES ($1, 'repurchase', '产品待回购', $2, false, NOW())`,
          [
            transfer.seller_id,
            `您发布的流转产品因${timeoutHours}小时内无人购买，已进入回购流程。服务商将线下返还本金给您，请确认收款后产品将回到在售列表。`
          ]
        );
      }
    }

    // 查询当前所有待回购的流转记录（给服务商看）
    let pendingRepurchases;
    if (providerId) {
      // 服务商只看自己名下产品的待回购
      pendingRepurchases = await query(`
        SELECT pt.*,
               p.name as product_name, p.code as product_code, p.period, p.market_rate, p.profit_rate,
               seller.username as seller_name, seller.phone as seller_phone, seller.unique_id as seller_unique_id,
               up.purchase_price
        FROM product_transfers pt
        LEFT JOIN products p ON p.id = pt.product_id
        LEFT JOIN users seller ON seller.id = pt.seller_id
        LEFT JOIN user_products up ON up.id = pt.user_product_id
        WHERE pt.status IN ('repurchase_pending', 'repurchase_confirmed')
          AND pt.product_id IN (SELECT id FROM products WHERE provider_id = $1)
        ORDER BY pt.updated_at DESC
      `, [providerId]);
    } else {
      pendingRepurchases = await query(`
        SELECT pt.*,
               p.name as product_name, p.code as product_code, p.period, p.market_rate, p.profit_rate,
               seller.username as seller_name, seller.phone as seller_phone, seller.unique_id as seller_unique_id,
               up.purchase_price
        FROM product_transfers pt
        LEFT JOIN products p ON p.id = pt.product_id
        LEFT JOIN users seller ON seller.id = pt.seller_id
        LEFT JOIN user_products up ON up.id = pt.user_product_id
        WHERE pt.status IN ('repurchase_pending', 'repurchase_confirmed')
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
