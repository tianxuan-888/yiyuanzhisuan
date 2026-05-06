import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';
import { addEnergy } from '@/lib/energy-util';

// 分公司收益转能量值（5%变积分，95%变能量值）
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    if (authUser.role !== 'branch') {
      return NextResponse.json({ error: '仅分公司可使用此接口' }, { status: 403 });
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

    const pointsAmount = Math.round(convertAmount * 0.05 * 100) / 100;
    const energyAmount = convertAmount - pointsAmount;

    const supabase = getSupabase();

    // 读取当前用户信息
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, username, balance, energy_value, points')
      .eq('id', userId)
      .single();

    if (userErr || !user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    const currentBalance = parseFloat(String(user.balance)) || 0;
    if (currentBalance < convertAmount) {
      return NextResponse.json({ error: '收益余额不足' }, { status: 400 });
    }

    const newBalance = currentBalance - convertAmount;
    const currentPoints = parseFloat(String(user.points)) || 0;
    const newPoints = currentPoints + pointsAmount;

    // 1. 更新 users 表：扣减余额、增加积分（使用execute(SQL)防止静默失败）
    const { execute } = await import('@/lib/pg-client');
    await execute(
      `UPDATE users SET balance = $1, points = $2, updated_at = NOW() WHERE id = $3`,
      [newBalance.toFixed(2), newPoints.toFixed(2), userId]
    );

    // 2. 增加能量值（双表同步 + 流水）
    const addResult = await addEnergy(userId, energyAmount, 'convert_from_balance', {
      note: `收益转能量值: ${energyAmount.toFixed(2)}元`,
    });

    if (!addResult.success) {
      return NextResponse.json({ error: addResult.error }, { status: 500 });
    }

    // 3. 记录积分流水
    await supabase.from('points_records').insert({
      id: crypto.randomUUID(),
      user_id: userId,
      type: 'convert',
      amount: pointsAmount.toFixed(2),
      balance_after: newPoints.toFixed(2),
      note: `收益转能量值产生积分5%: ${pointsAmount}元`,
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      data: {
        convertedAmount: convertAmount.toFixed(2),
        energyAdded: energyAmount.toFixed(2),
        pointsAdded: pointsAmount.toFixed(2),
        balance: newBalance.toFixed(2),
        energyValue: addResult.newBalance.toFixed(2),
        points: newPoints.toFixed(2),
      },
      message: `转换成功：${energyAmount.toFixed(2)}元→能量值，${pointsAmount.toFixed(2)}元→积分`,
    });
  } catch (error: any) {
    console.error('分公司收益转能量值失败:', error);
    const statusCode = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || '转换失败' },
      { status: statusCode }
    );
  }
}
