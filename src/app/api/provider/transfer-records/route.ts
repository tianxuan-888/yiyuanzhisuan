import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

// 获取服务商的产品流转记录（从 product_flow_records 表查询）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!providerId) {
      return NextResponse.json({ success: false, error: '缺少服务商ID' }, { status: 400 });
    }

    const client = createClient(supabaseUrl, supabaseKey);

    // 构建 SQL 查询
    let whereClause = `WHERE provider_id = '${providerId}'`;
    if (startDate) {
      whereClause += ` AND created_at >= '${startDate}'`;
    }
    if (endDate) {
      whereClause += ` AND created_at <= '${endDate} 23:59:59'`;
    }

    const { data: records, error } = await client.rpc('rpc_query', {
      sql_query: `
        SELECT * FROM product_flow_records
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT 200
      `
    });

    if (error) {
      console.error('[transfer-records] 查询失败:', error);
      return NextResponse.json({ success: false, error: '查询失败' }, { status: 500 });
    }

    // 格式化记录
    const formattedRecords = (records || []).map((r: any) => ({
      id: r.id,
      productCode: r.product_code || '',
      productName: r.product_name || 'Token存储包',
      productPrice: r.product_price || 0,
      period: r.period || 0,
      profitRate: r.profit_rate || 0,
      marketRate: r.market_rate || 0,
      transferAmount: r.transfer_amount || 0,
      sellerProfit: r.seller_profit || 0,
      transferType: r.flow_type || '',
      transferTime: r.created_at,
      sellerId: r.seller_id || '',
      sellerName: r.seller_name || '',
      sellerUniqueId: r.seller_unique_id || '',
      sellerPhone: r.seller_phone || '',
      buyerId: r.buyer_id || '',
      buyerName: r.buyer_name || '',
      buyerUniqueId: r.buyer_unique_id || '',
      buyerPhone: r.buyer_phone || '',
    }));

    return NextResponse.json({
      success: true,
      data: formattedRecords,
      total: formattedRecords.length,
    });
  } catch (error) {
    console.error('[transfer-records] 异常:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
