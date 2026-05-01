import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 获取待回购列表（流转过期但未被购买的产品）
export async function GET(request: NextRequest) {
  try {
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

    const client = getSupabaseClient();

    const from = (page - 1) * pageSize;
    const now = new Date().toISOString();

    // 查询已过期的流转（但状态仍为pending）
    const { data, error, count } = await client
      .from('product_transfers')
      .select(`
        *,
        product:products(*),
        from_user:users!product_transfers_from_user_id_fkey(id, username, real_name)
      `, { count: 'exact' })
      .eq('status', 'pending')
      .lt('expires_at', now)
      .order('expires_at', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`查询待回购列表失败: ${error.message}`);
    }

    // 过滤出属于该服务商的产品
    const filteredTransfers = (data || []).filter((t: any) => {
      return t.product?.provider_id === providerId;
    });

    // 计算已过期时间
    const transfers = filteredTransfers.map((t: any) => ({
      ...t,
      expiredSeconds: t.expires_at 
        ? Math.floor((Date.now() - new Date(t.expires_at).getTime()) / 1000)
        : 0,
    }));

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
    console.error('获取待回购列表失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    );
  }
}
