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
      .select('id, code, name, price, period, profit_rate, market_rate, provider_id, previous_holder_id, previous_holder_name')
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

    // ===== Step 2: 查询 user_products =====
    const { data: allUserProducts, error: upError } = await client
      .from('user_products')
      .select('id, user_id, product_id, purchase_price, purchase_date, expire_date, expected_profit, market_fee, status, created_at, updated_at')
      .in('product_id', productIds)
      .order('created_at', { ascending: false });

    if (upError) {
      console.error('[transfer-records] 查询用户产品失败:', JSON.stringify(upError));
    }

    console.log('[transfer-records] 用户产品数量:', allUserProducts?.length || 0);

    // ===== Step 3: 构建卖方映射 - 通过同一产品的历史持有记录确定真正的卖方 =====
    // 核心逻辑：如果一个产品有多条 user_products 记录，按时间排序后，
    // 当前记录的卖方 = 上一条记录的买方（上一个持有者）
    // 如果是第一条记录（首次购买），卖方 = 服务商

    // 按产品ID分组，每组按创建时间排序
    const productHistoryMap = new Map<string, Array<{ upId: string; userId: string; createdAt: string }>>();
    (allUserProducts || []).forEach(up => {
      if (!productHistoryMap.has(up.product_id)) {
        productHistoryMap.set(up.product_id, []);
      }
      productHistoryMap.get(up.product_id)!.push({
        upId: up.id,
        userId: up.user_id,
        createdAt: up.created_at,
      });
    });

    // 每组按时间正序排列（最早在前）
    productHistoryMap.forEach((history, _productId) => {
      history.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    });

    // 构建 user_product.id → 卖方用户ID 的映射
    const sellerIdMap = new Map<string, string | null>();
    productHistoryMap.forEach((history) => {
      history.forEach((record, idx) => {
        if (idx === 0) {
          // 第一条记录：首次从服务商购买，没有上一个持有者
          sellerIdMap.set(record.upId, null);
        } else {
          // 后续记录：卖方 = 上一条记录的买方
          sellerIdMap.set(record.upId, history[idx - 1].userId);
        }
      });
    });

    // 同时从 products 表获取 previous_holder 作为补充（针对已流转走的记录）
    const prevHolderFromProduct = new Map<string, string | null>();
    const { data: productsWithHolder } = await client
      .from('products')
      .select('id, previous_holder_id')
      .in('id', productIds);
    
    if (productsWithHolder) {
      productsWithHolder.forEach(p => {
        prevHolderFromProduct.set(p.id, p.previous_holder_id || null);
      });
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
      // 从 sellerIdMap 获取卖方ID
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
      const prevSellerId = sellerIdMap.get(up.id);
      // 如果 sellerIdMap 没有，尝试从 products.previous_holder_id 补充
      const fallbackHolderId = prevHolderFromProduct.get(up.product_id);
      const effectiveSellerId = prevSellerId || (fallbackHolderId && fallbackHolderId !== up.user_id ? fallbackHolderId : null);
      const hasPrevSeller = !!effectiveSellerId && effectiveSellerId !== up.user_id;
      const sellerUser = hasPrevSeller ? userMap.get(effectiveSellerId!) : null;
      const profitRate = product.profit_rate || 0;
      const transferAmount = up.purchase_price || 0;

      let finalTransferType: string;
      let sellerName: string;
      let sellerUniqueId: string;
      let sellerPhone: string;
      let finalSellerId: string;
      let sellerProfit: number;
      let sellerRealName: string;

      if (hasPrevSeller) {
        // 有上一个持有者 → 会员间流转，卖方是上一个持有者
        finalTransferType = 'member_transfer';
        finalSellerId = effectiveSellerId!;
        sellerName = sellerUser?.username || '未知用户';
        sellerUniqueId = sellerUser?.unique_id || '';
        sellerPhone = sellerUser?.phone || '';
        sellerRealName = sellerUser?.real_name || '';
        sellerProfit = transferAmount * profitRate / 100;
      } else {
        // 没有上一个持有者 → 首次从服务商处购买，服务商是卖方
        finalTransferType = 'provider_match';
        finalSellerId = providerId;
        sellerName = providerUser?.username || '服务商';
        sellerUniqueId = providerUser?.unique_id || '';
        sellerPhone = providerUser?.phone || '';
        sellerRealName = providerUser?.real_name || '';
        const marketRate = product.market_rate || 0;
        const providerShare = 0.02;
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
        sellerRealName: sellerRealName,
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
      const prevSellerId = sellerIdMap.get(up.id);
      const fallbackHolderId = prevHolderFromProduct.get(up.product_id);
      const effectiveSellerId = prevSellerId || (fallbackHolderId && fallbackHolderId !== up.user_id ? fallbackHolderId : null);
      const hasPrevSeller = !!effectiveSellerId && effectiveSellerId !== up.user_id;
      const sellerUser = hasPrevSeller ? userMap.get(effectiveSellerId!) : null;
      const profitRate = product.profit_rate || 0;
      const transferAmount = up.purchase_price || order.amount || 0;

      let finalTransferType: string;
      let sellerName: string;
      let sellerUniqueId: string;
      let sellerPhone: string;
      let finalSellerId: string;
      let sellerProfit: number;
      let sellerRealName: string;

      if (hasPrevSeller) {
        finalTransferType = 'member_transfer';
        finalSellerId = effectiveSellerId!;
        sellerName = sellerUser?.username || '未知用户';
        sellerUniqueId = sellerUser?.unique_id || '';
        sellerPhone = sellerUser?.phone || '';
        sellerRealName = sellerUser?.real_name || '';
        sellerProfit = transferAmount * profitRate / 100;
      } else {
        finalTransferType = 'provider_match';
        finalSellerId = providerId;
        sellerName = providerUser?.username || '服务商';
        sellerUniqueId = providerUser?.unique_id || '';
        sellerPhone = providerUser?.phone || '';
        sellerRealName = providerUser?.real_name || '';
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
        sellerRealName: sellerRealName,
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
