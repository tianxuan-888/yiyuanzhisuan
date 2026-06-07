import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { 'Prefer': 'return=representation', 'Cache-Control': 'no-cache' } },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userProductIds } = body;

    if (!userProductIds || !Array.isArray(userProductIds) || userProductIds.length === 0) {
      return NextResponse.json({ success: false, message: '请选择要卖出的产品' }, { status: 400 });
    }

    const sb = getSupabaseClient();

    // 获取持仓记录
    const { data: userProducts, error: upErr } = await sb
      .from('user_products')
      .select('id, user_id, product_id, purchase_price, revenue_released, status')
      .in('id', userProductIds);

    if (upErr || !userProducts || userProducts.length === 0) {
      return NextResponse.json({ success: false, message: '未找到产品' }, { status: 404 });
    }

    let successCount = 0;
    const sellLog: string[] = [];

    for (const up of userProducts) {
      // 如果还没解锁，先解锁
      if (!up.revenue_released) {
        try {
          const unlockRes = await fetch(new URL('/api/branch/unlock', request.url).toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userProductIds: [up.id] }),
          });
          const unlockData = await unlockRes.json();
          if (!unlockData.success) {
            sellLog.push(`产品${up.product_id}: 解锁失败 - ${unlockData.message}`);
            continue;
          }
        } catch (e) {
          sellLog.push(`产品${up.product_id}: 解锁异常`);
          continue;
        }
      }

      // 如果已经是pending_sell状态，跳过（已经在售卖中）
      if (up.status === 'pending_sell') {
        sellLog.push(`产品${up.product_id}: 已在售卖中，跳过`);
        successCount++;
        continue;
      }

      // 更新user_products状态为pending_sell（等待服务商匹配）
      const { error: upUpdateErr } = await sb
        .from('user_products')
        .update({ status: 'pending_sell' })
        .eq('id', up.id);

      if (upUpdateErr) {
        sellLog.push(`产品${up.product_id}: user_products状态更新失败 - ${upUpdateErr.message}`);
        continue;
      }

      // 更新products表状态为pending_match（等待服务商匹配）
      const { error: prodUpdateErr } = await sb
        .from('products')
        .update({ status: 'pending_match' })
        .eq('id', up.product_id);

      if (prodUpdateErr) {
        sellLog.push(`产品${up.product_id}: products状态更新失败 - ${prodUpdateErr.message}`);
        // 回滚user_products状态
        await sb.from('user_products').update({ status: up.status }).eq('id', up.id);
        continue;
      }

      // 记录pending_match_user_id（标记谁在卖）
      // 通过products表查找provider_id，设置pending_match_user_id
      const { data: prodData } = await sb
        .from('products')
        .select('provider_id')
        .eq('id', up.product_id)
        .single();

      if (prodData) {
        await sb
          .from('products')
          .update({ pending_match_user_id: up.user_id })
          .eq('id', up.product_id);
      }

      successCount++;
      sellLog.push(`产品${up.product_id}: 已发布待匹配(会员可等待服务商匹配)`);
    }

    console.log(`[force-sell] 完成: 成功${successCount}/${userProducts.length}`);
    sellLog.forEach(l => console.log(`  ${l}`));

    return NextResponse.json({
      success: true,
      message: `成功卖出 ${successCount} 个产品`,
      data: { total: userProducts.length, soldCount: successCount, log: sellLog },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[force-sell] Error:', msg);
    return NextResponse.json({ success: false, message: '卖出失败: ' + msg }, { status: 500 });
  }
}
