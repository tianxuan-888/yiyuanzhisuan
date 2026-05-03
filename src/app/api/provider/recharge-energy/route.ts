import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { deductEnergy, addEnergy, getEnergyBalance, transferEnergy } from '@/lib/energy-util';

// 服务商给会员充值能量值
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const providerId = authUser.userId;
    const body = await request.json();
    const { memberId, amount, note } = body;

    if (!memberId || !amount) {
      return NextResponse.json({ error: '缺少必要参数：memberId, amount' }, { status: 400 });
    }

    const rechargeAmount = parseFloat(amount);
    if (isNaN(rechargeAmount) || rechargeAmount <= 0) {
      return NextResponse.json({ error: '充值金额必须大于0' }, { status: 400 });
    }

    const supabase = getSupabase();

    // 验证服务商身份和能量值
    const providerBalance = await getEnergyBalance(providerId);
    if (providerBalance < rechargeAmount) {
      return NextResponse.json({
        error: '服务商能量值不足',
        data: { required: rechargeAmount, current: providerBalance },
      }, { status: 400 });
    }

    // 验证会员存在
    const { data: member } = await supabase
      .from('users')
      .select('id, username, energy_value')
      .eq('id', memberId)
      .single();

    if (!member) {
      return NextResponse.json({ error: '会员不存在' }, { status: 404 });
    }

    const memberEnergyBefore = await getEnergyBalance(memberId);

    // 使用 transferEnergy 执行原子转账（双表同步 + 双条流水）
    const result = await transferEnergy(providerId, memberId, rechargeAmount, {
      note: note || '服务商直接充值',
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // 记录到 energy_recharge_records
    const now = new Date().toISOString();
    await supabase.from('energy_recharge_records').insert({
      id: crypto.randomUUID(),
      provider_id: providerId,
      member_id: memberId,
      amount: rechargeAmount,
      status: 'approved',
      note: note || '服务商直接充值',
      created_at: now,
      updated_at: now,
    });

    return NextResponse.json({
      success: true,
      message: `成功为会员 ${member.username} 充值能量值 ${rechargeAmount}`,
      data: {
        provider: {
          id: providerId,
          afterEnergy: result.fromNewBalance,
        },
        member: {
          id: memberId,
          username: member.username,
          beforeEnergy: memberEnergyBefore,
          afterEnergy: result.toNewBalance,
        },
        amount: rechargeAmount,
        note: note || '无',
      },
    });
  } catch (error) {
    console.error('充值能量值失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '充值能量值失败' },
      { status: 500 }
    );
  }
}

// 获取服务商会员列表（用于选择要充值的会员）
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['provider'])) {
      return NextResponse.json({ error: '无权访问' }, { status: 403 });
    }

    const providerId = authUser.userId;
    const supabase = getSupabase();

    const { data: members } = await supabase
      .from('users')
      .select('id, username, phone, real_name, energy_value, created_at')
      .eq('provider_id', providerId)
      .eq('role', 'member');

    return NextResponse.json({
      success: true,
      data: members || [],
    });
  } catch (error) {
    console.error('获取会员列表失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取会员列表失败' },
      { status: 500 }
    );
  }
}
