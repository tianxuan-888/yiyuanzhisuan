import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { execute, queryOne } from '@/lib/pg-client';

// 获取提现申请列表
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');
    const status = searchParams.get('status') || 'all';

    if (!providerId) {
      return NextResponse.json({ error: '缺少服务商ID' }, { status: 400 });
    }

    const userAny = user as { role: string; userId: string };
    if (userAny.role !== 'admin' && userAny.userId !== providerId) {
      return NextResponse.json({ error: '无权查看' }, { status: 403 });
    }

    const client = getSupabaseClient();

    const { data: members, error: membersError } = await client
      .from('users')
      .select('id')
      .eq('provider_id', providerId)
      .eq('role', 'member');

    if (membersError) {
      throw new Error(`查询会员失败: ${membersError.message}`);
    }

    const memberIds = (members || []).map((m: any) => m.id);

    if (memberIds.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    let query = client
      .from('withdrawals')
      .select('*')
      .in('user_id', memberIds)
      .order('created_at', { ascending: false });

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data: withdrawals, error: withdrawalsError } = await query;

    if (withdrawalsError) {
      throw new Error(`查询提现申请失败: ${withdrawalsError.message}`);
    }

    let enrichedWithdrawals = withdrawals || [];
    if (withdrawals && withdrawals.length > 0) {
      const userIds = [...new Set((withdrawals as any[]).map((w: any) => w.user_id))];
      const { data: usersData } = await client
        .from('users')
        .select('id, username, phone, alipay_account, real_name')
        .in('id', userIds);

      const usersMap = ((usersData || []) as any[]).reduce((acc: Record<string, any>, u: any) => {
        acc[u.id] = u;
        return acc;
      }, {});

      enrichedWithdrawals = (withdrawals as any[]).map((w: any) => ({
        ...w,
        user: usersMap[w.user_id] || null
      }));
    }

    return NextResponse.json({ success: true, data: enrichedWithdrawals });
  } catch (error) {
    console.error('获取提现申请失败:', error);
    return NextResponse.json({ error: '获取提现申请失败' }, { status: 500 });
  }
}

// 处理提现申请
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { providerId, withdrawalId, action, remark } = body;

    if (!providerId || !withdrawalId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const userAny = user as { role: string; userId: string };
    if (userAny.role !== 'admin' && userAny.userId !== providerId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '无效的操作' }, { status: 400 });
    }

    const client = getSupabaseClient();

    const { data: withdrawal, error: withdrawalError } = await client
      .from('withdrawals')
      .select('*')
      .eq('id', withdrawalId)
      .maybeSingle();

    if (withdrawalError) {
      throw new Error(`查询提现记录失败: ${withdrawalError.message}`);
    }

    const withdrawalAny = withdrawal as { status: string; user_id: string; amount: number } | null;
    if (!withdrawalAny) {
      return NextResponse.json({ error: '提现记录不存在' }, { status: 404 });
    }

    if (withdrawalAny.status !== 'pending') {
      return NextResponse.json({ error: '该提现已被处理' }, { status: 400 });
    }

    const baseUpdate = {
      reviewed_by: providerId,
      review_note: remark || null,
      reviewed_at: new Date().toISOString()
    };

    if (action === 'reject') {
      const userRow = await queryOne('SELECT balance FROM users WHERE id = $1', [withdrawalAny.user_id]);
      const currentBalance = parseFloat(String(userRow?.balance)) || 0;
      const newBalance = currentBalance + withdrawalAny.amount;

      await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newBalance, withdrawalAny.user_id]);
      await client.from('withdrawals').update({ ...baseUpdate, status: 'rejected' }).eq('id', withdrawalId);

      return NextResponse.json({ success: true, message: '已拒绝提现申请' });
    }

    const withdrawAmount = withdrawalAny.amount;
    const feeAmount = withdrawAmount * 0.05;
    const actualAmount = withdrawAmount * 0.95;

    await client.from('withdrawals').update({ 
      ...baseUpdate, 
      status: 'completed',
      actual_amount: actualAmount,
      fee_amount: feeAmount
    }).eq('id', withdrawalId);

    const { data: providerData } = await client
      .from('users')
      .select('energy_value')
      .eq('id', providerId)
      .maybeSingle();

    const currentProviderEnergy = parseFloat(String((providerData as any)?.energy_value || '0'));
    await client.from('users').update({ 
      energy_value: currentProviderEnergy + actualAmount 
    }).eq('id', providerId);

    const { data: adminData } = await client
      .from('users')
      .select('id, energy_value')
      .eq('role', 'admin')
      .maybeSingle();
    
    const adminAccount = adminData as { id: string; energy_value: number } | null;

    if (adminAccount) {
      const currentAdminEnergy = parseFloat(String(adminAccount.energy_value || '0'));
      await client.from('users').update({ 
        energy_value: currentAdminEnergy + feeAmount 
      }).eq('role', 'admin');

      await client.from('energy_transactions').insert({
        type: 'withdraw_fee',
        amount: feeAmount,
        from_user_id: withdrawalAny.user_id,
        to_user_id: adminAccount.id,
        note: `变现手续费回收：会员提现${withdrawAmount}，回收${feeAmount}（5%）`
      });
    }

    await client.from('energy_transactions').insert({
      type: 'withdraw_receive',
      amount: actualAmount,
      from_user_id: withdrawalAny.user_id,
      to_user_id: providerId,
      note: `会员变现：服务商获得${actualAmount}（扣除5%手续费${feeAmount}）`
    });

    return NextResponse.json({ 
      success: true, 
      message: `已批准，会员获得${actualAmount}（已扣除5%手续费${feeAmount}）`,
      data: { actualAmount, feeAmount }
    });
  } catch (error) {
    console.error('处理提现申请失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
