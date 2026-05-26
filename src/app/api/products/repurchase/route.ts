import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, getSupabase } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';

// 服务商回购产品 - 产品回到服务商在售列表，会员端显示已完成
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

    // 查询产品
    const product = await queryOne(
      `SELECT id, name, code, price, period, status, provider_id, previous_holder_id, pending_match_user_id FROM products WHERE id = $1`,
      [productId]
    );

    if (!product) {
      return NextResponse.json({ success: false, message: '产品不存在' }, { status: 404 });
    }

    if (product.provider_id !== user.userId) {
      return NextResponse.json({ success: false, message: '无权操作此产品' }, { status: 403 });
    }

    // 只有pending_match状态的产品才能回购
    if (product.status !== 'pending_match') {
      return NextResponse.json({ success: false, message: `产品状态不允许回购(当前: ${product.status})` }, { status: 400 });
    }

    // 1. 更新产品：回到available状态，清除匹配信息和上一个持有者
    await execute(
      `UPDATE products SET status = 'available', pending_match_user_id = NULL, previous_holder_id = NULL, updated_at = NOW() WHERE id = $1`,
      [productId]
    );

    // 2. 更新会员的持仓记录：pending_sell → repurchased（已完成）
    if (product.previous_holder_id) {
      await execute(
        `UPDATE user_products SET status = 'repurchased', updated_at = NOW() WHERE user_id = $1 AND product_id = $2 AND status = 'pending_sell'`,
        [product.previous_holder_id, productId]
      );

      // 3. 通知会员：产品已被服务商回购
      try {
        const supabase = getSupabase();
        await supabase.from('notifications').insert({
          receiver_id: product.previous_holder_id,
          receiver_role: 'member',
          type: 'repurchase',
          title: '产品回购完成',
          content: `您的产品「${product.name}」已被服务商回购，Token值¥${product.price}请线下与服务商结算。产品已回到服务商在售列表。`,
          is_read: false
        });
      } catch (e) {
        console.error('[REPURCHASE] 通知发送失败:', e);
      }
    }

    // 4. 如果有已指定匹配的会员，也需要通知
    if (product.pending_match_user_id) {
      try {
        const supabase = getSupabase();
        await supabase.from('notifications').insert({
          receiver_id: product.pending_match_user_id,
          receiver_role: 'member',
          type: 'match_cancelled',
          title: '匹配已取消',
          content: `您申请的产品「${product.name}」已被服务商回购，匹配已取消。`,
          is_read: false
        });
      } catch (e) {
        console.error('[REPURCHASE] 通知发送失败:', e);
      }
    }

    console.log('[REPURCHASE] 回购成功:', {
      productId: product.id,
      providerId: user.userId,
      previousHolderId: product.previous_holder_id
    });

    // 5. 写入产品流转记录
    try {
      const supabase = getSupabase();
      const sellerInfo = product.previous_holder_id
        ? await queryOne('SELECT id, username, unique_id, phone FROM users WHERE id = $1', [product.previous_holder_id])
        : null;
      const providerInfo = await queryOne('SELECT id, username FROM users WHERE id = $1', [product.provider_id]);

      await supabase.from('product_flow_records').insert({
        product_id: product.id,
        product_code: product.code,
        product_name: product.name,
        product_price: product.price,
        period: product.period,
        flow_type: 'repurchase',
        seller_id: product.previous_holder_id || product.provider_id,
        seller_name: sellerInfo?.username || providerInfo?.username || '',
        seller_unique_id: sellerInfo?.unique_id || '',
        seller_phone: sellerInfo?.phone || '',
        buyer_id: product.provider_id,
        buyer_name: providerInfo?.username || '',
        transfer_amount: product.price,
        seller_profit: 0,
        provider_id: product.provider_id,
        provider_name: providerInfo?.username || '',
      });
    } catch (flowErr) {
      console.error('[REPURCHASE] 写入流转记录失败:', flowErr);
    }

    return NextResponse.json({
      success: true,
      message: '回购成功，产品已回到在售列表，会员端显示已完成'
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '服务器错误';
    console.error('[REPURCHASE] 异常:', error);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}
