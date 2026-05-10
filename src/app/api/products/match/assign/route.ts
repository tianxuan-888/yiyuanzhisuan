import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    // 验证token
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, message: '未授权' }, { status: 401 });
    }
    
    const token = authHeader.split(' ')[1];
    let user: { userId: string; role: string };
    try {
      user = JSON.parse(Buffer.from(token, 'base64').toString());
    } catch {
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

    console.log('[MATCH ASSIGN] 请求参数:', { productId, targetUserId, userId: user.userId });

    // 检查产品是否存在且属于该服务商
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, price, status, provider_id, market_rate, previous_holder_id')
      .eq('id', productId)
      .single();

    console.log('[MATCH ASSIGN] 产品查询结果:', { product: product ? { id: product.id, status: product.status, provider_id: product.provider_id } : null, productError });

    if (productError || !product) {
      return NextResponse.json({ success: false, message: '产品不存在' }, { status: 404 });
    }

    if (product.provider_id !== user.userId) {
      console.log('[MATCH ASSIGN] provider_id不匹配:', { productProviderId: product.provider_id, userId: user.userId });
      return NextResponse.json({ success: false, message: '无权操作此产品' }, { status: 403 });
    }

    if (product.status !== 'pending_match') {
      console.log('[MATCH ASSIGN] 产品状态不正确:', { status: product.status });
      return NextResponse.json({ success: false, message: `产品状态不允许匹配(当前: ${product.status})` }, { status: 400 });
    }

    // 检查目标会员是否属于该服务商
    const { data: targetUser, error: userError } = await supabase
      .from('users')
      .select('id, username, energy_value, provider_id')
      .eq('id', targetUserId)
      .single();

    console.log('[MATCH ASSIGN] 目标会员查询:', { targetUser: targetUser ? { id: targetUser.id, provider_id: targetUser.provider_id, username: targetUser.username, energy: targetUser.energy_value } : null, userError });

    if (userError || !targetUser) {
      return NextResponse.json({ success: false, message: '目标会员不存在' }, { status: 404 });
    }

    if (targetUser.provider_id !== user.userId) {
      console.log('[MATCH ASSIGN] 会员provider_id不匹配:', { memberProviderId: targetUser.provider_id, userId: user.userId });
      return NextResponse.json({ success: false, message: '该会员不属于您' }, { status: 400 });
    }

    // 预检查能量值是否足够
    const marketFee = product.price * (product.market_rate / 100);
    const energySufficient = targetUser.energy_value >= marketFee;

    // 使用RPC SQL执行，避免REST API静默失败
    const { error: updateError } = await supabase.rpc('rpc_execute', {
      sql_query: `UPDATE products SET pending_match_user_id = '${targetUserId}' WHERE id = '${productId}'`
    });

    if (updateError) {
      console.error('[MATCH ASSIGN] 更新失败:', updateError);
      return NextResponse.json({ success: false, message: '匹配失败: ' + updateError.message }, { status: 500 });
    }

    console.log('[MATCH ASSIGN] 匹配成功:', { productId, targetUserId, targetUsername: targetUser.username });

    return NextResponse.json({
      success: true,
      message: energySufficient
        ? `已指定匹配给 ${targetUser.username}，能量值充足，可确认匹配`
        : `已指定匹配给 ${targetUser.username}，但该会员能量值不足(${targetUser.energy_value}/${marketFee})，确认时将失败`,
      data: {
        productId,
        targetUserId,
        targetUsername: targetUser.username,
        energyValue: targetUser.energy_value,
        requiredEnergy: marketFee,
        energySufficient
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    console.error('[MATCH ASSIGN] 异常:', error);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
