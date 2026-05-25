import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, getSupabase } from '@/lib/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const { userProductId, providerId } = await request.json();

    if (!userProductId || !providerId) {
      return NextResponse.json({ error: '参数缺失' }, { status: 400 });
    }

    // 1. 获取 user_product 记录
    const up = await queryOne(
      `SELECT id, user_id, product_id, status, purchase_price FROM user_products WHERE id = $1`,
      [userProductId]
    );

    if (!up) {
      return NextResponse.json({ error: '未找到持仓记录' }, { status: 404 });
    }

    if (up.status !== 'pending_match') {
      return NextResponse.json({ error: '该产品不在待匹配状态' }, { status: 400 });
    }

    // 2. 将 user_products 状态改为 recycled
    await query(
      `UPDATE user_products SET status = 'recycled', updated_at = NOW() WHERE id = $1`,
      [userProductId]
    );

    // 3. 将产品状态改回 available，清除匹配信息
    await query(
      `UPDATE products SET status = 'available', updated_at = NOW() WHERE id = $1`,
      [up.product_id]
    );

    // 4. 尝试清除 pending_match 相关字段（如果列存在）
    await query(
      `UPDATE products SET pending_match_user_id = NULL, pending_match_status = NULL WHERE id = $1`,
      [up.product_id]
    ).catch(() => {
      // 如果字段不存在则忽略
    });

    return NextResponse.json({
      success: true,
      message: '产品已回收，回到在售列表'
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '回收失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
