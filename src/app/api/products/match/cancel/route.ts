import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/supabase-client';
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
    const { productId } = body;

    if (!productId) {
      return NextResponse.json({ success: false, message: '缺少产品ID' }, { status: 400 });
    }

    // 检查产品是否存在且属于该服务商
    const product = await queryOne(
      `SELECT id, name, status, provider_id, pending_match_user_id FROM products WHERE id = $1`,
      [productId]
    );

    if (!product) {
      return NextResponse.json({ success: false, message: '产品不存在' }, { status: 404 });
    }

    if (product.provider_id !== user.userId) {
      return NextResponse.json({ success: false, message: '无权操作此产品' }, { status: 403 });
    }

    if (!product.pending_match_user_id) {
      return NextResponse.json({ success: false, message: '该产品未被指定匹配，无需取消' }, { status: 400 });
    }

    // 清空 pending_match_user_id，恢复为 available 状态
    await execute(
      `UPDATE products SET pending_match_user_id = NULL, status = 'available', updated_at = NOW() WHERE id = $1`,
      [productId]
    );

    return NextResponse.json({
      success: true,
      message: '已取消匹配，产品回到待匹配列表'
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '服务器错误';
    console.error('[MATCH CANCEL] 异常:', error);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}
