import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';

// 获取服务商的收益转收益记录
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const userId = authUser.userId;
    const supabase = getSupabase();

    // 查询收益转换记录
    const { data: energyRecords, error: eErr } = await supabase
      .from('energy_transactions')
      .select('id, amount, note, energy_before, energy_after, created_at')
      .eq('user_id', userId)
      .eq('type', 'convert_from_balance')
      .order('created_at', { ascending: false })
      .limit(50);

    if (eErr) {
      return NextResponse.json({ error: '查询转换记录失败' }, { status: 500 });
    }

    // 查询积分记录
    const { data: pointsRecords, error: pErr } = await supabase
      .from('points_records')
      .select('id, amount, balance_after, note, created_at')
      .eq('user_id', userId)
      .eq('type', 'convert')
      .order('created_at', { ascending: false })
      .limit(50);

    if (pErr) {
      // 积分记录查询失败不影响主流程
      console.error('查询积分记录失败:', pErr);
    }

    // 合并记录：按时间匹配（同一次转换的energy和points记录时间接近）
    const records = (energyRecords || []).map((er: any) => {
      const energyAmount = parseFloat(String(er.amount)) || 0;
      // 收益占95%，所以总转换金额 = 收益 / 0.95
      const totalAmount = Math.round(energyAmount / 0.95 * 100) / 100;
      const pointsAmount = Math.round((totalAmount - energyAmount) * 100) / 100;

      // 尝试匹配积分记录（时间差5秒内）
      const matchedPoints = (pointsRecords || []).find((pr: any) => {
        const timeDiff = Math.abs(new Date(er.created_at).getTime() - new Date(pr.created_at).getTime());
        return timeDiff < 5000;
      });

      return {
        id: er.id,
        totalAmount,
        energyAmount,
        pointsAmount: matchedPoints ? parseFloat(String(matchedPoints.amount)) : pointsAmount,
        energyBefore: er.energy_before,
        energyAfter: er.energy_after,
        pointsAfter: matchedPoints?.balance_after || null,
        note: er.note,
        createdAt: er.created_at,
      };
    });

    // 统计
    const stats = {
      totalConverted: records.reduce((sum: number, r: any) => sum + r.totalAmount, 0),
      totalEnergy: records.reduce((sum: number, r: any) => sum + r.energyAmount, 0),
      totalPoints: records.reduce((sum: number, r: any) => sum + r.pointsAmount, 0),
      count: records.length,
    };

    return NextResponse.json({
      success: true,
      data: { records, stats },
    });
  } catch (error: any) {
    console.error('获取转换记录失败:', error);
    return NextResponse.json({ error: error.message || '查询失败' }, { status: 500 });
  }
}
