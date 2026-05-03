import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { transferEnergy } from '@/lib/energy-util';

// 能量值充值（服务商给会员充值）
// 使用 transferEnergy 确保双表同步 + 双条流水
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { providerId, memberId, amount } = body;

    if (!providerId || !memberId || !amount) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const rechargeAmount = parseFloat(amount);
    if (isNaN(rechargeAmount) || rechargeAmount <= 0) {
      return NextResponse.json({ error: '充值金额必须大于0' }, { status: 400 });
    }

    const supabase = getSupabase();

    // 验证服务商
    const { data: provider } = await supabase.from('users').select('id, username, energy_value, role').eq('id', providerId).single();
    if (!provider) {
      return NextResponse.json({ error: '服务商不存在' }, { status: 404 });
    }
    if (provider.role !== 'provider' && provider.role !== 'admin') {
      return NextResponse.json({ error: '只有服务商才能充值能量值' }, { status: 403 });
    }

    // 验证会员
    const { data: member } = await supabase.from('users').select('id, username, energy_value').eq('id', memberId).single();
    if (!member) {
      return NextResponse.json({ error: '会员不存在' }, { status: 404 });
    }

    // 检查服务商能量值是否足够
    const providerEnergy = parseFloat(String(provider.energy_value)) || 0;
    if (providerEnergy < rechargeAmount) {
      return NextResponse.json({
        success: false,
        error: '服务商能量值不足',
        data: {
          required: rechargeAmount,
          current: providerEnergy,
          short: rechargeAmount - providerEnergy,
        },
      }, { status: 400 });
    }

    // 使用 transferEnergy 执行原子转账（双表同步 + 双条流水）
    const result = await transferEnergy(providerId, memberId, rechargeAmount, {
      fromType: 'transfer_out',
      toType: 'recharge',
      note: `给会员充值能量值`,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `成功为会员 ${member.username} 充值能量值 ${rechargeAmount}`,
      data: {
        provider: {
          id: providerId,
          username: provider.username,
          beforeEnergy: providerEnergy,
          afterEnergy: result.fromNewBalance,
        },
        member: {
          id: memberId,
          username: member.username,
          beforeEnergy: parseFloat(String(member.energy_value)) || 0,
          afterEnergy: result.toNewBalance,
        },
        amount: rechargeAmount,
      },
    });
  } catch (error) {
    console.error('能量值充值失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '充值失败' },
      { status: 500 }
    );
  }
}
