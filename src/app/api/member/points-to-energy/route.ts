import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';
import { addEnergy } from '@/lib/energy-util';

// 积分转收益（同步更新 users + energy_accounts + energy_transactions）
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { points } = body;
    const userId = user.userId;

    if (!points) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const pointsAmount = parseFloat(points);
    if (isNaN(pointsAmount) || pointsAmount <= 0) {
      return NextResponse.json({ error: '积分数量无效' }, { status: 400 });
    }

    const supabase = getSupabase();

    // 查询用户信息
    const { data: userData, error: userErr } = await supabase
      .from('users')
      .select('id, points, energy_value')
      .eq('id', userId)
      .single();

    if (userErr || !userData) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    const currentPoints = parseFloat(String(userData.points)) || 0;
    if (currentPoints < pointsAmount) {
      return NextResponse.json({ error: '积分不足' }, { status: 400 });
    }

    const newPoints = currentPoints - pointsAmount;

    // 1. 更新 users 表积分
    const { error: updErr } = await supabase
      .from('users')
      .update({
        points: newPoints.toFixed(2),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (updErr) {
      return NextResponse.json({ error: '更新积分失败: ' + updErr.message }, { status: 500 });
    }

    // 2. 增加收益（双表同步 + 流水）
    const addResult = await addEnergy(userId, pointsAmount, 'convert_from_balance', {
      note: `积分转收益: ${pointsAmount}`,
    });

    if (!addResult.success) {
      return NextResponse.json({ error: addResult.error }, { status: 500 });
    }

    // 3. 记录积分流水
    await supabase.from('points_records').insert({
      id: crypto.randomUUID(),
      user_id: userId,
      type: 'exchange',
      amount: pointsAmount.toFixed(2),
      balance_after: newPoints.toFixed(2),
      note: `积分转收益: -${pointsAmount}`,
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: '转换成功',
      data: {
        newPoints: newPoints.toFixed(2),
        newEnergy: addResult.newBalance.toFixed(2),
        points: pointsAmount,
      }
    });
  } catch (error: any) {
    console.error('积分转收益失败:', error);
    const statusCode = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || '服务器错误' },
      { status: statusCode }
    );
  }
}
