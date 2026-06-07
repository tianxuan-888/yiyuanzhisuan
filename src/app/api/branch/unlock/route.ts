import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { setRevenueReleased } from '@/lib/energy-utils';

export const dynamic = 'force-dynamic';

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { 'Prefer': 'return=representation', 'Cache-Control': 'no-cache' } },
  });
}

/**
 * 网点解锁产品
 * 新逻辑：解锁只标记产品为可出售状态（revenue_released=true），
 * 不再分配收益。收益在会员出售产品时才分配。
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userProductIds } = body;

    if (!userProductIds || !Array.isArray(userProductIds) || userProductIds.length === 0) {
      return NextResponse.json({ success: false, message: '请选择要解锁的产品' }, { status: 400 });
    }

    const sb = getSupabaseClient();

    // 1. 获取待解锁的持仓记录
    const { data: userProducts, error: upErr } = await sb
      .from('user_products')
      .select('id, user_id, product_id, purchase_price, revenue_released, status')
      .in('id', userProductIds);

    if (upErr || !userProducts || userProducts.length === 0) {
      return NextResponse.json({ success: false, message: '未找到可解锁的产品' }, { status: 404 });
    }

    // 2. 逐个处理解锁 - 只标记revenue_released=true，不分配收益
    let successCount = 0;
    const unlockLog: string[] = [];

    for (const up of userProducts) {
      if (up.revenue_released) {
        unlockLog.push(`产品${up.product_id}: 已解锁，跳过`);
        successCount++;
        continue;
      }

      // 标记为已解锁（可出售状态）
      const releaseOk = await setRevenueReleased(up.id, true);

      if (releaseOk) {
        successCount++;
        unlockLog.push(`产品${up.product_id}: 解锁成功（可出售，收益待出售时分配）`);
      } else {
        unlockLog.push(`产品${up.product_id}: 标记revenue_released失败`);
      }
    }

    console.log(`[unlock] 完成: 成功${successCount}/${userProducts.length}`);
    unlockLog.forEach(l => console.log(`  ${l}`));

    return NextResponse.json({
      success: true,
      message: `成功解锁 ${successCount} 个产品，会员可出售后收益到账`,
      data: {
        total: userProducts.length,
        success: successCount,
        log: unlockLog,
      },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[unlock] Error:', msg);
    return NextResponse.json({ success: false, message: '解锁失败: ' + msg }, { status: 500 });
  }
}
