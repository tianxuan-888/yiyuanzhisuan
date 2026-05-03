import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';
import { addEnergy, getEnergyBalance } from '@/lib/energy-util';

// 收益转能量值（5%变积分，95%变能量值）
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { amount } = body;
    const userId = authUser.userId;

    if (!amount) {
      return NextResponse.json({ error: '缺少转换金额' }, { status: 400 });
    }

    const convertAmount = parseFloat(amount);
    if (isNaN(convertAmount) || convertAmount <= 0) {
      return NextResponse.json({ error: '转换金额无效' }, { status: 400 });
    }

    if (convertAmount < 10) {
      return NextResponse.json({ error: '最小转换金额为 10 元' }, { status: 400 });
    }

    // 计算积分和能量值
    const pointsAmount = Math.round(convertAmount * 0.05 * 100) / 100; // 5% → 积分
    const energyAmount = convertAmount - pointsAmount; // 95% → 能量值

    const supabase = getSupabase();

    // 查询用户余额
    const { data: user } = await supabase
      .from('users')
      .select('id, username, balance, energy_value, points')
      .eq('id', userId)
      .single();

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    const currentBalance = parseFloat(user.balance) || 0;
    if (currentBalance < convertAmount) {
      return NextResponse.json({ error: '收益余额不足' }, { status: 400 });
    }

    const newBalance = (currentBalance - convertAmount).toFixed(2);
    const newPoints = ((parseFloat(user.points) || 0) + pointsAmount).toFixed(2);

    // 1. 更新用户余额和积分（能量值由 addEnergy 更新）
    const { error: updateUserErr } = await supabase
      .from('users')
      .update({ balance: newBalance, points: newPoints, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (updateUserErr) {
      console.error('[convert-to-energy] 更新用户余额失败:', updateUserErr.message);
      return NextResponse.json({ error: '更新用户余额失败' }, { status: 500 });
    }

    // 2. 使用 addEnergy 增加能量值（自动同步 users + energy_accounts + 流水）
    const addResult = await addEnergy(userId, energyAmount, 'convert_from_balance', {
      note: `收益转能量值: ${energyAmount.toFixed(2)}元`,
    });

    if (!addResult.success) {
      // 回滚用户余额
      await supabase
        .from('users')
        .update({ balance: currentBalance.toFixed(2), points: user.points, updated_at: new Date().toISOString() })
        .eq('id', userId);
      return NextResponse.json({ error: '转换能量值失败: ' + addResult.error }, { status: 500 });
    }

    // 3. 记录积分流水
    try {
      await supabase.from('points_records').insert({
        id: crypto.randomUUID(),
        user_id: userId,
        type: 'convert',
        amount: pointsAmount.toFixed(2),
        balance_after: newPoints,
        note: `收益转能量值产生积分5%: ${pointsAmount}元`,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[convert-to-energy] 记录积分流水失败（非关键）:', e);
    }

    return NextResponse.json({
      success: true,
      data: {
        convertedAmount: convertAmount.toFixed(2),
        energyAdded: energyAmount.toFixed(2),
        pointsAdded: pointsAmount.toFixed(2),
        balance: newBalance,
        energyValue: addResult.newBalance?.toFixed(2),
        points: newPoints,
      },
      message: `转换成功：${energyAmount.toFixed(2)}元→能量值，${pointsAmount.toFixed(2)}元→积分`,
    });
  } catch (error: any) {
    console.error('收益转能量值失败:', error);
    const statusCode = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || '转换失败' },
      { status: statusCode }
    );
  }
}
