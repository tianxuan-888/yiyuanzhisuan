import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 会员确认回购收款 - 产品回到服务商在售列表
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transferId, userId } = body;

    if (!transferId || !userId) {
      return NextResponse.json({ success: false, error: '缺少必要参数' }, { status: 400 });
    }

    // 查询流转记录
    const transferRes = await query(
      'SELECT * FROM product_transfers WHERE id = $1',
      [transferId]
    ) as any[];
    if (transferRes.length === 0) {
      return NextResponse.json({ success: false, error: '流转记录不存在' }, { status: 404 });
    }

    const transfer = transferRes[0];

    // 验证是卖家本人
    if (transfer.from_user_id !== userId) {
      return NextResponse.json({ success: false, error: '只能由卖家确认收款' }, { status: 403 });
    }

    // 验证状态必须是repurchase_confirmed 或 pending_repurchase
    if (!['repurchase_confirmed', 'pending_repurchase'].includes(transfer.status)) {
      return NextResponse.json({ success: false, error: '当前状态不允许确认' }, { status: 400 });
    }

    // 更新流转状态为repurchased
    await query(
      `UPDATE product_transfers SET status = 'repurchased', updated_at = NOW() WHERE id = $1`,
      [transferId]
    );

    // 更新用户产品状态：从transferring变为repurchased
    await query(
      `UPDATE user_products SET status = 'repurchased', updated_at = NOW() 
       WHERE product_id = $1 AND user_id = $2 AND status IN ('transferring', 'repurchase_pending')`,
      [transfer.product_id, userId]
    );

    // 产品回到服务商在售列表
    await query(
      `UPDATE products SET status = 'available', updated_at = NOW() WHERE id = $1`,
      [transfer.product_id]
    );

    // 通知服务商：会员已确认回购收款，产品回到在售列表
    const productRes = await query(
      'SELECT provider_id FROM products WHERE id = $1',
      [transfer.product_id]
    ) as any[];
    if (productRes.length > 0 && productRes[0].provider_id) {
      await query(
        `INSERT INTO notifications (receiver_id, receiver_role, type, title, content, created_at)
         VALUES ($1, 'provider', 'repurchase_completed', '回购完成', $2, NOW())`,
        [
          productRes[0].provider_id,
          `会员已确认回购收款（Token值¥${transfer.transfer_price}），产品已回到您的在售列表。`
        ]
      );
    }

    return NextResponse.json({
      success: true,
      message: '确认收款成功，产品已回到服务商在售列表',
      data: { transferId, status: 'repurchased' }
    });
  } catch (error: any) {
    console.error('[confirm-repurchase] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
