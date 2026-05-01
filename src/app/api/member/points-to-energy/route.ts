import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest } from '@/lib/auth';

// 积分转能量值
export async function POST(request: NextRequest) {
  try {
    // 鉴权：需要登录
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, points } = body;

    if (!userId || !points) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 验证操作者权限
    if (user.role !== 'admin' && user.userId !== userId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const pointsAmount = parseFloat(points);
    if (isNaN(pointsAmount) || pointsAmount <= 0) {
      return NextResponse.json({ error: '积分数量无效' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 查询用户信息
    const { data: userData, error: userError } = await client
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (userError || !userData) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    const currentPoints = parseFloat(userData.points || '0');
    if (currentPoints < pointsAmount) {
      return NextResponse.json({ error: '积分不足' }, { status: 400 });
    }

    // 白名单过滤
    const newPoints = currentPoints - pointsAmount;
    const currentEnergy = parseFloat(userData.energy_value || '0');
    const newEnergy = currentEnergy + pointsAmount;

    // 更新用户积分和能量值
    const { error: updateError } = await client
      .from('users')
      .update({
        points: newPoints,
        energy_value: newEnergy,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      throw new Error(`更新用户数据失败: ${updateError.message}`);
    }

    // 创建交易记录
    await client.from('transactions').insert({
      user_id: userId,
      type: 'points_to_energy',
      amount: pointsAmount,
      note: `积分转能量值: ${pointsAmount}`
    });

    return NextResponse.json({
      success: true,
      message: '转换成功',
      data: { newPoints, newEnergy, points: pointsAmount }
    });
  } catch (error) {
    console.error('积分转能量值失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
