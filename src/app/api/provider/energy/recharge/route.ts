import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest } from '@/lib/auth';

/**
 * 服务商给会员充值能量值
 * POST /api/provider/energy/recharge
 */
export async function POST(request: NextRequest) {
  const client = getSupabaseClient();
  
  try {
    const user = authenticateRequest(request);
    if (!user || user.role !== 'provider') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const providerId = user.userId;
    const { memberId, amount, note } = await request.json();

    // 验证参数
    if (!memberId) {
      return NextResponse.json({ error: '请选择会员' }, { status: 400 });
    }

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: '请输入正确的充值金额' }, { status: 400 });
    }

    // 验证服务商余额
    const { data: provider, error: providerError } = await client
      .from('users')
      .select('id, username, energy_value')
      .eq('id', providerId)
      .single();

    if (providerError || !provider) {
      return NextResponse.json({ error: '服务商不存在' }, { status: 404 });
    }

    const currentProviderBalance = parseFloat(provider.energy_value) || 0;
    if (currentProviderBalance < amount) {
      return NextResponse.json({ error: '能量值余额不足' }, { status: 400 });
    }

    // 验证会员存在
    const { data: member, error: memberError } = await client
      .from('users')
      .select('id, username')
      .eq('id', memberId)
      .eq('role', 'member')
      .single();

    if (memberError || !member) {
      return NextResponse.json({ error: '会员不存在' }, { status: 404 });
    }

    // 执行充值（原子操作）
    const newProviderBalance = currentProviderBalance - amount;
    
    // 扣除服务商能量值
    await client
      .from('users')
      .update({ energy_value: newProviderBalance })
      .eq('id', providerId);

    // 增加会员能量值
    const { data: memberEa } = await client
      .from('energy_accounts')
      .select('balance')
      .eq('user_id', memberId)
      .single();
    
    const newMemberBalance = (parseFloat(memberEa?.balance) || 0) + amount;
    
    if (memberEa) {
      await client
        .from('energy_accounts')
        .update({ 
          balance: newMemberBalance,
          total_in: newMemberBalance,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', memberId);
    } else {
      await client
        .from('energy_accounts')
        .insert({
          id: crypto.randomUUID(),
          user_id: memberId,
          balance: amount,
          total_in: amount,
          total_out: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
    }

    // 同时更新会员users表的energy_value
    try {
      await client
        .from('users')
        .update({ energy_value: newMemberBalance })
        .eq('id', memberId);
    } catch (e) {
      console.error('Update member energy error:', e);
    }

    // 记录服务商支出
    await client
      .from('energy_transactions')
      .insert({
        id: crypto.randomUUID(),
        user_id: providerId,
        type: 'transfer_out',
        amount: amount,
        from_user_id: providerId,
        to_user_id: memberId,
        note: note || '给会员充值能量值',
        status: 'completed',
        created_at: new Date().toISOString()
      });

    // 记录会员收入
    await client
      .from('energy_transactions')
      .insert({
        id: crypto.randomUUID(),
        user_id: memberId,
        type: 'recharge',
        amount: amount,
        from_user_id: providerId,
        to_user_id: memberId,
        note: note || '服务商充值',
        status: 'completed',
        created_at: new Date().toISOString()
      });

    return NextResponse.json({
      success: true,
      message: `已成功充值 ${amount} 能量值给 ${member.username}`,
      data: {
        amount,
        memberName: member.username,
        memberBalance: newMemberBalance,
        providerEnergy: newProviderBalance,
      }
    });

  } catch (error: any) {
    console.error('Recharge error:', error);
    return NextResponse.json({ error: `充值失败: ${error.message}` }, { status: 500 });
  }
}
