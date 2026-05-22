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
    const defaultDays = searchParams.get('defaultDays');

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

    // 获取该服务商下所有产品
    const { data: products, error: prodError } = await client
      .from('products')
      .select('id, code, name, price, period, profit_rate, market_rate')
      .eq('provider_id', providerId);

    if (prodError) {
      return NextResponse.json({ success: false, error: '获取产品失败' }, { status: 500 });
    }

    if (!products || products.length === 0) {
      return NextResponse.json({ success: true, data: [], total: 0 });
    }

    const productIds = products.map(p => p.id);
    const productMap = new Map(products.map(p => [p.id, p]));

    // 获取所有已流转的用户产品记录
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

    // 同时获取服务商信息用于"首次购买"记录的卖方显示
    const { data: providerUser } = await client
      .from('users')
      .select('id, username, phone, unique_id, real_name')
      .eq('id', providerId)
      .single();

    // 组装流转记录
    const records: any[] = [];

    // 1. 会员间流转记录（有seller_id且不等于user_id）
    userProducts
      .filter(up => up.seller_id && up.seller_id !== up.user_id)
      .forEach(up => {
        const product = productMap.get(up.product_id);
        const buyer = userMap.get(up.user_id);
        const seller = userMap.get(up.seller_id);
        const profitRate = product?.profit_rate || 0;
        const transferAmount = up.purchase_price || 0;
        const sellerProfit = transferAmount * profitRate / 100;

        records.push({
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
          sellerId: up.seller_id,
          sellerName: seller?.username || '',
          sellerUniqueId: seller?.unique_id || '',
          sellerPhone: seller?.phone || '',
          sellerRealName: seller?.real_name || '',
          buyerId: up.user_id,
          buyerName: buyer?.username || '',
          buyerUniqueId: buyer?.unique_id || '',
          buyerPhone: buyer?.phone || '',
          buyerRealName: buyer?.real_name || '',
        });
      });

    // 2. 服务商匹配/首次购买记录（seller_id为空 = 从服务商购买）
    userProducts
      .filter(up => !up.seller_id || up.seller_id === up.user_id)
      .forEach(up => {
        const product = productMap.get(up.product_id);
        const buyer = userMap.get(up.user_id);
        const profitRate = product?.profit_rate || 0;
        const transferAmount = up.purchase_price || 0;

        // 时间筛选
        const recordTime = new Date(up.created_at);
        let withinRange = true;
        if (startDate && endDate) {
          withinRange = recordTime >= new Date(startDate) && recordTime <= new Date(endDate + 'T23:59:59');
        } else if (defaultDays) {
          const daysAgo = new Date();
          daysAgo.setDate(daysAgo.getDate() - parseInt(defaultDays));
          withinRange = recordTime >= daysAgo;
        } else {
          const twoDaysAgo = new Date();
          twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
          withinRange = recordTime >= twoDaysAgo;
        }

        if (withinRange) {
          records.push({
            id: `match-${up.id}`,
            productCode: product?.code || '',
            productName: product?.name || 'Token存储包',
            productPrice: product?.price || 0,
            period: product?.period || 0,
            profitRate: profitRate,
            transferAmount: transferAmount,
            sellerProfit: 0,
            transferType: 'provider_match',
            transferTime: up.created_at,
            sellerId: providerId,
            sellerName: providerUser?.username || '服务商',
            sellerUniqueId: providerUser?.unique_id || '',
            sellerPhone: providerUser?.phone || '',
            sellerRealName: providerUser?.real_name || '',
            buyerId: up.user_id,
            buyerName: buyer?.username || '',
            buyerUniqueId: buyer?.unique_id || '',
            buyerPhone: buyer?.phone || '',
            buyerRealName: buyer?.real_name || '',
          });
        }
      });

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
