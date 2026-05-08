import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 获取服务商待审核流转列表（seller_confirmed状态的流转）
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || !['admin', 'provider'].includes(user.role)) {
      return NextResponse.json({ error: '无权访问' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    if (!providerId) {
      return NextResponse.json(
        { error: '缺少服务商ID' },
        { status: 400 }
      );
    }

    const from = (page - 1) * pageSize;

    // 查询该服务商下产品的所有进行中流转记录（awaiting_payment, buyer_confirmed, seller_confirmed）
    const transfers = await query(
      `SELECT pt.*,
              p.name as product_name, p.code as product_code, p.price, p.period,
              p.total_rate, p.market_rate, p.profit_rate, p.provider_id,
              seller.username as seller_name, seller.phone as seller_phone, 
              seller.real_name as seller_real_name, seller.unique_id as seller_unique_id,
              seller.alipay_account as seller_alipay_account,
              buyer.username as buyer_name, buyer.phone as buyer_phone,
              buyer.real_name as buyer_real_name, buyer.unique_id as buyer_unique_id,
              buyer.alipay_account as buyer_alipay_account
       FROM product_transfers pt
       LEFT JOIN products p ON p.id = pt.product_id
       LEFT JOIN users seller ON seller.id = pt.from_user_id
       LEFT JOIN users buyer ON buyer.id = pt.to_user_id
       WHERE pt.status IN ('awaiting_payment', 'buyer_confirmed', 'seller_confirmed')
         AND p.provider_id = $1
       ORDER BY 
         CASE pt.status 
           WHEN 'seller_confirmed' THEN 1 
           WHEN 'buyer_confirmed' THEN 2 
           WHEN 'awaiting_payment' THEN 3 
         END,
         pt.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [providerId, pageSize, from]
    );

    // 查询总数
    const countResult = await query(
      `SELECT COUNT(*) as total
       FROM product_transfers pt
       LEFT JOIN products p ON p.id = pt.product_id
       WHERE pt.status IN ('awaiting_payment', 'buyer_confirmed', 'seller_confirmed')
         AND p.provider_id = $1`,
      [providerId]
    );

    const total = Array.isArray(countResult) && countResult.length > 0 
      ? parseInt(countResult[0].total) 
      : 0;

    return NextResponse.json({
      success: true,
      data: {
        list: transfers || [],
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('获取待审核流转失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    );
  }
}
