import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';
import { getEnergyBalance, transferEnergy } from '@/lib/energy-util';

// 能量值转给服务商（直接到账，非审核流程）
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { providerId, amount } = body;

    // 强制使用 JWT 中的 userId，防止冒充
    const userId = authUser.userId;

    if (!providerId || !amount) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const energyAmount = parseFloat(amount);
    if (isNaN(energyAmount) || energyAmount <= 0) {
      return NextResponse.json({ error: '能量值数量无效' }, { status: 400 });
    }

    if (energyAmount < 50) {
      return NextResponse.json({ error: '最小转账金额为 50 能量值' }, { status: 400 });
    }

    const supabase = getSupabase();

    // 验证服务商存在
    const { data: provider } = await supabase.from('users').select('id, username, role').eq('id', providerId).eq('role', 'provider').single();
    if (!provider) {
      return NextResponse.json({ error: '服务商不存在' }, { status: 404 });
    }

    // 验证会员余额
    const currentEnergy = await getEnergyBalance(userId);
    if (currentEnergy < energyAmount) {
      return NextResponse.json({ error: `能量值不足，当前只有 ${currentEnergy}` }, { status: 400 });
    }

    // 使用 transferEnergy 执行原子转账
    const result = await transferEnergy(userId, providerId, energyAmount, {
      note: `能量值转给服务商: ${provider.username}`,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        energy_value: result.fromNewBalance.toFixed(2),
      },
      message: `成功转出 ${energyAmount} 能量值给服务商`,
    });
  } catch (error: any) {
    console.error('能量值转账失败:', error);
    const statusCode = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || '能量值转账失败' },
      { status: statusCode }
    );
  }
}
