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

    if (user.role !== 'provider') {
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
      .select('id, name, price, status, provider_id, market_rate, previous_holder_id')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      return NextResponse.json({ success: false, message: '产品不存在' }, { status: 404 });
    }

    if (product.provider_id !== user.userId) {
      return NextResponse.json({ success: false, message: '无权操作此产品' }, { status: 403 });
    }

    if (product.status !== 'pending_match') {
      return NextResponse.json({ success: false, message: '产品状态不允许匹配' }, { status: 400 });
    }

    // 检查目标会员是否属于该服务商
    const { data: targetUser, error: userError } = await supabase
      .from('users')
      .select('id, username, energy_value, provider_id')
      .eq('id', targetUserId)
      .single();

    if (userError || !targetUser) {
      return NextResponse.json({ success: false, message: '目标会员不存在' }, { status: 404 });
    }

    if (targetUser.provider_id !== user.userId) {
      return NextResponse.json({ success: false, message: '该会员不属于您' }, { status: 400 });
    }

    // 预检查能量值是否足够
    const marketFee = product.price * (product.market_rate / 100);
    const energySufficient = targetUser.energy_value >= marketFee;

    // 设置待匹配用户
    const { error: updateError } = await supabase
      .from('products')
      .update({
        pending_match_user_id: targetUserId,
      })
      .eq('id', productId);

    if (updateError) {
      return NextResponse.json({ success: false, message: '匹配失败: ' + updateError.message }, { status: 500 });
    }

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
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
