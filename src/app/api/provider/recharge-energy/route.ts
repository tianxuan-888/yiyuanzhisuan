import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 服务商给会员充值能量值
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅服务商可操作
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    // 从 JWT 获取服务商 ID
    const providerId = authUser.userId;

    const body = await request.json();
    const { memberId, amount, note } = body;

    // 参数验证
    if (!memberId || !amount) {
      return NextResponse.json(
        { error: '缺少必要参数：providerId, memberId, amount' },
        { status: 400 }
      );
    }

    const rechargeAmount = parseFloat(amount);
    if (rechargeAmount <= 0) {
      return NextResponse.json(
        { error: '充值金额必须大于0' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient();

    // 1. 验证服务商身份
    const { data: provider, error: providerError } = await client
      .from('users')
      .select('id, username, energy_value, role')
      .eq('id', providerId)
      .maybeSingle();

    if (providerError) {
      throw new Error(`查询服务商失败: ${providerError.message}`);
    }

    if (!provider || provider.role !== 'provider') {
      return NextResponse.json(
        { error: '非服务商身份，无权操作' },
        { status: 403 }
      );
    }

    // 2. 验证服务商能量值是否足够
    const providerEnergy = parseFloat(provider.energy_value || '0');
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

    // 3. 验证会员存在
    const { data: member, error: memberError } = await client
      .from('users')
      .select('id, username, energy_value')
      .eq('id', memberId)
      .maybeSingle();

    if (memberError) {
      throw new Error(`查询会员失败: ${memberError.message}`);
    }

    if (!member) {
      return NextResponse.json(
        { error: '会员不存在' },
        { status: 404 }
      );
    }

    // 4. 扣除服务商能量值
    const newProviderEnergy = providerEnergy - rechargeAmount;
    const { error: updateProviderError } = await client
      .from('users')
      .update({ energy_value: newProviderEnergy })
      .eq('id', providerId);

    if (updateProviderError) {
      throw new Error(`扣除服务商能量值失败: ${updateProviderError.message}`);
    }

    // 5. 增加会员能量值
    const memberEnergy = parseFloat(member.energy_value || '0');
    const newMemberEnergy = memberEnergy + rechargeAmount;
    const { error: updateMemberError } = await client
      .from('users')
      .update({ energy_value: newMemberEnergy })
      .eq('id', memberId);

    if (updateMemberError) {
      // 回滚服务商能量值
      await client
        .from('users')
        .update({ energy_value: providerEnergy })
        .eq('id', providerId);
      throw new Error(`增加会员能量值失败: ${updateMemberError.message}`);
    }

    // 6. 记录服务商能量值变动
    await client.from('transactions').insert({
      user_id: providerId,
      type: 'transfer_out',
      amount: -rechargeAmount,
      balance: newProviderEnergy,
      description: `给会员 ${member.username} 充值能量值`,
      related_id: memberId,
    });

    // 7. 记录会员能量值变动
    await client.from('transactions').insert({
      user_id: memberId,
      type: 'recharge',
      amount: rechargeAmount,
      balance: newMemberEnergy,
      description: `服务商 ${provider.username} 充值`,
      related_id: providerId,
    });

    // 8. 发送通知给会员
    await client.from('notifications').insert({
      receiver_id: memberId,
      receiver_role: 'member',
      sender_id: providerId,
      sender_name: provider.username,
      type: 'energy_recharge',
      title: '能量值充值成功',
      content: `服务商 ${provider.username} 为您充值能量值 ${rechargeAmount}，备注：${note || '无'}`,
      amount: rechargeAmount,
    });

    return NextResponse.json({
      success: true,
      message: `成功为会员 ${member.username} 充值能量值 ${rechargeAmount}`,
      data: {
        provider: {
          id: providerId,
          username: provider.username,
          beforeEnergy: providerEnergy,
          afterEnergy: newProviderEnergy,
        },
        member: {
          id: memberId,
          username: member.username,
          beforeEnergy: memberEnergy,
          afterEnergy: newMemberEnergy,
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
    // 鉴权：仅服务商可查看自己的会员
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['provider'])) {
      return NextResponse.json({ error: '无权访问' }, { status: 403 });
    }

    // 从 JWT 获取服务商 ID
    const providerId = authUser.userId;

    const client = getSupabaseClient();

    // 获取服务商名下的会员
    const { data: members, error } = await client
      .from('users')
      .select('id, username, phone, real_name, energy_value, created_at')
      .eq('provider_id', providerId)
      .eq('role', 'member');

    if (error) {
      throw new Error(`查询会员列表失败: ${error.message}`);
    }

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

