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
      return NextResponse.json({ error: '只有卖家才能确认收款' }, { status: 403 });
    }

    // 验证流转状态必须是 awaiting_payment（有买家购买但卖家未确认）
    if (transfer.status !== 'awaiting_payment') {
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
        [userId]
      );

      await query(
        `INSERT INTO notifications (receiver_id, receiver_role, sender_id, sender_name, type, title, content, related_id, created_at)
         VALUES ($1, 'provider', $2, $3, 'transfer_review', '流转审核通知', $4, $5, NOW())`,
        [
          product.provider_id,
          userId,
          seller?.username || '卖家',
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
