import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

// 获取分公司下的服务商列表
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const branchId = searchParams.get('branchId');

    if (!branchId) {
      return NextResponse.json(
        { error: '缺少分公司ID参数' },
        { status: 400 }
      );
    }

    // 直接从 users 表查询该分公司下的服务商（通过 branch_id 关联）
    const users = await query<{
      id: string;
      username: string;
      real_name: string;
      phone: string;
      energy_value: string;
      balance: string;
    }>(
      `SELECT id, username, real_name, phone, energy_value, balance 
       FROM users 
       WHERE role = 'provider' AND branch_id = $1`,
      [branchId]
    );

    // 从 quota_allocations 获取额度信息
    const allocations = await query<{
      provider_id: string;
      quota_amount: number;
      used_amount: number;
    }>(
      `SELECT provider_id, quota_amount, used_amount 
       FROM quota_allocations 
       WHERE branch_id = $1 AND status = 'active'`,
      [branchId]
    );

    // 合并数据
    const allocationsMap = new Map(allocations.map(a => [a.provider_id, a]));
    
    const providers = users.map(user => {
      const allocation = allocationsMap.get(user.id);
      return {
        id: user.id,
        username: user.username || '',
        energy_value: parseInt(user.energy_value || '0'),
        balance: parseInt(user.balance || '0'),
        quota_amount: allocation?.quota_amount || 0,
        used_amount: allocation?.used_amount || 0,
        available_amount: (allocation?.quota_amount || 0) - (allocation?.used_amount || 0),
        created_at: new Date().toISOString(),
      };
    });

    // 统计该分公司下的服务商总数
    const totalProviders = providers.length;

    // 获取服务商申请待审核数量
    const pendingResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM quota_requests 
       WHERE parent_id = $1 AND status = 'pending'`,
      [branchId]
    );
    const pendingCount = pendingResult ? parseInt(pendingResult.count) : 0;

    // 获取服务商总业绩
    let totalSales = 0;
    if (providers.length > 0) {
      const providerIds = providers.map(p => p.id);
      
      const ordersResult = await queryOne<{ total: string }>(
        `SELECT COALESCE(SUM(o.amount), 0) as total 
         FROM orders o
         JOIN user_products up ON o.user_product_id = up.id
         JOIN products p ON up.product_id = p.id
         WHERE p.provider_id = ANY($1) AND o.status = 'completed'`,
        [providerIds]
      );
      
      totalSales = ordersResult ? parseInt(ordersResult.total) : 0;
    }

    return NextResponse.json({
      success: true,
      data: {
        providers,
        stats: {
          totalProviders,
          pendingApplications: pendingCount,
          totalSales,
        },
      },
    });
  } catch (error) {
    console.error('获取服务商列表失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取服务商列表失败' },
      { status: 500 }
    );
  }
}
