import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 服务商申请能量值
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { providerId, amount, note } = body;

    if (!providerId || !amount || amount <= 0) {
      return NextResponse.json(
        { success: false, error: '参数不完整或金额无效' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient();

    // 查询服务商信息
    const { data: provider, error: providerError } = await client
      .from('users')
      .select('id, username, role, branch_id')
      .eq('id', providerId)
      .maybeSingle();

    if (providerError || !provider) {
      return NextResponse.json(
        { success: false, error: '服务商不存在' },
        { status: 404 }
      );
    }

    if (provider.role !== 'provider') {
      return NextResponse.json(
        { success: false, error: '只有服务商可以申请能量值' },
        { status: 403 }
      );
    }

    if (!provider.branch_id) {
      return NextResponse.json(
        { success: false, error: '服务商未绑定分公司' },
        { status: 400 }
      );
    }

    // 查询分公司信息
    const { data: branch, error: branchError } = await client
      .from('users')
      .select('id, username, role, energy_value')
      .eq('id', provider.branch_id)
      .maybeSingle();

    if (branchError || !branch) {
      return NextResponse.json(
        { success: false, error: '分公司不存在' },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();
    const requestId = crypto.randomUUID();

    // 创建能量值申请记录（只记录，等待分公司审核）
    const { error: insertError } = await client
      .from('transactions')
      .insert({
        id: requestId,
        user_id: providerId,
        type: 'energy_request', // 能量值申请
        amount: amount,
        description: JSON.stringify({
          action: 'energy_request',
          requestType: 'provider_to_branch',
          providerId: providerId,
          providerName: provider.username,
          branchId: provider.branch_id,
          branchName: branch.username,
          requestedAmount: amount,
          note: note || null,
          status: 'pending', // 待审核
        }),
        status: 'pending',
        created_at: now,
      });

    if (insertError) {
      throw new Error(`创建申请记录失败: ${insertError.message}`);
    }

    return NextResponse.json({
      success: true,
      message: '能量值申请已提交，等待分公司审核',
      data: {
        requestId,
        providerName: provider.username,
        branchName: branch.username,
        requestedAmount: amount,
      },
    });
  } catch (error: any) {
    console.error('能量值申请失败:', error);
    return NextResponse.json(
      { success: false, error: error.message || '申请失败' },
      { status: 500 }
    );
  }
}

// 获取服务商能量值申请记录
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');

    const client = getSupabaseClient();

    // 查询服务商信息以获取 branch_id
    let providerBranchId: string | null = null;
    let branchName = '';
    if (providerId) {
      const { data: providerData } = await client
        .from('users')
        .select('branch_id')
        .eq('id', providerId)
        .maybeSingle();
      
      if (providerData) {
        const pd = providerData as { branch_id: string | null };
        providerBranchId = pd.branch_id;
        
        // 查询分公司名称
        if (pd.branch_id) {
          const { data: branchData } = await client
            .from('users')
            .select('username')
            .eq('id', pd.branch_id)
            .maybeSingle();
          
          const bd = branchData as { username?: string } | null;
          branchName = bd?.username || '';
        }
      }
    }

    let query = client
      .from('transactions')
      .select('*')
      .eq('type', 'energy_request')
      .order('created_at', { ascending: false });

    if (providerId) {
      query = query.eq('user_id', providerId);
    }

    const { data: requests, error } = await query.limit(50);

    if (error) {
      throw new Error(`查询失败: ${error.message}`);
    }

    // 解析 description JSON 并添加 branchName
    const formattedRequests = (requests || []).map((req: any) => {
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
        amount: description.requestedAmount || req.amount,
        note: description.note || '',
        status: description.status || 'pending',
        created_at: req.created_at,
        reviewed_at: description.reviewed_at || null,
        branch_name: description.branchName || branchName,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        requests: formattedRequests,
        branchName: branchName,
      },
    });
  } catch (error: any) {
    console.error('查询申请记录失败:', error);
    return NextResponse.json(
      { success: false, error: error.message || '查询失败' },
      { status: 500 }
    );
  }
}
