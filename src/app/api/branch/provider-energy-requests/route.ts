import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 获取服务网点下的服务商收益申请列表
export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['branch', 'admin'])) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const userId = user.userId as string;
    const role = user.role as string;
    const client = getSupabaseClient();

    // 只允许服务网点管理员访问
    if (role !== 'branch' && role !== 'admin') {
      return NextResponse.json(
        { success: false, error: '无权限访问' },
        { status: 403 }
      );
    }

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId') || userId;
    const status = searchParams.get('status'); // pending, approved, rejected
    const showAll = searchParams.get('showAll') === 'true'; // 是否显示全部（包括已处理）

    if (!branchId) {
      return NextResponse.json(
        { success: false, error: '缺少服务网点ID' },
        { status: 400 }
      );
    }

    // 查询该服务网点下的服务商用户
    const { data: providers, error: providersError } = await client
      .from('users')
      .select('id, username, real_name, phone')
      .eq('branch_id', branchId)
      .eq('role', 'provider');

    if (providersError) {
      throw new Error(`查询服务商失败: ${providersError.message}`);
    }

    if (!providers || providers.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          requests: [],
          stats: {
            total: 0,
            pending: 0,
            approved: 0,
            rejected: 0,
          },
        },
      });
    }

    // 获取服务商ID列表
    const providerIds = (providers as any[]).map((p) => p.id);

    // 查询服务商向该服务网点发起的收益申请
    // 收益申请使用 type = 'recharge' + description 中包含 request_type = 'energy_request'
    let query = client
      .from('energy_transactions')
      .select('*')
      .in('user_id', providerIds)
      .eq('type', 'recharge')
      .order('created_at', { ascending: false });

    const { data: requests, error: requestsError } = await query.limit(100);

    if (requestsError) {
      throw new Error(`查询申请记录失败: ${requestsError.message}`);
    }

    const requestsList = (requests || []) as any[];

    // 处理数据
    const processedRequests = requestsList.map(req => {
      let desc: Record<string, any> = { status: 'pending' };
      const rawDesc = req.description;
      
      try {
        if (typeof rawDesc === 'object') {
          desc = rawDesc;
        } else if (typeof rawDesc === 'string' && rawDesc) {
          desc = JSON.parse(rawDesc);
        }
      } catch (e) {
        if (rawDesc === 'pending' || rawDesc === 'approved' || rawDesc === 'rejected') {
          desc = { status: rawDesc };
        }
      }

      const provider = (providers as any[]).find(p => p.id === req.user_id);

      return {
        id: req.id,
        providerId: req.user_id,
        providerName: provider?.real_name || provider?.username || '-',
        providerPhone: provider?.phone || '-',
        amount: desc.requestedAmount || desc.amount || 0, // 优先使用 requestedAmount
        status: desc.status || 'pending',
        note: desc.note || '',
        createdAt: req.created_at,
        reviewedAt: desc.reviewed_at || null,
        request_type: desc.request_type || '', // 保存 request_type 用于过滤
      };
    });

    // 过滤：只保留收益申请（request_type = 'energy_request'）
    const energyRequests = processedRequests.filter(r => r.request_type === 'energy_request');

    // 过滤状态（默认显示全部，包括已审核的记录）
    let filteredRequests = energyRequests;
    if (status) {
      filteredRequests = energyRequests.filter(r => r.status === status);
    }
    // 默认不过滤，显示全部记录（包括pending、approved、rejected）

    // 统计（基于所有收益申请）
    const stats = {
      total: energyRequests.length,
      pending: energyRequests.filter(r => r.status === 'pending').length,
      approved: energyRequests.filter(r => r.status === 'approved').length,
      rejected: energyRequests.filter(r => r.status === 'rejected').length,
    };

    return NextResponse.json({
      success: true,
      data: {
        requests: filteredRequests,
        stats,
      },
    });
  } catch (error: any) {
    console.error('获取收益申请列表失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
