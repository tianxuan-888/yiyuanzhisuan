import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const queryProviderId = searchParams.get('providerId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    let providerId = queryProviderId;

    if (!providerId) {
      return NextResponse.json({ success: false, error: '缺少服务商ID' }, { status: 400 });
    }

    const client = createClient(supabaseUrl, supabaseKey);

    console.log('[transfer-records] 请求参数:', { providerId, startDate, endDate });

    // ===== Step 1: 查询该服务商的所有产品 =====
    const { data: providerProducts, error: prodError } = await client
      .from('products')
      .select('id, code, name, price, period, profit_rate, market_rate, provider_id')
      .eq('provider_id', providerId);

    if (prodError) {
      console.error('[transfer-records] 查询产品失败:', JSON.stringify(prodError));
      return NextResponse.json({ success: false, error: '获取产品失败' }, { status: 500 });
    }

    console.log('[transfer-records] 服务商产品数量:', providerProducts?.length || 0);

    if (!providerProducts || providerProducts.length === 0) {
      return NextResponse.json({ success: true, data: [], total: 0 });
    }

    const productMap = new Map(providerProducts.map(p => [p.id, p]));
    const productIds = providerProducts.map(p => p.id);

    // ===== Step 2: 查询 user_products（先不带可能不存在的字段）=====
    const { data: allUserProducts, error: upError } = await client
      .from('user_products')
      .select('id, user_id, product_id, purchase_price, purchase_date, expire_date, expected_profit, market_fee, status, created_at, updated_at')
      .in('product_id', productIds)
      .order('created_at', { ascending: false });

    if (upError) {
      console.error('[transfer-records] 查询用户产品失败:', JSON.stringify(upError));
    }

    console.log('[transfer-records] 用户产品数量:', allUserProducts?.length || 0);

    // ===== Step 3: 尝试查 seller_id 和 transfer_type（可能字段不存在）=====
    let sellerIdMap = new Map<string, string | null>();
    let transferTypeMap = new Map<string, string | null>();

    try {
      const { data: upWithSeller, error: sellerError } = await client
        .from('user_products')
        .select('id, seller_id, transfer_type')
        .in('product_id', productIds);

      if (!sellerError && upWithSeller) {
        upWithSeller.forEach(up => {
          sellerIdMap.set(up.id, up.seller_id || null);
          transferTypeMap.set(up.id, up.transfer_type || null);
        });
        console.log('[transfer-records] seller_id数据条数:', upWithSeller.length);
      } else {
        console.log('[transfer-records] seller_id字段可能不存在:', sellerError?.message || '无数据');
      }
    } catch (e) {
      console.log('[transfer-records] seller_id查询异常:', e);
    }

    // ===== Step 4: 查询 orders 表 =====
    const { data: allOrders, error: orderError } = await client
      .from('orders')
      .select('id, user_id, user_product_id, order_type, amount, status, created_at')
      .in('order_type', ['buy', 'sell'])
      .order('created_at', { ascending: false })
      .limit(500);

    if (orderError) {
      console.error('[transfer-records] 查询订单失败:', JSON.stringify(orderError));
    }

    console.log('[transfer-records] 订单数量:', allOrders?.length || 0);

    // ===== Step 5: 时间范围 =====
    let timeStart: Date;
    let timeEnd: Date;

    if (startDate && endDate) {
      timeStart = new Date(startDate);
      timeEnd = new Date(endDate + 'T23:59:59');
    } else {
      timeStart = new Date();
      timeStart.setDate(timeStart.getDate() - 2);
      timeEnd = new Date();
    }

    console.log('[transfer-records] 时间范围:', timeStart.toISOString(), '~', timeEnd.toISOString());

    // ===== Step 6: 收集所有用户ID =====
    const userIds = new Set<string>();
    userIds.add(providerId);

    (allUserProducts || []).forEach(up => {
      if (up.user_id) userIds.add(up.user_id);
      const sid = sellerIdMap.get(up.id);
      if (sid) userIds.add(sid);
    });

    (allOrders || []).forEach(o => {
      if (o.user_id) userIds.add(o.user_id);
    });

    // 批量获取用户信息
    const { data: users } = await client
      .from('users')
      .select('id, username, phone, unique_id, real_name')
      .in('id', Array.from(userIds));

    const userMap = new Map((users || []).map(u => [u.id, u]));
    console.log('[transfer-records] 用户信息数量:', users?.length || 0);

    // 获取服务商信息
    const { data: providerUser } = await client
      .from('users')
      .select('id, username, phone, unique_id, real_name')
      .eq('id', providerId)
      .single();

    // ===== Step 7: 组装流转记录 =====
    const records: any[] = [];

    // 7.1 从 user_products 提取
    (allUserProducts || []).forEach(up => {
      const product = productMap.get(up.product_id);
      if (!product) return;

      const recordTime = new Date(up.created_at);
      if (recordTime < timeStart || recordTime > timeEnd) return;

      const buyer = userMap.get(up.user_id);
      const sellerId = sellerIdMap.get(up.id);
      const transferType = transferTypeMap.get(up.id);
      const hasSeller = sellerId && sellerId !== up.user_id;
      const seller = hasSeller ? userMap.get(sellerId!) : null;
      const profitRate = product.profit_rate || 0;
      const transferAmount = up.purchase_price || 0;

      let finalTransferType: string;
      let sellerName: string;
      let sellerUniqueId: string;
      let sellerPhone: string;
      let finalSellerId: string;
      let sellerProfit: number;

      if (hasSeller) {
        finalTransferType = transferType || 'member_transfer';
        finalSellerId = sellerId!;
        sellerName = seller?.username || '';
        sellerUniqueId = seller?.unique_id || '';
        sellerPhone = seller?.phone || '';
        sellerProfit = transferAmount * profitRate / 100;
      } else {
        finalTransferType = 'provider_match';
        finalSellerId = providerId;
        sellerName = providerUser?.username || '服务商';
        sellerUniqueId = providerUser?.unique_id || '';
        sellerPhone = providerUser?.phone || '';
        // 服务商匹配：服务商收益 = 产品价格 × 服务商市场费分成比例(2%)
        const marketRate = product.market_rate || 0;
        const providerShare = 0.02; // 服务商占产品价格的2%
        sellerProfit = transferAmount * providerShare;
      }

      records.push({
        id: `up-${up.id}`,
        productCode: product.code || '',
        productName: product.name || 'Token存储包',
        productPrice: product.price || 0,
        period: product.period || 0,
        profitRate: profitRate,
        transferAmount: transferAmount,
        sellerProfit: sellerProfit,
        transferType: finalTransferType,
        transferTime: up.created_at,
        sellerId: finalSellerId,
        sellerName: sellerName,
        sellerUniqueId: sellerUniqueId,
        sellerPhone: sellerPhone,
        sellerRealName: seller?.real_name || '',
        buyerId: up.user_id,
        buyerName: buyer?.username || '',
        buyerUniqueId: buyer?.unique_id || '',
        buyerPhone: buyer?.phone || '',
        buyerRealName: buyer?.real_name || '',
      });
    });

    // 7.2 从 orders 补充（确保不遗漏）
    const userProductMap = new Map((allUserProducts || []).map(up => [up.id, up]));

    (allOrders || []).forEach(order => {
      if (!order.user_product_id) return;
      const up = userProductMap.get(order.user_product_id);
      if (!up) return;
      const product = productMap.get(up.product_id);
      if (!product) return;

      const recordTime = new Date(order.created_at);
      if (recordTime < timeStart || recordTime > timeEnd) return;

      // 检查是否已经从user_products添加过
      const existingId = `up-${up.id}`;
      if (records.some(r => r.id === existingId)) return;

      const buyer = userMap.get(order.user_id);
      const sellerId = sellerIdMap.get(up.id);
      const hasSeller = sellerId && sellerId !== up.user_id;
      const seller = hasSeller ? userMap.get(sellerId!) : null;
      const profitRate = product.profit_rate || 0;
      const transferAmount = up.purchase_price || order.amount || 0;

      let finalTransferType: string;
      let sellerName: string;
      let sellerUniqueId: string;
      let sellerPhone: string;
      let finalSellerId: string;
      let sellerProfit: number;

      if (hasSeller) {
        finalTransferType = order.order_type === 'sell' ? 'member_transfer' : (transferTypeMap.get(up.id) || 'member_transfer');
        finalSellerId = sellerId!;
        sellerName = seller?.username || '';
        sellerUniqueId = seller?.unique_id || '';
        sellerPhone = seller?.phone || '';
        sellerProfit = transferAmount * profitRate / 100;
      } else {
        finalTransferType = 'provider_match';
        finalSellerId = providerId;
        sellerName = providerUser?.username || '服务商';
        sellerUniqueId = providerUser?.unique_id || '';
        sellerPhone = providerUser?.phone || '';
        // 服务商匹配：服务商收益 = 产品价格 × 服务商市场费分成比例(2%)
        const providerShare = 0.02;
        sellerProfit = transferAmount * providerShare;
      }

      records.push({
        id: `order-${order.id}`,
        productCode: product.code || '',
        productName: product.name || 'Token存储包',
        productPrice: product.price || 0,
        period: product.period || 0,
        profitRate: profitRate,
        transferAmount: transferAmount,
        sellerProfit: sellerProfit,
        transferType: finalTransferType,
        transferTime: order.created_at,
        sellerId: finalSellerId,
        sellerName: sellerName,
        sellerUniqueId: sellerUniqueId,
        sellerPhone: sellerPhone,
        sellerRealName: seller?.real_name || '',
        buyerId: order.user_id,
        buyerName: buyer?.username || '',
        buyerUniqueId: buyer?.unique_id || '',
        buyerPhone: buyer?.phone || '',
        buyerRealName: buyer?.real_name || '',
      });
    });

    // 按时间倒序排列
    records.sort((a, b) => new Date(b.transferTime).getTime() - new Date(a.transferTime).getTime());

    console.log('[transfer-records] 最终记录数:', records.length);

    return NextResponse.json({
      success: true,
      data: records,
      total: records.length,
    });
  } catch (error) {
    console.error('[transfer-records] 获取流转记录失败:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
