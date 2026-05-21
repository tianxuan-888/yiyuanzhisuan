import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { getEnergyBalance, transferEnergy } from '@/lib/energy-util';

// 收益互转接口（服务商之间互转）
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { fromProviderId, toProviderId, amount, note } = body;

    if (!fromProviderId || !toProviderId || !amount) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (user.role !== 'admin' && user.userId !== fromProviderId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    if (fromProviderId === toProviderId) {
      return NextResponse.json({ error: '不能给自己转账' }, { status: 400 });
    }

    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount < 50) {
      return NextResponse.json({ error: '转账金额不能少于50' }, { status: 400 });
    }

    const supabase = getSupabase();

    // 验证双方角色
    const { data: fromUser } = await supabase.from('users').select('id, role').eq('id', fromProviderId).single();
    const { data: toUser } = await supabase.from('users').select('id, role').eq('id', toProviderId).single();

    if (!fromUser || fromUser.role !== 'provider') {
      return NextResponse.json({ error: '转出方不是服务商' }, { status: 400 });
    }
    if (!toUser || toUser.role !== 'provider') {
      return NextResponse.json({ error: '转入方不是服务商' }, { status: 400 });
    }

    // 验证余额
    const fromEnergy = await getEnergyBalance(fromProviderId);
    if (fromEnergy < transferAmount) {
      return NextResponse.json({ error: `收益不足，当前只有 ${fromEnergy}` }, { status: 400 });
    }

    // 使用 transferEnergy 执行原子转账（双表同步 + 双条流水）
    const result = await transferEnergy(fromProviderId, toProviderId, transferAmount, {
      note: note || '服务商间收益转账',
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: '转账成功',
      data: {
        fromEnergy: result.fromNewBalance,
        toEnergy: result.toNewBalance,
        amount: transferAmount
      }
    });
  } catch (error) {
    console.error('收益转账失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
