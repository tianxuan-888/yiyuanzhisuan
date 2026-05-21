import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';
import { getEnergyBalance, transferEnergy } from '@/lib/energy-util';

// 服务网点直接转账能量值给服务商或会员
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    if (authUser.role !== 'branch' && authUser.role !== 'admin') {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { branchId, targetId, targetType, amount, note } = body;

    if (!branchId || !targetId || !targetType || !amount) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (targetType !== 'provider' && targetType !== 'member') {
      return NextResponse.json({ error: '目标类型无效' }, { status: 400 });
    }

    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      return NextResponse.json({ error: '转账金额必须大于0' }, { status: 400 });
    }

    const supabase = getSupabase();

    // 验证服务网点
    const { data: branch } = await supabase.from('users').select('id, username').eq('id', branchId).eq('role', 'branch').single();
    if (!branch) {
      return NextResponse.json({ error: '服务网点不存在' }, { status: 404 });
    }

    // 验证目标用户
    const targetRole = targetType === 'provider' ? 'provider' : 'member';
    const { data: target } = await supabase.from('users').select('id, username, role').eq('id', targetId).eq('role', targetRole).single();
    if (!target) {
      return NextResponse.json({ error: `${targetType === 'provider' ? '服务商' : '会员'}不存在` }, { status: 404 });
    }

    // 如果是服务商，验证是否属于该服务网点
    if (targetType === 'provider') {
      const { data: providerInfo } = await supabase.from('providers').select('branch_id').eq('user_id', targetId).single();
      if (!providerInfo || providerInfo.branch_id !== branchId) {
        return NextResponse.json({ error: '该服务商不属于您的服务网点' }, { status: 403 });
      }
    }

    // 验证服务网点余额
    const branchEnergy = await getEnergyBalance(branchId);
    if (branchEnergy < transferAmount) {
      return NextResponse.json({ error: `能量值余额不足，当前余额: ${branchEnergy}` }, { status: 400 });
    }

    // 使用 transferEnergy 执行原子转账
    const result = await transferEnergy(branchId, targetId, transferAmount, {
      note: note || `服务网点转账给${target.username}`,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `成功转账 ${transferAmount} 能量值给 ${target.username}`,
      data: {
        branchId,
        targetId,
        amount: transferAmount,
        newBranchEnergy: result.fromNewBalance,
        newTargetEnergy: result.toNewBalance,
      },
    });
  } catch (error) {
    console.error('服务网点转账失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '转账失败' },
      { status: 500 }
    );
  }
}
