import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const { productId, providerId } = await request.json();

    if (!productId || !providerId) {
      return NextResponse.json({ error: '参数缺失' }, { status: 400 });
    }

    // 1. 获取产品记录
    const product = await queryOne(
      `SELECT id, status, provider_id, pending_match_user_id FROM products WHERE id = $1`,
      [productId]
    );

    if (!product) {
      return NextResponse.json({ error: '未找到产品' }, { status: 404 });
    }

    if (product.provider_id !== providerId) {
      return NextResponse.json({ error: '无权操作此产品' }, { status: 403 });
    }

    if (product.status !== 'pending_match') {
      return NextResponse.json({ error: '该产品不在待匹配状态，无法回收' }, { status: 400 });
    }

    // 2. 如果有待匹配的会员，将对应的 user_products 记录也更新为 recycled
    if (product.pending_match_user_id) {
      await query(
        `UPDATE user_products SET status = 'recycled', updated_at = NOW() 
         WHERE product_id = $1 AND user_id = $2 AND status = 'pending_match'`,
        [productId, product.pending_match_user_id]
      ).catch(() => {
        // 如果没有对应的 user_products 记录则忽略
      });
    }

    // 3. 将产品状态改回 available，清除匹配信息
    await query(
      `UPDATE products SET status = 'available', pending_match_user_id = NULL, pending_match_status = NULL, previous_holder_id = NULL, updated_at = NOW() WHERE id = $1`,
      [productId]
    );

    return NextResponse.json({
      success: true,
      message: '产品已回收，回到在售列表'
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '回收失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
