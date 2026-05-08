import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 卖家确认收款
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { transferId } = body;

    if (!transferId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 使用 token 中的 userId 作为操作者身份
    const operatorUserId = user.userId;

    // 查询流转记录
    const transfer = await queryOne<any>(
      'SELECT * FROM product_transfers WHERE id = $1',
      [transferId]
    );

    if (!transfer) {
      return NextResponse.json({ error: '流转记录不存在' }, { status: 404 });
    }

    // 验证是否是卖家本人
    if (transfer.from_user_id !== operatorUserId) {
      return NextResponse.json({ error: '只有卖家才能确认收款' }, { status: 403 });
    }

    // 验证流转状态必须是 awaiting_payment 或 buyer_confirmed（买家已确认付款，卖家可确认收款）
    if (!['awaiting_payment', 'buyer_confirmed'].includes(transfer.status)) {
      return NextResponse.json({ 
        error: transfer.status === 'seller_confirmed' 
          ? '您已确认过收款' 
          : '当前状态无法确认收款' 
      }, { status: 400 });
    }

    // 更新流转状态为 seller_confirmed
    await query(
      `UPDATE product_transfers 
       SET status = 'seller_confirmed', seller_confirmed = true, updated_at = NOW()
       WHERE id = $1`,
      [transferId]
    );

    // 通知服务商有新的流转需要审核
    const product = await queryOne<any>(
      'SELECT * FROM products WHERE id = $1',
      [transfer.product_id]
    );

    if (product?.provider_id) {
      const buyer = await queryOne<any>(
        'SELECT username FROM users WHERE id = $1',
        [transfer.to_user_id]
      );
      const seller = await queryOne<any>(
        'SELECT username FROM users WHERE id = $1',
        [operatorUserId]
      );

      const providerUser = await queryOne<any>('SELECT role FROM users WHERE id = $1', [product.provider_id]);
      await query(
        `INSERT INTO notifications (receiver_id, receiver_role, type, title, content, related_id, status, created_at)
         VALUES ($1, $2, 'transfer_review', '流转审核通知', $3, $4, 'unread', NOW())`,
        [
          product.provider_id,
          providerUser?.role || 'provider',
          `卖家 ${seller?.username || ''}已确认收款，产品 ${product.name || ''} 买家 ${buyer?.username || ''}，请审核确认流转`,
          transferId
        ]
      );
    }

    return NextResponse.json({
      success: true,
      message: '已确认收款，等待服务商审核确认流转'
    });
  } catch (error) {
    console.error('确认收款失败:', error);
    const errorMessage = error instanceof Error ? error.message : '确认收款失败';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
