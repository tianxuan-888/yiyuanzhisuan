import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const defaultDays = searchParams.get('defaultDays'); // 默认显示最近几天

    if (!providerId) {
      return NextResponse.json({ success: false, error: '缺少服务商ID' }, { status: 400 });
    }

    const client = createClient(supabaseUrl, supabaseKey);

    // 获取该服务商下所有产品的流转记录
    // 从 user_products 表获取已流转的记录（seller信息 + buyer信息）
    const { data: products, error: prodError } = await client
      .from('products')
      .select('id, code, name, price, period, profit_rate, market_rate')
      .eq('provider_id', providerId);

    if (prodError) {
      return NextResponse.json({ success: false, error: '获取产品失败' }, { status: 500 });
    }

    if (!products || products.length === 0) {
      return NextResponse.json({ success: false, error: '没有产品' }, { status: 404 });
    }

    const productIds = products.map(p => p.id);
    const productMap = new Map(products.map(p => [p.id, p]));

    // 获取所有已流转的用户产品记录（sold状态 = 已流转给他人）
    let query = client
      .from('user_products')
      .select('id, user_id, product_id, purchase_price, purchase_date, expire_date, status, created_at, updated_at, seller_id, transfer_type')
      .in('product_id', productIds)
      .in('status', ['sold', 'transferred', 'holding']);

    // 时间筛选
    if (startDate && endDate) {
      query = query.gte('updated_at', startDate).lte('updated_at', endDate + 'T23:59:59');
    } else if (defaultDays) {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(defaultDays));
      query = query.gte('updated_at', daysAgo.toISOString());
    } else {
      // 默认2天
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      query = query.gte('updated_at', twoDaysAgo.toISOString());
    }

    const { data: userProducts, error: upError } = await query.order('updated_at', { ascending: false });

    if (upError) {
      return NextResponse.json({ success: false, error: '获取流转记录失败' }, { status: 500 });
    }

    if (!userProducts || userProducts.length === 0) {
      return NextResponse.json({ success: true, data: [], total: 0 });
    }

    // 获取所有相关用户ID
    const userIds = new Set<string>();
    userProducts.forEach(up => {
      if (up.user_id) userIds.add(up.user_id);
      if (up.seller_id) userIds.add(up.seller_id);
    });

    // 批量获取用户信息
    const { data: users } = await client
      .from('users')
      .select('id, username, phone, unique_id, real_name')
      .in('id', Array.from(userIds));

    const userMap = new Map((users || []).map(u => [u.id, u]));

    // 组装流转记录
    const records = userProducts
      .filter(up => up.seller_id && up.seller_id !== up.user_id) // 只取有流转的记录（A转给B）
      .map(up => {
        const product = productMap.get(up.product_id);
        const buyer = userMap.get(up.user_id);
        const seller = userMap.get(up.seller_id);
        const profitRate = product?.profit_rate || 0;
        const transferAmount = up.purchase_price || 0;
        const sellerProfit = transferAmount * profitRate / 100;

        return {
          id: up.id,
          productCode: product?.code || '',
          productName: product?.name || 'Token存储包',
          productPrice: product?.price || 0,
          period: product?.period || 0,
          profitRate: profitRate,
          transferAmount: transferAmount,
          sellerProfit: sellerProfit,
          transferType: up.transfer_type || 'member_transfer',
          transferTime: up.updated_at,
          // A（卖方）信息
          sellerId: up.seller_id,
          sellerName: seller?.username || '',
          sellerUniqueId: seller?.unique_id || '',
          sellerPhone: seller?.phone || '',
          sellerRealName: seller?.real_name || '',
          // B（买方）信息
          buyerId: up.user_id,
          buyerName: buyer?.username || '',
          buyerUniqueId: buyer?.unique_id || '',
          buyerPhone: buyer?.phone || '',
          buyerRealName: buyer?.real_name || '',
        };
      });

    // 也获取从服务商直接购买首次的记录
    const { data: firstPurchaseRecords } = await client
      .from('user_products')
      .select('id, user_id, product_id, purchase_price, purchase_date, status, created_at')
      .in('product_id', productIds)
      .eq('status', 'holding')
      .is('seller_id', null);

    if (firstPurchaseRecords && firstPurchaseRecords.length > 0) {
      const fpUserIds = firstPurchaseRecords.map(r => r.user_id);
      const { data: fpUsers } = await client
        .from('users')
        .select('id, username, phone, unique_id, real_name')
        .in('id', fpUserIds);

      const fpUserMap = new Map((fpUsers || []).map(u => [u.id, u]));

      firstPurchaseRecords.forEach(up => {
        const product = productMap.get(up.product_id);
        const buyer = fpUserMap.get(up.user_id);

        // 时间筛选
        const createdAt = new Date(up.created_at);
        let withinRange = true;
        if (startDate && endDate) {
          withinRange = createdAt >= new Date(startDate) && createdAt <= new Date(endDate + 'T23:59:59');
        } else {
          const twoDaysAgo = new Date();
          twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
          withinRange = createdAt >= twoDaysAgo;
        }

        if (withinRange) {
          records.push({
            id: `fp-${up.id}`,
            productCode: product?.code || '',
            productName: product?.name || 'Token存储包',
            productPrice: product?.price || 0,
            period: product?.period || 0,
            profitRate: product?.profit_rate || 0,
            transferAmount: up.purchase_price || 0,
            sellerProfit: 0,
            transferType: 'first_purchase',
            transferTime: up.created_at,
            sellerId: providerId,
            sellerName: '服务商',
            sellerUniqueId: '',
            sellerPhone: '',
            sellerRealName: '',
            buyerId: up.user_id,
            buyerName: buyer?.username || '',
            buyerUniqueId: buyer?.unique_id || '',
            buyerPhone: buyer?.phone || '',
            buyerRealName: buyer?.real_name || '',
          });
        }
      });
    }

    // 按时间倒序排列
    records.sort((a, b) => new Date(b.transferTime).getTime() - new Date(a.transferTime).getTime());

    return NextResponse.json({
      success: true,
      data: records,
      total: records.length,
    });
  } catch (error) {
    console.error('获取流转记录失败:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
