import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseServiceRoleKey } from '@/lib/env';

// 获取管理员 Supabase 客户端
function getAdminSupabase() {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    throw new Error('Missing Supabase configuration');
  }
  return createClient(url, key);
}

// 服务商查看自己的额度/收益申请记录
export async function GET(request: NextRequest) {
  try {
    const supabase = getAdminSupabase();
    const searchParams = request.nextUrl.searchParams;
    const providerId = searchParams.get('providerId');
    const status = searchParams.get('status'); // pending, approved, rejected, all

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: '缺少 providerId 参数' },
        { status: 400 }
      );
    }

    // 从 energy_transactions 表读取收益申请记录
    // type = 'recharge' 且 description 中包含 request_type = 'energy_request'
    const { data: allRecords, error } = await supabase
      .from('energy_transactions')
      .select('*')
      .eq('type', 'recharge')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[ERROR] 查询失败:', error);
      throw new Error(`查询失败: ${error.message}`);
    }

    // 过滤出收益申请记录
    let requests = (allRecords || []).filter(record => {
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

    // 过滤当前服务商的申请
    requests = requests.filter(record => record.user_id === providerId);

    // 过滤状态
    if (status && status !== 'all') {
      requests = requests.filter(record => {
        try {
          const desc = JSON.parse(record.description);
          return desc.status === status;
        } catch {
          return false;
        }
      });
    }

    // 格式化返回数据
    const records = requests.map(record => {
      let description: Record<string, any> = {};
      try {
        description = JSON.parse(record.description);
      } catch {}

      return {
        id: record.id,
        providerId: record.user_id,
        requestedAmount: description.requestedAmount || record.amount || 0,
        status: description.status || 'pending',
        note: description.note || '',
        branchId: description.branchId || '',
        branchName: description.branchName || '未知',
        reviewerNote: description.reviewerNote || '',
        reviewedAt: description.reviewedAt || null,
        createdAt: record.created_at,
      };
    });

    // 计算统计
    const stats = {
      total: records.length,
      pending: records.filter(r => r.status === 'pending').length,
      approved: records.filter(r => r.status === 'approved').length,
      rejected: records.filter(r => r.status === 'rejected').length,
      totalApproved: records
        .filter(r => r.status === 'approved')
        .reduce((sum, r) => sum + (r.requestedAmount || 0), 0),
    };

    return NextResponse.json({
      success: true,
      data: records,
      stats: stats,
    });

  } catch (error) {
    console.error('获取服务商申请记录失败:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
