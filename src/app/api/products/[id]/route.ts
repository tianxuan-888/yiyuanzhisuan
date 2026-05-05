import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { query } from '@/lib/pg-client';

// 允许更新的字段白名单
const ALLOWED_PRODUCT_FIELDS = new Set([
  'name', 'code', 'image_url', 'price', 'period',
  'total_rate', 'market_rate', 'profit_rate', 'status'
]);

// 获取单个产品
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('products')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`查询产品失败: ${error.message}`);
    }

    if (!data) {
      return NextResponse.json({ error: '产品不存在' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('获取产品失败:', error);
    return NextResponse.json({ error: '获取产品失败' }, { status: 500 });
  }
}

// 更新产品
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 鉴权：仅管理员和服务商可更新
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    // 白名单过滤
    const safeUpdates: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      if (ALLOWED_PRODUCT_FIELDS.has(key)) {
        safeUpdates[key] = body[key];
      }
    }

    if (Object.keys(safeUpdates).length === 0) {
      return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });
    }

    safeUpdates.updated_at = new Date().toISOString();

    const client = getSupabaseClient();

    // 检查产品是否存在
    const { data: existingProduct, error: checkError } = await client
      .from('products')
      .select('id, provider_id')
      .eq('id', id)
      .maybeSingle();

    if (checkError) {
      throw new Error(`检查产品失败: ${checkError.message}`);
    }

    if (!existingProduct) {
      return NextResponse.json({ error: '产品不存在' }, { status: 404 });
    }

    // 验证权限：管理员可更新所有，服务商只能更新自己的产品
    const userAny = user as { role: string; provider_id?: string };
    if (userAny.role === 'provider' && existingProduct.provider_id !== userAny.provider_id) {
      return NextResponse.json({ error: '无权操作此产品' }, { status: 403 });
    }

    // 如果修改了编号，检查新编号是否已存在
    if (safeUpdates.code) {
      const { data: duplicateProduct } = await client
        .from('products')
        .select('id')
        .eq('code', safeUpdates.code)
        .neq('id', id)
        .maybeSingle();

      if (duplicateProduct) {
        return NextResponse.json({ error: '产品编号已存在' }, { status: 400 });
      }
    }

    const { data, error } = await client
      .from('products')
      .update(safeUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`更新产品失败: ${error.message}`);
    }

    return NextResponse.json({ success: true, data, message: '产品更新成功' });
  } catch (error) {
    console.error('更新产品失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// 删除产品（未上架产品，退回额度给服务商）
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 先获取产品信息，检查状态
    const client = getSupabaseClient();
    const { data: product, error: findError } = await client
      .from('products')
      .select('id, provider_id, price, status, name')
      .eq('id', id)
      .maybeSingle();

    if (findError) {
      throw new Error(`查询产品失败: ${findError.message}`);
    }

    if (!product) {
      return NextResponse.json({ error: '产品不存在' }, { status: 404 });
    }

    // 只有未上架（unlisted/available但未被购买）的产品可以删除
    // sold 状态的产品不能删除
    if (product.status === 'sold') {
      return NextResponse.json(
        { error: '已售出的产品不能删除' },
        { status: 400 }
      );
    }

    if (product.status === 'pending_sell') {
      return NextResponse.json(
        { error: '待审核卖出的产品不能删除' },
        { status: 400 }
      );
    }

    // 鉴权：管理员可删除所有，服务商只能删除自己的未上架产品
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const userAny = user as { role: string; id?: string };
    if (userAny.role !== 'admin' && userAny.role !== 'provider') {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    if (userAny.role === 'provider' && product.provider_id !== userAny.id) {
      return NextResponse.json({ error: '无权删除此产品' }, { status: 403 });
    }

    // 删除产品
    const { error: deleteError } = await client
      .from('products')
      .delete()
      .eq('id', id);

    if (deleteError) {
      throw new Error(`删除产品失败: ${deleteError.message}`);
    }

    // 退回额度给服务商
    if (product.provider_id && product.price) {
      const now = new Date().toISOString();
      await query(
        `UPDATE providers 
         SET used_quota = GREATEST(0, COALESCE(used_quota, 0) - $1),
             updated_at = $2
         WHERE user_id = $3`,
        [product.price, now, product.provider_id]
      );
    }

    return NextResponse.json({ 
      success: true, 
      message: `产品已删除，¥${product.price.toLocaleString()} 额度已退回`,
      data: {
        refundedAmount: product.price,
        providerId: product.provider_id,
      }
    });
  } catch (error) {
    console.error('删除产品失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
