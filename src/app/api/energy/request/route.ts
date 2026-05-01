import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseServiceRoleKey } from '@/lib/env';

// 获取管理员 Supabase 客户端（绕过 RLS）
function getAdminSupabase() {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    throw new Error('Missing Supabase configuration');
  }
  return createClient(url, key);
}

// 获取能量值申请列表
// - 如果有 branchId 参数：供分公司查看所有服务商申请
// - 如果有 userId 参数：供服务商查看自己的申请记录
export async function GET(request: NextRequest) {
  try {
    const supabase = getAdminSupabase();
    const searchParams = request.nextUrl.searchParams;
    const branchId = searchParams.get('branchId');
    const userId = searchParams.get('userId');
    const status = searchParams.get('status'); // pending, approved, rejected, all

    // 使用 energy_transactions 表查询，使用 type = 'recharge' 和 description 中包含 request_type = 'energy_request'
    const { data: allRecords, error } = await supabase
      .from('energy_transactions')
      .select('*')
      .eq('type', 'recharge');
    
    if (error) {
      console.error('[ERROR] 查询失败:', error);
      throw new Error(`查询失败: ${error.message}`);
    }
    
    // 过滤出能量值申请记录（description 中包含 request_type: 'energy_request'）
    let energyRequests = (allRecords || []).filter(record => {
      if (!record.description) return false;
      try {
        const desc = typeof record.description === 'string' 
          ? JSON.parse(record.description) 
          : record.description;
        return desc.request_type === 'energy_request';
      } catch {
        return false;
      }
    });
    
    // 如果是分公司查询
    if (branchId) {
      // 过滤匹配 branchId 的记录
      energyRequests = energyRequests.filter(record => {
        try {
          const desc = JSON.parse(record.description);
          return desc.branchId === branchId;
        } catch {
          return false;
        }
      });
      
      // 如果指定了状态，也按状态过滤
      if (status && status !== 'all') {
        energyRequests = energyRequests.filter(record => {
          try {
            const desc = JSON.parse(record.description);
            return desc.status === status;
          } catch {
            return false;
          }
        });
      }
      
      // 获取服务商用户信息
      const providerIds = [...new Set(energyRequests.map(r => r.user_id))];
      const { data: providers } = await supabase
        .from('users')
        .select('id, username, phone')
        .in('id', providerIds);
      
      const providerMap = new Map((providers || []).map((p: any) => [p.id, p]));
      
      // 格式化返回数据
      const records = energyRequests.map(record => {
        let description: Record<string, any> = {};
        try {
          description = JSON.parse(record.description);
        } catch {}
        
        const provider: any = providerMap.get(record.user_id) || {};
        return {
          id: record.id,
          providerId: record.user_id,
          providerName: provider.username || description.providerName || '未知',
          providerPhone: provider.phone || description.providerPhone || '',
          requestedAmount: description.requestedAmount || record.amount || 0,
          status: description.status || 'pending',
          note: description.note || '',
          reviewerNote: description.reviewerNote || '',
          createdAt: record.created_at,
          reviewedAt: description.reviewedAt || null,
        };
      }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return NextResponse.json({
        success: true,
        data: records,
      });
    }
    
    // 如果是服务商查询（查看自己的申请记录）
    if (userId) {
      let filteredRecords = energyRequests.filter(record => 
        record.user_id === userId
      );
      
      const formattedRecords = filteredRecords.map(record => {
        let description: Record<string, any> = {};
        try {
          description = JSON.parse(record.description);
        } catch {}
        
        return {
          id: record.id,
          userId: record.user_id,
          requestedAmount: description.requestedAmount || record.amount || 0,
          status: description.status || 'pending',
          note: description.note || '',
          reviewerNote: description.reviewerNote || '',
          reviewedAt: description.reviewedAt || null,
          createdAt: record.created_at,
        };
      });
      
      return NextResponse.json({
        success: true,
        data: formattedRecords
      });
    }

    return NextResponse.json(
      { success: false, error: '缺少查询参数（branchId 或 userId）' },
      { status: 400 }
    );
  } catch (error) {
    console.error('获取能量值申请列表失败:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}

// 服务商申请能量值
export async function POST(request: NextRequest) {
  try {
    const supabase = getAdminSupabase();
    const body = await request.json();
    const { userId, requestedAmount, note } = body;

    // 参数验证
    if (!userId || !requestedAmount) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    if (requestedAmount <= 0) {
      return NextResponse.json(
        { error: '申请金额必须大于0' },
        { status: 400 }
      );
    }

    // 使用 Supabase 查询服务商信息
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      );
    }

    // 验证是服务商角色
    if (user.role !== 'provider') {
      return NextResponse.json(
        { error: '只有服务商才能申请能量值' },
        { status: 403 }
      );
    }

    // 获取分公司的ID（使用 branch_id）
    const parentId = user.branch_id;
    if (!parentId) {
      return NextResponse.json(
        { error: '未找到所属分公司信息，服务商尚未绑定分公司' },
        { status: 400 }
      );
    }

    // 查询分公司信息
    const { data: branch, error: branchError } = await supabase
      .from('users')
      .select('id, username')
      .eq('id', parentId)
      .single();

    if (branchError || !branch) {
      return NextResponse.json(
        { error: '未找到所属分公司' },
        { status: 404 }
      );
    }

    // 插入申请记录到 energy_transactions 表，使用 type = 'recharge'
    const requestId = crypto.randomUUID();
    const description = JSON.stringify({
      request_type: 'energy_request',  // 标识这是能量值申请
      requestedAmount: requestedAmount,
      note: note || '',
      providerName: user.username,
      providerPhone: user.phone || '',
      branchId: parentId,
      branchName: branch.username,
      status: 'pending',
    });

    const { error: insertError } = await supabase
      .from('energy_transactions')
      .insert({
        id: requestId,
        user_id: userId,
        type: 'recharge',  // 使用 recharge 类型，因为 energy_request 类型不被允许
        amount: requestedAmount,
        description: description,
      });

    if (insertError) {
      console.error('插入申请记录失败:', insertError);
      return NextResponse.json(
        { error: '创建申请记录失败: ' + insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '能量值申请已提交，等待分公司审核',
      data: {
        requestId: requestId,
        requestedAmount: requestedAmount
      }
    });

  } catch (error: any) {
    console.error('能量值申请错误:', error);
    const errorMessage = error?.message || '服务器错误';
    return NextResponse.json(
      { error: '服务器错误: ' + errorMessage },
      { status: 500 }
    );
  }
}
