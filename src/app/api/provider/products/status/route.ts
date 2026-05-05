import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 允许的状态值
const ALLOWED_STATUS = new Set(['available', 'unlisted', 'sold']);

// 更新产品状态
export async function PUT(request: NextRequest) {
  try {
    // 鉴权：仅管理员和服务商可操作
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { productIds, status } = body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json({ error: '缺少产品ID列表' }, { status: 400 });
    }

    // 白名单验证状态值
    if (!status || !ALLOWED_STATUS.has(status)) {
      return NextResponse.json({ error: '无效的状态值' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 验证产品归属
    const userAny = user as { role: string; userId?: string };
    if (userAny.role === 'provider') {
      const { data: products } = await client
        .from('products')
        .select('id, provider_id')
        .in('id', productIds);

      const productList = (products || []) as { id: string; provider_id?: string }[];
      const unauthorized = productList.filter(p => p.provider_id !== userAny.userId);
      if (unauthorized && unauthorized.length > 0) {
        return NextResponse.json({ error: '无权操作部分产品' }, { status: 403 });
      }
    }

    // 白名单过滤更新字段
    const safeUpdates = {
      status,
      updated_at: new Date().toISOString()
    };

    // 更新产品状态
    const { data, error } = await client
      .from('products')
      .update(safeUpdates)
      .in('id', productIds)
      .select();

    if (error) {
      throw new Error(`更新产品状态失败: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      message: `已更新 ${data.length} 个产品的状态`,
      data: { updatedCount: data.length, status }
    });
  } catch (error) {
    console.error('更新产品状态失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
