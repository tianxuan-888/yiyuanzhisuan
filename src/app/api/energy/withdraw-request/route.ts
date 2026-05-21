import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { generateUUID } from '@/lib/utils';
import { deductEnergy } from '@/lib/energy-util';

// 申请变现能量值（服务商/服务网点）
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['provider', 'branch'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { amount, targetUserId, note } = body;

    if (!amount || amount < 50) {
      return NextResponse.json({ error: '最低变现金额为50能量值' }, { status: 400 });
    }

    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      return NextResponse.json({ error: '金额无效' }, { status: 400 });
    }

    const supabase = getSupabase();

    // 服务商申请 → 上级服务网点审核
    // 服务网点申请 → 智算总台(admin)审核
    const approverRole = user.role === 'provider' ? 'branch' : 'admin';

    let approverId = targetUserId;
    if (user.role === 'provider') {
      const { data: providerData } = await supabase
        .from('users')
        .select('branch_id')
        .eq('id', user.userId)
        .maybeSingle();
      approverId = providerData?.branch_id;
    } else {
      const { data: adminData } = await supabase
        .from('users')
        .select('id')
        .eq('role', 'admin')
        .maybeSingle();
      approverId = adminData?.id;
    }

    if (!approverId) {
      return NextResponse.json({ error: '找不到上级审核人' }, { status: 400 });
    }

    // 创建变现申请记录
    const requestId = generateUUID();
    const { error: insertError } = await supabase
      .from('energy_withdraw_requests')
      .insert({
        id: requestId,
        user_id: user.userId,
        amount: withdrawAmount,
        actual_amount: withdrawAmount * 0.95,
        fee_amount: withdrawAmount * 0.05,
        approver_id: approverId,
        approver_role: approverRole,
        status: 'pending',
        note: note || `用户申请变现 ${withdrawAmount} 能量值`,
        created_at: new Date().toISOString(),
      });

    if (insertError) {
      throw new Error(`创建申请失败: ${insertError.message}`);
    }

    // 冻结能量值：使用 deductEnergy 扣减（双表同步 + 流水）
    const subResult = await deductEnergy(user.userId, withdrawAmount, 'withdraw_freeze', {
      note: `申请变现冻结 ${withdrawAmount} 能量值`,
    });

    if (!subResult.success) {
      // 如果扣减失败，删除刚创建的申请记录
      await supabase.from('energy_withdraw_requests').delete().eq('id', requestId);
      return NextResponse.json({ error: subResult.error || '能量值余额不足' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: '变现申请已提交，等待审核',
      data: {
        requestId,
        amount: withdrawAmount,
        actualAmount: withdrawAmount * 0.95,
        feeAmount: withdrawAmount * 0.05,
      }
    });
  } catch (error: any) {
    console.error('申请变现失败:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 获取变现申请列表
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['provider', 'branch', 'admin'])) {
      return NextResponse.json({ error: '无权查看' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'all';
    const role = searchParams.get('role');
    const isAdmin = searchParams.get('isAdmin') === 'true';

    const supabase = getSupabase();

    let queryBuilder = supabase
      .from('energy_withdraw_requests')
      .select('*, users:user_id(username, phone, role)')
      .order('created_at', { ascending: false });

    if (role) {
      queryBuilder = queryBuilder.eq('users.role', role);
    }

    if (user.role === 'branch') {
      queryBuilder = queryBuilder.eq('approver_id', user.userId);
    }

    if (user.role === 'admin' || isAdmin) {
      queryBuilder = queryBuilder.eq('approver_role', 'admin');
    }

    if (status !== 'all') {
      queryBuilder = queryBuilder.eq('status', status);
    }

    const { data: requests, error } = await queryBuilder;

    if (error) {
      throw new Error(`查询失败: ${error.message}`);
    }

    const stats = {
      total: requests?.length || 0,
      pending: requests?.filter((r: any) => r.status === 'pending').length || 0,
      approved: requests?.filter((r: any) => r.status === 'approved').length || 0,
      rejected: requests?.filter((r: any) => r.status === 'rejected').length || 0,
      totalAmount: requests?.reduce((sum: number, r: any) => sum + parseFloat(r.amount || 0), 0) || 0,
      totalFee: requests?.reduce((sum: number, r: any) => sum + parseFloat(r.fee_amount || 0), 0) || 0,
    };

    return NextResponse.json({
      success: true,
      data: {
        requests: requests || [],
        stats
      }
    });
  } catch (error: any) {
    console.error('获取变现申请失败:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
