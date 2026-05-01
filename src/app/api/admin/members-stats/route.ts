import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const supabase = getSupabaseClient();

export async function GET(request: NextRequest) {
  try {
    // 获取会员总数
    const { count: totalMembers, error: countError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'member');

    if (countError) {
      console.error('获取会员总数失败:', countError);
      return NextResponse.json(
        { success: false, error: `获取会员总数失败: ${countError.message}` },
        { status: 500 }
      );
    }

    // 获取昨日新增会员数
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const { count: yesterdayNew, error: yesterdayError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'member')
      .gte('created_at', `${yesterdayStr}T00:00:00`)
      .lt('created_at', `${yesterdayStr}T23:59:59`);

    if (yesterdayError) {
      console.error('获取昨日新增会员数失败:', yesterdayError);
    }

    // 获取今日新增会员数
    const today = new Date().toISOString().split('T')[0];

    const { count: todayNew, error: todayError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'member')
      .gte('created_at', `${today}T00:00:00`);

    if (todayError) {
      console.error('获取今日新增会员数失败:', todayError);
    }

    // 获取有持仓的会员数
    const { count: holdingMembers, error: holdingError } = await supabase
      .from('user_products')
      .select('user_id', { count: 'exact', head: true })
      .eq('status', 'holding');

    if (holdingError) {
      console.error('获取持仓会员数失败:', holdingError);
    }

    // 获取会员购买统计
    const { data: purchaseData, error: purchaseError } = await supabase
      .from('user_products')
      .select(`
        purchase_price,
        expected_profit,
        status,
        purchase_date
      `)
      .eq('status', 'holding');

    if (purchaseError) {
      console.error('获取会员购买统计失败:', purchaseError);
    }

    interface PurchaseRecord {
      purchase_price: number;
      expected_profit: number;
    }
    const purchaseList = (purchaseData || []) as PurchaseRecord[];

    // 计算总持仓金额和预期收益
    const totalHoldings = purchaseList.reduce((sum, p) => sum + Number(p.purchase_price || 0), 0);
    const totalExpectedProfit = purchaseList.reduce((sum, p) => sum + Number(p.expected_profit || 0), 0);

    // 获取最近7天的新增会员趋势
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const { data: recentMembers, error: recentError } = await supabase
      .from('users')
      .select('created_at')
      .eq('role', 'member')
      .gte('created_at', sevenDaysAgo.toISOString());

    if (recentError) {
      console.error('获取最近新增会员失败:', recentError);
    }

    const recentMembersList = (recentMembers || []) as Array<{ created_at: string }>;

    // 计算每日新增会员数
    const newUsersTrend: Record<string, number> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      newUsersTrend[dateStr] = 0;
    }
    
    recentMembersList.forEach(m => {
      const dateStr = m.created_at.split('T')[0];
      if (newUsersTrend[dateStr] !== undefined) {
        newUsersTrend[dateStr]++;
      }
    });

    // 转换趋势数据为数组
    const newUsersTrendArray = Object.entries(newUsersTrend)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      success: true,
      data: {
        totalMembers: totalMembers || 0,
        todayNewMembers: todayNew || 0,
        yesterdayNewMembers: yesterdayNew || 0,
        holdingMembers: holdingMembers || 0,
        totalHoldings,
        totalExpectedProfit,
        newUsersTrend: newUsersTrendArray,
        purchaseCount: (purchaseData || []).length,
      },
    });
  } catch (error) {
    console.error('服务器错误:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
