import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 分公司审核能量值申请
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅管理员和分公司可审核
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'branch'])) {
      return NextResponse.json({ success: false, error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { requestId, branchId, action, note } = body;

    if (!requestId || !branchId || !action) {
      return NextResponse.json({ success: false, error: '参数不完整' }, { status: 400 });
    }

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ success: false, error: '操作无效' }, { status: 400 });
    }

    // 验证操作者权限
    if (user.role !== 'admin' && user.userId !== branchId) {
      return NextResponse.json({ success: false, error: '无权操作' }, { status: 403 });
    }

    const client = getSupabaseClient();

    // 查询申请记录 - 从 energy_transactions 表查询（服务商申请存储在此表）
    const { data: requestRecord, error: requestError } = await client
      .from('energy_transactions')
      .select('*')
      .eq('id', requestId)
      .eq('type', 'recharge')
      .maybeSingle();

    if (requestError || !requestRecord) {
      return NextResponse.json({ success: false, error: '申请记录不存在' }, { status: 404 });
    }

    let description: Record<string, unknown> = {};
    try {
      if (requestRecord.description) {
        description = JSON.parse(requestRecord.description);
      }
    } catch (e) {
      description = {};
    }
    
    // 检查申请状态
    if (description.status !== 'pending') {
      return NextResponse.json({ success: false, error: '该申请已被处理' }, { status: 400 });
    }

    // 验证是否是能量值申请
    if (description.request_type !== 'energy_request') {
      return NextResponse.json({ success: false, error: '该记录不是能量值申请' }, { status: 400 });
    }

    // 验证分公司是否有权限审核
    if (user.role !== 'admin' && description.branchId !== branchId) {
      return NextResponse.json({ success: false, error: '无权审核此申请' }, { status: 403 });
    }

    const providerId = description.providerId as string || requestRecord.user_id;
    const amount = description.requestedAmount as number || 0;

    // 查询分公司能量值
    const { data: branch, error: branchError } = await client
      .from('users')
      .select('id, username, energy_value')
      .eq('id', branchId)
      .maybeSingle();

    if (branchError || !branch) {
      return NextResponse.json({ success: false, error: '分公司不存在' }, { status: 404 });
    }

    if (action === 'approve') {
      // 审核通过：扣除分公司能量值，增加服务商能量值
      const branchEnergy = parseFloat(branch.energy_value || '0');
      if (branchEnergy < amount) {
        return NextResponse.json({ success: false, error: '分公司能量值余额不足' }, { status: 400 });
      }

      // 查询服务商
      const { data: provider, error: providerError } = await client
        .from('users')
        .select('id, username, energy_value')
        .eq('id', providerId)
        .maybeSingle();

      if (providerError || !provider) {
        return NextResponse.json({ success: false, error: '服务商不存在' }, { status: 404 });
      }

      // 扣除分公司能量值 - 白名单过滤
      await client.from('users').update({
        energy_value: branchEnergy - amount
      }).eq('id', branchId);

      // 增加服务商能量值 - 白名单过滤
      const providerEnergy = parseFloat(provider.energy_value || '0');
      await client.from('users').update({
        energy_value: providerEnergy + amount
      }).eq('id', providerId);

      // 更新申请状态 - 更新 energy_transactions 表
      await client.from('energy_transactions').update({
        description: JSON.stringify({ ...description, status: 'approved', reviewed_at: new Date().toISOString() })
      }).eq('id', requestId);

      return NextResponse.json({
        success: true,
        message: '审核通过，能量值已发放',
        data: { providerId, amount, branchEnergy: branchEnergy - amount }
      });
    }

    // 拒绝：更新申请状态 - 更新 energy_transactions 表
    await client.from('energy_transactions').update({
      description: JSON.stringify({ ...description, status: 'rejected', reviewed_at: new Date().toISOString() })
    }).eq('id', requestId);

    return NextResponse.json({ success: true, message: '已拒绝申请' });
  } catch (error) {
    console.error('审核能量值申请失败:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}

// 获取分公司下服务商的能量值申请列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    const status = searchParams.get('status'); // pending, completed, rejected, all

    const client = getSupabaseClient();

    // 查询该分公司下的所有服务商
    const { data: providers, error: providersError } = await client
      .from('users')
      .select('id, username')
      .eq('role', 'provider')
      .eq('branch_id', branchId);

    if (providersError) {
      throw new Error(`查询服务商失败: ${providersError.message}`);
    }

    if (!providers || providers.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
      });
    }

    const providerIds = providers.map(p => p.id);
    const providerMap = new Map(providers.map(p => [p.id, p.username]));

    // 查询这些服务商的能量值申请
    let query = client
      .from('transactions')
      .select('*')
      .eq('type', 'energy_request')
      .in('user_id', providerIds)
      .order('created_at', { ascending: false });

    const { data: requests, error } = await query.limit(100);

    if (error) {
      throw new Error(`查询申请记录失败: ${error.message}`);
    }

    // 解析并过滤申请记录
    let formattedRequests = (requests || []).map((req: any) => {
      let description: Record<string, unknown> = {};
      try {
        if (req.description) {
          description = JSON.parse(req.description);
        }
      } catch (e) {
        description = {};
      }
      return {
        id: req.id,
        providerId: req.user_id,
        providerName: providerMap.get(req.user_id) || '未知',
        amount: description.requestedAmount || req.amount,
        note: description.note || '',
        status: description.status || 'pending',
        created_at: req.created_at,
        reviewed_at: description.reviewed_at || null,
      };
    });

    // 按状态过滤
    if (status && status !== 'all') {
      if (status === 'pending') {
        formattedRequests = formattedRequests.filter(r => r.status === 'pending');
      } else {
        formattedRequests = formattedRequests.filter(r => r.status !== 'pending');
      }
    }

    return NextResponse.json({
      success: true,
      data: formattedRequests,
    });
  } catch (error: any) {
    console.error('获取能量值申请列表失败:', error);
    return NextResponse.json(
      { success: false, error: error.message || '获取失败' },
      { status: 500 }
    );
  }
}
