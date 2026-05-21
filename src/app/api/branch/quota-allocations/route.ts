import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');

    if (!branchId) {
      return NextResponse.json({ success: false, error: '缺少服务网点ID' }, { status: 400 });
    }

    // 获取服务网点的服务商列表（从 quota_allocations + users）
    const providers = await query<{
      id: string;
      username: string;
      phone: string;
      template_id: string;
      template_name: string;
      quota_amount: number;
      used_amount: number;
    }>(
      `SELECT u.id, u.username, u.phone, 
              qa.template_id, pt.name as template_name,
              qa.quota_amount, qa.used_amount
       FROM quota_allocations qa
       JOIN users u ON qa.provider_id = u.id
       LEFT JOIN product_templates pt ON qa.template_id = pt.id
       WHERE qa.branch_id = $1 AND qa.status = 'active'`,
      [branchId]
    );

    // 获取服务网点的算力额度（从 quota_accounts 表）
    const quotaAccountsResult = await query<{ balance: number; total_in: number }>(
      `SELECT balance, total_in FROM quota_accounts WHERE user_id = $1`,
      [branchId]
    );
    const totalQuota = quotaAccountsResult?.[0]?.total_in || 0;
    const availableQuota = quotaAccountsResult?.[0]?.balance || 0;

    // 获取已分配给服务商的总额度
    const allocationsResult = await query<{ total_used: number }>(
      `SELECT COALESCE(SUM(used_amount), 0) as total_used 
       FROM quota_allocations 
       WHERE branch_id = $1 AND status = 'active'`,
      [branchId]
    );
    const usedQuota = allocationsResult?.[0]?.total_used || 0;

    // 构建返回数据（字段名与前端 QuotaAllocation 接口匹配）
    const records = providers.map(p => ({
      id: p.id,
      provider_id: p.id,
      template_id: p.template_id || '',
      quota_amount: p.quota_amount || 0,
      used_amount: p.used_amount || 0,
      status: 'active',
      created_at: new Date().toISOString(),
      provider: { id: p.id, username: p.username || '' },
      product_templates: p.template_name ? { name: p.template_name } : undefined,
    }));

    const stats = {
      totalQuota,
      usedQuota,
      availableQuota,
      providerCount: providers.length,
    };

    return NextResponse.json({
      success: true,
      data: {
        records,
        stats,
      },
    });
  } catch (error: any) {
    console.error('获取额度分配失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
