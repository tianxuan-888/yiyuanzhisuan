import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 发布流转
export async function POST(request: NextRequest) {
  try {
    // 鉴权：需要登录
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, productId, transferPrice } = body;

    // 参数验证
    if (!userId || !productId || !transferPrice) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 验证操作者权限
    if (user.role !== 'admin' && user.userId !== userId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    if (transferPrice <= 0) {
      return NextResponse.json({ error: '流转价格必须大于0' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 查询产品信息
    const { data: product, error: productError } = await client
      .from('products')
      .select('*, user_products!inner(*)')
      .eq('id', productId)
      .maybeSingle();

    if (productError) {
      throw new Error(`查询产品失败: ${productError.message}`);
    }

    if (!product) {
      return NextResponse.json({ error: '产品不存在' }, { status: 404 });
    }

    // 验证产品是否属于当前用户
    if (product.user_products?.user_id !== userId) {
      return NextResponse.json({ error: '无权操作此产品' }, { status: 403 });
    }

    // 验证产品状态是否为持有中
    if (product.user_products?.status !== 'holding') {
      return NextResponse.json({ error: '只有持有中的产品才能发布流转' }, { status: 400 });
    }

    // 获取流转过期时间配置
    const { data: config } = await client
      .from('system_config')
      .select('value')
      .eq('key', 'transfer_expire_hours')
      .maybeSingle();

    const expireHours = parseInt(config?.value || '24');
    const expiresAt = new Date(Date.now() + expireHours * 60 * 60 * 1000);
    const transferStartTime = new Date();

    // 白名单过滤更新字段
    const safeUpdates = {
      status: 'transfer',
      transfer_start_time: transferStartTime.toISOString(),
      transfer_expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString()
    };

    // 更新产品状态
    const { error: updateError } = await client
      .from('products')
      .update(safeUpdates)
      .eq('id', productId)
      .eq('status', 'holding'); // 乐观锁

    if (updateError) {
      throw new Error(`更新产品失败: ${updateError.message}`);
    }

    // 创建流转记录
    const { data: transfer, error: transferError } = await client
      .from('product_transfers')
      .insert({
        product_id: productId,
        from_user_id: userId,
        transfer_price: transferPrice,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (transferError) {
      throw new Error(`创建流转记录失败: ${transferError.message}`);
    }

    return NextResponse.json({
      success: true,
      message: '流转发布成功',
      data: { transferId: transfer.id, expiresAt: expiresAt.toISOString() }
    });
  } catch (error) {
    console.error('发布流转失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
