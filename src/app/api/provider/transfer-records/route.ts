import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const queryProviderId = searchParams.get('providerId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // 优先使用查询参数的providerId，否则从认证token获取
    let providerId = queryProviderId;
    if (!providerId) {
      const user = authenticateRequest(request);
      if (user && (user.role === 'provider' || user.role === 'admin')) {
        providerId = user.userId;
      }
    }

    if (!providerId) {
      return NextResponse.json({ success: false, error: '缺少服务商ID' }, { status: 400 });
    }

    const client = createClient(supabaseUrl, supabaseKey);

    // ===== 数据源1: user_products 表（服务商产品下的所有持有/流转记录）=====
    const { data: providerProducts, error: prodError } = await client
      .from('products')
      .select('id, code, name, price, period, profit_rate, market_rate, provider_id')
      .eq('provider_id', providerId);

    if (prodError) {
      console.error('[transfer-records] 查询产品失败:', prodError);
      return NextResponse.json({ success: false, error: '获取产品失败' }, { status: 500 });
    }

    const productMap = new Map((providerProducts || []).map(p => [p.id, p]));
    const productIds = (providerProducts || []).map(p => p.id);

    // ===== 数据源2: orders 表（该服务商下所有已完成/待审核的订单）=====
    // 通过产品ID关联查询订单
    let orderQuery = client
      .from('orders')
      .select('id, user_id, user_product_id, order_type, amount, status, created_at, updated_at')
      .in('order_type', ['buy', 'sell'])
      .order('created_at', { ascending: false });

    // 先不限制产品ID，后面在代码中过滤（因为orders表可能没有product_id字段）
    const { data: allOrders, error: orderError } = await orderQuery.limit(500);

    if (orderError) {
      console.error('[transfer-records] 查询订单失败:', orderError);
    }

    // ===== 数据源3: user_products 表 =====
    let upQuery = client
      .from('user_products')
      .select('id, user_id, product_id, purchase_price, purchase_date, expire_date, expected_profit, market_fee, status, created_at, updated_at, seller_id, transfer_type')
      .order('created_at', { ascending: false });

    if (productIds.length > 0) {
      upQuery = upQuery.in('product_id', productIds);
    }

    const { data: allUserProducts, error: upError } = await upQuery.limit(500);

    if (upError) {
      console.error('[transfer-records] 查询用户产品失败:', upError);
    }

    // ===== 时间范围计算 =====
    let timeStart: Date;
    let timeEnd: Date;

    if (startDate && endDate) {
      timeStart = new Date(startDate);
      timeEnd = new Date(endDate + 'T23:59:59');
    } else {
      // 默认2天
      timeStart = new Date();
      timeStart.setDate(timeStart.getDate() - 2);
      timeEnd = new Date();
    }

    // ===== 收集所有相关用户ID =====
    const userIds = new Set<string>();
    userIds.add(providerId);

    (allUserProducts || []).forEach(up => {
      if (up.user_id) userIds.add(up.user_id);
      if (up.seller_id) userIds.add(up.seller_id);
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

    // ===== 构建user_product的product映射 =====
    // 对于没有直接关联provider产品的user_product，通过user_id的provider_id间接关联
    const userProductMap = new Map((allUserProducts || []).map(up => [up.id, up]));

    // ===== 组装流转记录 =====
    const records: any[] = [];
    const seenIds = new Set<string>();

    // 途径1: 从user_products提取（服务商直接产品）
    (allUserProducts || []).forEach(up => {
      const product = productMap.get(up.product_id);
      if (!product) return; // 不是该服务商的产品，跳过

      const recordTime = new Date(up.created_at);
      if (recordTime < timeStart || recordTime > timeEnd) return;

      const recordId = `up-${up.id}`;
      if (seenIds.has(recordId)) return;
      seenIds.add(recordId);

      const buyer = userMap.get(up.user_id);
      const hasSeller = up.seller_id && up.seller_id !== up.user_id;
      const seller = hasSeller ? userMap.get(up.seller_id!) : null;
      const profitRate = product.profit_rate || 0;
      const transferAmount = up.purchase_price || 0;

      // 判断流转类型
      let transferType: string;
      let sellerName: string;
      let sellerUniqueId: string;
      let sellerPhone: string;
      let sellerId: string;
      let sellerProfit: number;

      if (hasSeller) {
        // 会员间流转（A转给B）
        transferType = up.transfer_type || 'member_transfer';
        sellerId = up.seller_id!;
        sellerName = seller?.username || '';
        sellerUniqueId = seller?.unique_id || '';
        sellerPhone = seller?.phone || '';
        sellerProfit = transferAmount * profitRate / 100;
      } else {
        // 服务商匹配/首次购买
        transferType = 'provider_match';
        sellerId = providerId;
        const providerUser = userMap.get(providerId);
        sellerName = providerUser?.username || '服务商';
        sellerUniqueId = providerUser?.unique_id || '';
        sellerPhone = providerUser?.phone || '';
        sellerProfit = 0;
      }

      records.push({
        id: recordId,
        productCode: product.code || '',
        productName: product.name || 'Token存储包',
        productPrice: product.price || 0,
        period: product.period || 0,
        profitRate: profitRate,
        transferAmount: transferAmount,
        sellerProfit: sellerProfit,
        transferType: transferType,
        transferTime: up.created_at,
        sellerId: sellerId,
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

    // 途径2: 从orders提取（补充，确保不遗漏）
    // 查找关联user_product属于该服务商产品的订单
    (allOrders || []).forEach(order => {
      if (!order.user_product_id) return;
      const up = userProductMap.get(order.user_product_id);
      if (!up) return;
      const product = productMap.get(up.product_id);
      if (!product) return;

      const recordTime = new Date(order.created_at);
      if (recordTime < timeStart || recordTime > timeEnd) return;

      const recordId = `order-${order.id}`;
      if (seenIds.has(recordId)) return;
      seenIds.add(recordId);

      const buyer = userMap.get(order.user_id);
      const hasSeller = up.seller_id && up.seller_id !== up.user_id;
      const seller = hasSeller ? userMap.get(up.seller_id!) : null;
      const profitRate = product.profit_rate || 0;
      const transferAmount = up.purchase_price || order.amount || 0;

      let transferType: string;
      let sellerName: string;
      let sellerUniqueId: string;
      let sellerPhone: string;
      let sellerId: string;
      let sellerProfit: number;

      if (hasSeller) {
        transferType = order.order_type === 'sell' ? 'member_transfer' : (up.transfer_type || 'member_transfer');
        sellerId = up.seller_id!;
        sellerName = seller?.username || '';
        sellerUniqueId = seller?.unique_id || '';
        sellerPhone = seller?.phone || '';
        sellerProfit = transferAmount * profitRate / 100;
      } else {
        transferType = 'provider_match';
        sellerId = providerId;
        const providerUser = userMap.get(providerId);
        sellerName = providerUser?.username || '服务商';
        sellerUniqueId = providerUser?.unique_id || '';
        sellerPhone = providerUser?.phone || '';
        sellerProfit = 0;
      }

      records.push({
        id: recordId,
        productCode: product.code || '',
        productName: product.name || 'Token存储包',
        productPrice: product.price || 0,
        period: product.period || 0,
        profitRate: profitRate,
        transferAmount: transferAmount,
        sellerProfit: sellerProfit,
        transferType: transferType,
        transferTime: order.created_at,
        sellerId: sellerId,
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
