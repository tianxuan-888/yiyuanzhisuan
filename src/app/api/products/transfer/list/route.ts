import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 获取流转列表（支持流转市场 + 我的流转 + 回购查询）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const sellerId = searchParams.get('sellerId');
    const buyerId = searchParams.get('buyerId');
    const statusFilter = searchParams.get('status');
    const marketMode = searchParams.get('market'); // 'true' 表示获取流转市场

    const client = getSupabaseClient();

    const from = (page - 1) * pageSize;
    const now = new Date().toISOString();

    let query = client
      .from('product_transfers')
      .select(`
        *,
        product:products(*),
        from_user:users!product_transfers_from_user_id_fkey(id, username, real_name, phone, unique_id),
        to_user:users!product_transfers_to_user_id_fkey(id, username, real_name, phone, unique_id)
      `, { count: 'exact' });

    // 流转市场模式：只显示 pending 且未过期的
    if (marketMode === 'true') {
      query = query.eq('status', 'pending').gt('expires_at', now);
    } else {
      // 按状态过滤
      if (statusFilter) {
        if (statusFilter.includes(',')) {
          query = query.in('status', statusFilter.split(','));
        } else {
          query = query.eq('status', statusFilter);
        }
      }

      // 按卖家过滤
      if (sellerId) {
        query = query.eq('from_user_id', sellerId);
      }

      // 按买家过滤
      if (buyerId) {
        query = query.eq('to_user_id', buyerId);
      }
    }

    query = query.order('created_at', { ascending: false }).range(from, from + pageSize - 1);

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`查询流转列表失败: ${error.message}`);
    }

    // 计算每个产品的剩余时间
    const transfers = (data || []).map((t: any) => ({
      ...t,
      remainingSeconds: t.expires_at 
        ? Math.max(0, Math.floor((new Date(t.expires_at).getTime() - Date.now()) / 1000))
        : 0,
      product_name: t.product?.name || '',
      product_code: t.product?.code || '',
      period: t.product?.period || 0,
      price: t.transfer_price,
      market_rate: t.product?.market_rate || 0,
      profit_rate: t.product?.profit_rate || 0,
      buyer_name: t.to_user?.username || '',
      buyer_unique_id: t.to_user?.unique_id || '',
      seller_name: t.from_user?.username || '',
      seller_unique_id: t.from_user?.unique_id || '',
    }));

    // 如果是卖家查询且按状态过滤，直接返回数组（兼容前端现有逻辑）
    if (sellerId || buyerId) {
      return NextResponse.json({
        success: true,
        data: transfers,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        list: transfers,
        total: count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    });
  } catch (error) {
    console.error('获取流转列表失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    );
  }
}
