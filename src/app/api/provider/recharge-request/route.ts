import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { verifyToken } from '@/lib/auth';
import { addEnergy, deductEnergy, getEnergyBalance } from '@/lib/energy-util';

// 获取服务商的充值申请列表
export async function GET(request: NextRequest) {
  try {
    // 验证授权
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const decoded = await verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '无效的认证令牌' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');
    const status = searchParams.get('status');

    if (!providerId) {
      return NextResponse.json({ error: '服务商ID不能为空' }, { status: 400 });
    }

    const supabase = getSupabase();

    // 查询充值申请
    let query = supabase
      .from('energy_recharge_records')
      .select('id, provider_id, member_id, amount, status, note, reviewed_by, reviewed_at, created_at, updated_at')
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data: records, error: queryErr } = await query;

    if (queryErr) {
      console.error('[recharge-request] 查询失败:', queryErr.message);
      return NextResponse.json({ error: '查询失败: ' + queryErr.message }, { status: 500 });
    }

    // 获取关联会员信息
    const memberIds = [...new Set((records || []).map(r => r.member_id))];
    const { data: members } = await supabase
      .from('users')
      .select('id, username, phone, unique_id')
      .in('id', memberIds);

    const memberMap: Record<string, { username: string; phone: string; unique_id: string }> = {};
    (members || []).forEach(m => {
      memberMap[m.id] = { username: m.username, phone: m.phone, unique_id: m.unique_id };
    });

    const requests = (records || []).map(r => ({
      id: r.id,
      memberId: r.member_id,
      memberName: memberMap[r.member_id]?.username || '未知',
      memberPhone: memberMap[r.member_id]?.phone || '未知',
      uniqueId: memberMap[r.member_id]?.unique_id || '',
      amount: Number(r.amount),
      note: r.note || null,
      status: r.status || 'pending',
      createdAt: r.created_at,
    }));

    return NextResponse.json({ success: true, data: requests });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('获取充值申请失败:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// 审批充值申请
export async function POST(request: NextRequest) {
  try {
    // 验证授权
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const decoded = await verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '无效的认证令牌' }, { status: 401 });
    }

    const body = await request.json();
    const { requestId, providerId, action, note } = body;

    if (!requestId || !providerId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const supabase = getSupabase();

    // 查询充值记录
    const { data: record, error: recordErr } = await supabase
      .from('energy_recharge_records')
      .select('*')
      .eq('id', requestId)
      .single();

    if (recordErr || !record) {
      return NextResponse.json({ error: '充值申请不存在' }, { status: 404 });
    }

    if (record.provider_id !== providerId) {
      return NextResponse.json({ error: '无权操作此申请' }, { status: 403 });
    }

    if (record.status !== 'pending') {
      return NextResponse.json({ error: '该申请已被处理' }, { status: 400 });
    }

    const amount = Number(record.amount);
    const memberId = record.member_id;

    if (action === 'approve') {
      // 1. 检查服务商能量值是否充足
      const providerBalance = await getEnergyBalance(providerId);

      if (providerBalance < amount) {
        return NextResponse.json({ error: '服务商能量值不足，无法充值' }, { status: 400 });
      }

      // 2. 获取会员信息（用于流水描述）
      const { data: member } = await supabase
        .from('users')
        .select('username')
        .eq('id', memberId)
        .single();

      // 3. 扣减服务商能量值（自动更新 users.energy_value + energy_accounts + energy_transactions）
      const deductResult = await deductEnergy(providerId, amount, 'transfer_out', {
        toUserId: memberId,
        note: `给会员${member?.username || ''}充值能量值`,
      });

      if (!deductResult.success) {
        return NextResponse.json({ error: '扣减服务商能量值失败: ' + deductResult.error }, { status: 500 });
      }

      // 4. 增加会员能量值（自动更新 users.energy_value + energy_accounts + energy_transactions）
      const addResult = await addEnergy(memberId, amount, 'recharge', {
        fromUserId: providerId,
        note: '服务商充值能量值',
      });

      if (!addResult.success) {
        // 会员增加失败，回滚服务商扣减
        console.error('[recharge-request] 会员增加能量值失败，回滚服务商');
        await addEnergy(providerId, amount, 'refund', {
          fromUserId: memberId,
          note: '充值失败退款',
        });
        return NextResponse.json({ error: '增加会员能量值失败: ' + addResult.error }, { status: 500 });
      }

      // 5. 更新充值记录状态
      const { error: updateErr } = await supabase
        .from('energy_recharge_records')
        .update({
          status: 'approved',
          reviewed_by: providerId,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', requestId);

      if (updateErr) {
        console.error('[recharge-request] 更新记录状态失败:', updateErr.message);
      }

      return NextResponse.json({
        success: true,
        message: `已成功充值 ${amount} 能量值给 ${member?.username || '会员'}`,
        data: {
          amount,
          memberEnergy: addResult.newBalance,
          providerEnergy: deductResult.newBalance,
        },
      });
    } else if (action === 'reject') {
      // 拒绝：更新记录状态
      const { error: updateErr } = await supabase
        .from('energy_recharge_records')
        .update({
          status: 'rejected',
          reviewed_by: providerId,
          reviewed_at: new Date().toISOString(),
          note: note ? `${record.note || ''} | 拒绝原因: ${note}` : record.note,
          updated_at: new Date().toISOString(),
        })
        .eq('id', requestId);

      if (updateErr) {
        console.error('[recharge-request] 更新拒绝状态失败:', updateErr.message);
        return NextResponse.json({ error: '操作失败: ' + updateErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: '已拒绝充值申请',
      });
    }

    return NextResponse.json({ error: '无效的操作' }, { status: 400 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('审批充值申请失败:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
