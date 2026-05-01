import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 获取服务商待审核流转列表
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

    // 查询该服务商下产品的流转记录
    const { data, error, count } = await client
      .from('product_transfers')
      .select(`
        *,
        product:products(*, user_products!inner(*)),
        from_user:users!product_transfers_from_user_id_fkey(id, username, real_name, phone, wechat_account, alipay_account),
        to_user:users!product_transfers_to_user_id_fkey(id, username, real_name, phone)
      `, { count: 'exact' })
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`查询待审核流转失败: ${error.message}`);
    }

    // 过滤出属于该服务商的产品流转
    const filteredTransfers = (data || []).filter((t: any) => {
      const product = t.product;
      return product?.provider_id === providerId || product?.user_products?.provider_id === providerId;
    });

    return NextResponse.json({
      success: true,
      data: {
        list: filteredTransfers,
        total: count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    });
  } catch (error) {
    console.error('获取待审核流转失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    );
  }
}
