import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 服务商确认回购 - 标记为待会员确认
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transferId, providerId } = body;

    if (!transferId || !providerId) {
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

    // 验证状态必须是repurchase_pending
    if (transfer.status !== 'repurchase_pending') {
      return NextResponse.json({ success: false, error: '当前状态不允许回购，必须为待回购状态' }, { status: 400 });
    }

    // 验证服务商是产品的provider
    const productRes = await query(
      'SELECT provider_id FROM products WHERE id = $1',
      [transfer.product_id]
    ) as any[];
    if (productRes.length === 0 || productRes[0].provider_id !== providerId) {
      return NextResponse.json({ success: false, error: '您不是该产品的服务商' }, { status: 403 });
    }

    // 更新流转状态为repurchase_confirmed（服务商确认回购，等待会员确认收款）
    await query(
      `UPDATE product_transfers SET status = 'repurchase_confirmed', updated_at = NOW() WHERE id = $1`,
      [transferId]
    );

    // 通知卖家：服务商已确认回购，请确认收到Token值
    await query(
      `INSERT INTO notifications (receiver_id, receiver_role, type, title, content, created_at)
       VALUES ($1, 'member', 'repurchase_confirm', '请确认回购收款', $2, NOW())`,
      [
        transfer.from_user_id,
        `服务商已确认回购您的流转产品（Token值¥${transfer.transfer_price}），请在线下确认收到Token值后在系统中确认收款。`
      ]
    );

    return NextResponse.json({
      success: true,
      message: '回购确认成功，已通知会员确认收款',
      data: { transferId, status: 'repurchase_confirmed' }
    });
  } catch (error: any) {
    console.error('[repurchase] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
