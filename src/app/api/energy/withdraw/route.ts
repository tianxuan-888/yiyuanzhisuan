import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';
import { deductEnergy, addEnergy, getEnergyBalance } from '@/lib/energy-util';

// 服务网点向智算总台申请提现收益
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { fromUserId, toUserId, amount, note } = body;

    // 验证参数
    if (!fromUserId || !toUserId || !amount || amount <= 0) {
      return NextResponse.json(
        { success: false, error: '参数不完整或金额无效' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    // 验证操作人是否为服务网点
    const { data: fromUser } = await supabase
      .from('users')
      .select('id, role, username')
      .eq('id', fromUserId)
      .single();

    if (!fromUser || fromUser.role !== 'branch') {
      return NextResponse.json(
        { success: false, error: '只有服务网点可以申请提现收益' },
        { status: 403 }
      );
    }

    // 检查服务网点收益余额
    const fromBalance = await getEnergyBalance(fromUserId);
    if (fromBalance < amount) {
      return NextResponse.json(
        { success: false, error: '收益余额不足' },
        { status: 400 }
      );
    }

    // 检查最低提现金额（50收益）
    if (amount < 50) {
      return NextResponse.json(
        { success: false, error: '最低提现金额为50收益' },
        { status: 400 }
      );
    }

    // 1. 扣除服务网点收益（deductEnergy 自动同步 users + energy_accounts + 流水）
    const deductResult = await deductEnergy(fromUserId, amount, 'withdraw', {
      toUserId: toUserId,
      note: note || '服务网点提现收益',
    });

    if (!deductResult.success) {
      return NextResponse.json({ error: '扣除收益失败: ' + deductResult.error }, { status: 500 });
    }

    // 2. 增加智算总台收益（addEnergy 自动同步 users + energy_accounts + 流水）
    const addResult = await addEnergy(toUserId, amount, 'transfer_in', {
      fromUserId: fromUserId,
      note: note || '服务网点提现收益转入',
    });

    if (!addResult.success) {
      // 回滚服务网点扣减
      await addEnergy(fromUserId, amount, 'refund', { note: '提现失败回滚' });
      return NextResponse.json({ error: '智算总台增加收益失败: ' + addResult.error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: '收益提现成功',
      data: {
        amount,
        fromBalance: deductResult.newBalance,
        toBalance: addResult.newBalance,
      },
    });
  } catch (error: any) {
    console.error('收益提现失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
