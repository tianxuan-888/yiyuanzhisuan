import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 获取流转市场列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    const client = getSupabaseClient();

    const from = (page - 1) * pageSize;
    const now = new Date().toISOString();

    // 查询流转中的产品（未过期）
    const { data, error, count } = await client
      .from('product_transfers')
      .select(`
        *,
        product:products(*),
        from_user:users!product_transfers_from_user_id_fkey(id, username, real_name, phone)
      `, { count: 'exact' })
      .eq('status', 'pending')
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`查询流转列表失败: ${error.message}`);
    }

    // 计算每个产品的剩余时间
    const transfers = (data || []).map((t: any) => ({
      ...t,
      remainingSeconds: t.expires_at 
        ? Math.max(0, Math.floor((new Date(t.expires_at).getTime() - Date.now()) / 1000))
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
    console.error('获取流转列表失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    );
  }
}
