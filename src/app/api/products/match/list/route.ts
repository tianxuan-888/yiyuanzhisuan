import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');

    if (!providerId) {
      return NextResponse.json({ success: false, message: '缺少服务商ID' }, { status: 400 });
    }

    const { data: products, error } = await supabase
      .from('products')
      .select(`
        id, name, code, price, period, total_rate, market_rate, profit_rate,
        status, previous_holder_id, pending_match_user_id, provider_id,
        created_at, updated_at
      `)
      .eq('provider_id', providerId)
      .eq('status', 'pending_match')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }

    // 获取用户信息
    const holderIds = [...new Set(products?.map(p => p.previous_holder_id).filter(Boolean))];
    const matchUserIds = [...new Set(products?.map(p => p.pending_match_user_id).filter(Boolean))];
    const allUserIds = [...new Set([...holderIds, ...matchUserIds])];

    let userMap: Record<string, { username: string; phone: string; unique_id: string }> = {};
    if (allUserIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, username, phone, unique_id')
        .in('id', allUserIds);

      (users || []).forEach(u => {
        userMap[u.id] = { username: u.username, phone: u.phone, unique_id: u.unique_id };
      });
    }

    const enrichedProducts = (products || []).map(p => ({
      ...p,
      previous_holder: p.previous_holder_id ? userMap[p.previous_holder_id] || null : null,
      pending_match_user: p.pending_match_user_id ? userMap[p.pending_match_user_id] || null : null,
    }));

    return NextResponse.json({
      success: true,
      data: enrichedProducts
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
