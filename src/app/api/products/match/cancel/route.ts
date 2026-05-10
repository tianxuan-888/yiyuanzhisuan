import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ success: false, message: '无效token' }, { status: 401 });
    }

    if (user.role !== 'provider' && user.role !== 'admin') {
      return NextResponse.json({ success: false, message: '仅服务商可操作' }, { status: 403 });
    }

    const body = await request.json();
    const { productId } = body;

    if (!productId) {
      return NextResponse.json({ success: false, message: '缺少产品ID' }, { status: 400 });
    }

    // 检查产品是否存在且属于该服务商
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, status, provider_id, pending_match_user_id')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      return NextResponse.json({ success: false, message: '产品不存在' }, { status: 404 });
    }

    if (product.provider_id !== user.userId) {
      return NextResponse.json({ success: false, message: '无权操作此产品' }, { status: 403 });
    }

    if (!product.pending_match_user_id) {
      return NextResponse.json({ success: false, message: '该产品未被指定匹配，无需取消' }, { status: 400 });
    }

    // 清空 pending_match_user_id
    const sql = `UPDATE products SET pending_match_user_id = NULL, updated_at = NOW() WHERE id = '${productId}'`;
    const { error: updateError } = await supabase.rpc('rpc_execute', { sql_query: sql });

    if (updateError) {
      console.error('[MATCH CANCEL] 更新失败:', updateError);
      return NextResponse.json({ success: false, message: '取消匹配失败: ' + updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: '已取消匹配，产品回到待匹配列表'
    });
  } catch (error: any) {
    console.error('[MATCH CANCEL] 异常:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
