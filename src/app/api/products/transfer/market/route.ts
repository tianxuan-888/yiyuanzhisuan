import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// GET /api/products/transfer/market - 获取流转市场中的产品列表（供会员购买）
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const memberId = searchParams.get('memberId');

        // 获取所有状态为 pending 或 awaiting_payment 的流转产品
        const transfers = await query(`
            SELECT 
                pt.id,
                pt.product_id,
                pt.seller_id,
                pt.buyer_id,
                pt.status,
                pt.seller_confirmed,
                pt.created_at,
                pt.updated_at,
                p.name as product_name,
                p.code as product_code,
                p.price,
                p.period,
                p.total_rate,
                p.market_rate,
                p.profit_rate,
                p.image_url,
                p.provider_id,
                u_s.username as seller_name,
                u_s.unique_id as seller_unique_id,
                u_s.phone as seller_phone,
                u_b.username as buyer_name,
                u_b.unique_id as buyer_unique_id
            FROM product_transfers pt
            JOIN products p ON p.id = pt.product_id
            JOIN users u_s ON u_s.id = pt.seller_id
            LEFT JOIN users u_b ON u_b.id = pt.buyer_id
            WHERE pt.status IN ('pending', 'awaiting_payment')
            ORDER BY pt.created_at DESC
        `);

        // 如果传了memberId，过滤掉自己发布的流转
        let result = transfers;
        if (memberId) {
            result = transfers.filter((t: any) => t.seller_id !== memberId);
        }

        return NextResponse.json({
            success: true,
            data: result
        });
    } catch (error: any) {
        console.error('获取流转市场失败:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
