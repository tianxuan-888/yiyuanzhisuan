import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// GET /api/products/transfer/market - 获取流转市场中的产品列表（供会员购买）
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const memberId = searchParams.get('memberId');

        // 1. 获取所有状态为 pending 或 awaiting_payment 的流转产品（新流程）
        const transfers = await query(`
            SELECT 
                pt.id,
                pt.product_id,
                pt.from_user_id as seller_id,
                pt.to_user_id as buyer_id,
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
            JOIN users u_s ON u_s.id = pt.from_user_id
            LEFT JOIN users u_b ON u_b.id = pt.to_user_id
            WHERE pt.status IN ('pending', 'awaiting_payment', 'seller_confirmed')
            ORDER BY pt.created_at DESC
        `);

        // 2. 获取没有 product_transfers 记录但状态为 pending_sell 的产品（旧流程兼容）
        // 这些是旧 orders/sell 流程的卖出申请，也需要在流转市场展示
        const legacyTransfers = await query(`
            SELECT 
                up.id as transfer_id,
                up.product_id,
                up.user_id as seller_id,
                NULL::uuid as buyer_id,
                'pending' as status,
                false as seller_confirmed,
                up.updated_at as created_at,
                up.updated_at,
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
                NULL::text as buyer_name,
                NULL::text as buyer_unique_id
            FROM user_products up
            JOIN products p ON p.id = up.product_id
            JOIN users u_s ON u_s.id = up.user_id
            WHERE up.status = 'pending_sell'
            AND NOT EXISTS (
                SELECT 1 FROM product_transfers pt 
                WHERE pt.product_id = up.product_id 
                AND pt.from_user_id = up.user_id
                AND pt.status IN ('pending', 'awaiting_payment', 'seller_confirmed')
            )
            ORDER BY up.updated_at DESC
        `);

        // 合并结果
        let result = [...transfers, ...legacyTransfers];

        // 如果传了memberId，过滤掉自己发布的流转
        if (memberId) {
            result = result.filter((t: any) => t.seller_id !== memberId);
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
