import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { generateUUID } from '@/lib/utils';

// 申请变现能量值（服务商/分公司）
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

    // 服务商申请 → 上级分公司审核
    // 分公司申请 → 总公司(admin)审核
    const approverRole = user.role === 'provider' ? 'branch' : 'admin';

    // 查找上级审核人
    const client = getSupabaseClient();
    
    let approverId = targetUserId;
    if (user.role === 'provider') {
      // 服务商找上级分公司
      const { data: providerData } = await client
        .from('users')
        .select('branch_id')
        .eq('id', user.userId)
        .maybeSingle();
      
      approverId = providerData?.branch_id;
    } else {
      // 分公司找总公司
      const { data: adminData } = await client
        .from('users')
        .select('id')
        .eq('role', 'admin')
        .maybeSingle();
      
      approverId = adminData?.id;
    }

    if (!approverId) {
      return NextResponse.json({ error: '找不到上级审核人' }, { status: 400 });
    }

    // 检查能量值余额
    const { data: accountData } = await client
      .from('energy_accounts')
      .select('balance, total_out')
      .eq('user_id', user.userId)
      .maybeSingle();

    const account = accountData as { balance: number; total_out: number } | null;
    const currentBalance = account?.balance || 0;
    if (currentBalance < amount) {
      return NextResponse.json({ error: '能量值余额不足' }, { status: 400 });
    }

    // 创建变现申请记录
    const requestId = generateUUID();
    const { error: insertError } = await client
      .from('energy_withdraw_requests')
      .insert({
        id: requestId,
        user_id: user.userId,
        amount: amount,
        actual_amount: amount * 0.95, // 到账金额（已扣5%）
        fee_amount: amount * 0.05,    // 手续费
        approver_id: approverId,
        approver_role: approverRole,
        status: 'pending',
        note: note || `用户申请变现 ${amount} 能量值`
      });

    if (insertError) {
      throw new Error(`创建申请失败: ${insertError.message}`);
    }

    // 冻结能量值（扣除）
    await client
      .from('energy_accounts')
      .update({
        balance: currentBalance - amount,
        total_out: (account?.total_out || 0) + amount
      })
      .eq('user_id', user.userId);

    return NextResponse.json({
      success: true,
      message: '变现申请已提交，等待审核',
      data: {
        requestId,
        amount,
        actualAmount: amount * 0.95,
        feeAmount: amount * 0.05
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
    const role = searchParams.get('role'); // 查看服务商/分公司申请
    const isAdmin = searchParams.get('isAdmin') === 'true';

    const client = getSupabaseClient();
    
    let query = client
      .from('energy_withdraw_requests')
      .select('*, users:user_id(username, phone, role)')
      .order('created_at', { ascending: false });

    // 按角色过滤
    if (role) {
      query = query.eq('users.role', role);
    }

    // 分公司只能看服务商的申请
    if (user.role === 'branch') {
      query = query.eq('approver_id', user.userId);
    }

    // 总公司只能看分公司的申请
    if (user.role === 'admin' || isAdmin) {
      query = query.eq('approver_role', 'admin');
    }

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data: requests, error } = await query;

    if (error) {
      throw new Error(`查询失败: ${error.message}`);
    }

    // 统计数据
    const stats = {
      total: requests?.length || 0,
      pending: requests?.filter(r => r.status === 'pending').length || 0,
      approved: requests?.filter(r => r.status === 'approved').length || 0,
      rejected: requests?.filter(r => r.status === 'rejected').length || 0,
      totalAmount: requests?.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0) || 0,
      totalFee: requests?.reduce((sum, r) => sum + parseFloat(r.fee_amount || 0), 0) || 0,
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
