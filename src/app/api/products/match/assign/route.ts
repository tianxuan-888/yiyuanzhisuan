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
    const { productId, targetUserId } = body;

    if (!productId || !targetUserId) {
      return NextResponse.json({ success: false, message: '缺少产品ID或目标会员ID' }, { status: 400 });
    }

    // 检查产品是否存在且属于该服务商
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, price, status, provider_id, previous_holder_id')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      return NextResponse.json({ success: false, message: '产品不存在' }, { status: 404 });
    }

    if (product.provider_id !== user.userId) {
      return NextResponse.json({ success: false, message: '无权操作此产品' }, { status: 403 });
    }

    if (product.status !== 'pending_match' && product.status !== 'available' && product.status !== 'draft' && product.status !== 'unlisted') {
      return NextResponse.json({ success: false, message: `产品状态不允许匹配(当前: ${product.status})` }, { status: 400 });
    }

    // 如果产品不是pending_match状态，先将其改为pending_match
    if (product.status !== 'pending_match') {
      const { error: statusError } = await supabase.rpc('rpc_execute', {
        sql_query: `UPDATE products SET status = 'pending_match', updated_at = NOW() WHERE id = '${productId}'`
      });
      if (statusError) {
        return NextResponse.json({ success: false, message: '状态更新失败: ' + statusError.message }, { status: 500 });
      }
    }

    // 检查目标会员是否属于该服务商
    const { data: targetUser, error: userError } = await supabase
      .from('users')
      .select('id, username, provider_id')
      .eq('id', targetUserId)
      .single();

    if (userError || !targetUser) {
      return NextResponse.json({ success: false, message: '目标会员不存在' }, { status: 404 });
    }

    if (targetUser.provider_id !== user.userId) {
      return NextResponse.json({ success: false, message: '该会员不属于您' }, { status: 400 });
    }

    // 匹配产品给会员（不需要检查能量值，只需确认线下收款）
    const { error: updateError } = await supabase.rpc('rpc_execute', {
      sql_query: `UPDATE products SET pending_match_user_id = '${targetUserId}' WHERE id = '${productId}'`
    });

    if (updateError) {
      return NextResponse.json({ success: false, message: '匹配失败: ' + updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `已指定匹配给 ${targetUser.username}，请确认线下收款`,
      data: {
        productId,
        targetUserId,
        targetUsername: targetUser.username,
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    console.error('[MATCH ASSIGN] 异常:', error);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
