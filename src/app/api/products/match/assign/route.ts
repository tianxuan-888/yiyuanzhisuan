import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, getSupabase } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';

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
    const { productId, targetUserId, action } = body;

    // 取消匹配操作
    if (action === 'cancel') {
      if (!productId) {
        return NextResponse.json({ success: false, message: '缺少产品ID' }, { status: 400 });
      }
      await execute(
        `UPDATE products SET pending_match_user_id = NULL, status = 'available' WHERE id = $1`,
        [productId]
      );
      return NextResponse.json({ success: true, message: '已取消匹配' });
    }

    // 指定匹配
    if (!productId || !targetUserId) {
      return NextResponse.json({ success: false, message: '缺少产品ID或目标会员ID' }, { status: 400 });
    }

    // 检查产品是否存在且属于该服务商
    const product = await queryOne(
      `SELECT id, name, price, status, provider_id, previous_holder_id FROM products WHERE id = $1`,
      [productId]
    );

    if (!product) {
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
      await execute(
        `UPDATE products SET status = 'pending_match', updated_at = NOW() WHERE id = $1`,
        [productId]
      );
    }

    // 检查目标会员是否属于该服务商
    const targetUser = await queryOne(
      `SELECT id, username, provider_id FROM users WHERE id = $1`,
      [targetUserId]
    );

    if (!targetUser) {
      return NextResponse.json({ success: false, message: '目标会员不存在' }, { status: 404 });
    }

    if (targetUser.provider_id !== user.userId) {
      return NextResponse.json({ success: false, message: '该会员不属于您' }, { status: 400 });
    }

    // 匹配产品给会员
    await execute(
      `UPDATE products SET pending_match_user_id = $1 WHERE id = $2`,
      [targetUserId, productId]
    );

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
