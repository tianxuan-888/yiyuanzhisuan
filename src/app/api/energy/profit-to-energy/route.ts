import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest } from '@/lib/auth';

// 收益转能量值
export async function POST(request: NextRequest) {
  try {
    // 鉴权：需要登录
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, amount } = body;

    // 参数验证
    if (!userId || !amount) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 验证操作者权限
    if (user.role !== 'admin' && user.userId !== userId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    if (amount <= 0) {
      return NextResponse.json({ error: '转换金额必须大于0' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 查询用户信息
    const { data: userData, error: userError } = await client
      .from('users')
      .select('id, username, balance, energy_value')
      .eq('id', userId)
      .maybeSingle();

    if (userError || !userData) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    // 检查余额是否足够
    const userBalance = parseFloat(userData.balance || '0');
    if (userBalance < amount) {
      return NextResponse.json({
        success: false,
        error: '余额不足',
        data: { required: amount, current: userBalance, short: amount - userBalance }
      }, { status: 400 });
    }

    // 白名单过滤
    const newBalance = userBalance - amount;
    const newEnergy = parseFloat(userData.energy_value || '0') + amount;

    // 扣除余额
    const { error: updateBalanceError } = await client
      .from('users')
      .update({ balance: newBalance })
      .eq('id', userId);

    if (updateBalanceError) {
      throw new Error(`扣除余额失败: ${updateBalanceError.message}`);
    }

    // 增加能量值
    const { error: updateEnergyError } = await client
      .from('users')
      .update({ energy_value: newEnergy })
      .eq('id', userId);

    if (updateEnergyError) {
      // 回滚余额
      await client.from('users').update({ balance: userBalance }).eq('id', userId);
      throw new Error(`增加能量值失败: ${updateEnergyError.message}`);
    }

    // 记录交易
    await client.from('transactions').insert({
      user_id: userId,
      type: 'profit_to_energy',
      amount: amount,
      note: '收益转换为能量值'
    });

    return NextResponse.json({
      success: true,
      message: '转换成功',
      data: { newBalance, newEnergy, amount }
    });
  } catch (error) {
    console.error('收益转能量值失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
