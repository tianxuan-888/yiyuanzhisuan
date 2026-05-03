import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取所有服务商的管理数据
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId'); // 可选：筛选单个分公司下的服务商
    const providerId = searchParams.get('providerId'); // 可选：筛选单个服务商

    // 构建查询条件 - 需要关联 providers 表来筛选 branch_id
    let userFilter = "WHERE u.role = 'provider'";
    let params: any[] = [];
    let paramIndex = 1;

    if (providerId) {
      userFilter += ` AND u.id = $${paramIndex}`;
      params.push(providerId);
      paramIndex++;
    } else if (branchId) {
      userFilter += ` AND pr.branch_id = $${paramIndex}`;
      params.push(branchId);
      paramIndex++;
    }

    // 1. 查询所有服务商基本信息
    // 服务商的 branch_id 需要从 providers 表获取
    const providers = await query<{
      id: string;
      username: string;
      phone: string;
      real_name: string;
      energy_value: string;
      balance: string;
      branch_id: string;
      provider_id: string;
      created_at: string;
    }>(
      `SELECT u.id, u.username, u.phone, u.real_name, u.energy_value, u.balance, 
              u.branch_id, u.provider_id, u.created_at,
              COALESCE(ea.balance, 0)::text as energy_balance,
              pr.branch_id,
              b.username as branch_name
       FROM users u
       LEFT JOIN energy_accounts ea ON u.id = ea.user_id
       LEFT JOIN providers pr ON u.id = pr.user_id
       LEFT JOIN users b ON pr.branch_id = b.id
       ${userFilter}
       ORDER BY u.created_at DESC`,
      params
    );

    // 2. 查询每个服务商的会员数量
    const memberCounts = await query<{ provider_id: string; count: string }>(
      `SELECT provider_id, COUNT(*)::text as count 
       FROM users 
       WHERE role = 'member' AND provider_id IS NOT NULL
       GROUP BY provider_id`
    );

    // 3. 查询每个服务商的累计销售金额
    const salesStats = await query<{ provider_id: string; total_sales: string; order_count: string }>(
      `SELECT p.provider_id,
              COALESCE(SUM(o.amount), 0)::text as total_sales,
              COUNT(o.id)::text as order_count
       FROM orders o
       JOIN user_products up ON o.user_product_id = up.id
       JOIN products p ON up.product_id = p.id
       WHERE o.order_type = 'buy' AND o.status = 'completed'
       GROUP BY p.provider_id`
    );

    // 4. 查询服务商的额度信息
    const quotaStats = await query<{ provider_id: string; quota: string; used_quota: string; total_sales: string }>(
      `SELECT user_id as provider_id, quota, used_quota, total_sales
       FROM providers`
    );

    // 5. 查询服务商的收益统计（从能量值流水）
    const profitStats = await query<{ user_id: string; total_profit: string }>(
      `SELECT et.related_user_id as user_id,
              COALESCE(SUM(ABS(et.amount)), 0)::text as total_profit
       FROM energy_transactions et
       WHERE et.type = 'market_transfer' AND et.related_user_id IS NOT NULL
       GROUP BY et.related_user_id`
    );

    // 6. 查询服务商下级服务商数量
    const subProviderCounts = await query<{ provider_id: string; count: string }>(
      `SELECT provider_id, COUNT(*)::text as count 
       FROM users 
       WHERE role = 'provider' AND provider_id IS NOT NULL
       GROUP BY provider_id`
    );

    // 构建统计数据映射
    const memberCountMap = new Map<string, number>();
    memberCounts.forEach(m => {
      memberCountMap.set(m.provider_id, parseInt(m.count || '0'));
    });

    const salesStatsMap = new Map<string, { total: number; count: number }>();
    salesStats.forEach(s => {
      salesStatsMap.set(s.provider_id, {
        total: parseFloat(s.total_sales || '0'),
        count: parseInt(s.order_count || '0')
      });
    });

    const quotaStatsMap = new Map<string, { quota: number; used: number; sales: number }>();
    quotaStats.forEach(q => {
      quotaStatsMap.set(q.provider_id, {
        quota: parseFloat(q.quota || '0'),
        used: parseFloat(q.used_quota || '0'),
        sales: parseFloat(q.total_sales || '0')
      });
    });

    const profitStatsMap = new Map<string, number>();
    profitStats.forEach(p => {
      profitStatsMap.set(p.user_id, parseFloat(p.total_profit || '0'));
    });

    const subProviderCountMap = new Map<string, number>();
    subProviderCounts.forEach(sp => {
      subProviderCountMap.set(sp.provider_id, parseInt(sp.count || '0'));
    });

    // 组合数据
    const providerData = providers.map(provider => {
      const memberCount = memberCountMap.get(provider.id) || 0;
      const salesInfo = salesStatsMap.get(provider.id) || { total: 0, count: 0 };
      const quotaInfo = quotaStatsMap.get(provider.id) || { quota: 0, used: 0, sales: 0 };
      const totalProfit = profitStatsMap.get(provider.id) || 0;
      const subProviderCount = subProviderCountMap.get(provider.id) || 0;
      const providerAny = provider as any;
      const energyBalance = parseFloat(providerAny.energy_balance || provider.energy_value || '0');

      return {
        // 基本信息
        id: provider.id,
        name: provider.username,
        realName: provider.real_name || '-',
        phone: provider.phone || '-',
        branchId: provider.branch_id,
        branchName: providerAny.branch_name || '-',
        parentProviderId: providerAny.provider_id,
        createdAt: provider.created_at,
        
        // 账户信息
        account: {
          energyBalance: energyBalance,
          cashBalance: parseFloat(provider.balance || '0'),
        },
        
        // 额度信息
        quota: {
          total: quotaInfo.quota,
          used: quotaInfo.used,
          available: quotaInfo.quota - quotaInfo.used,
        },
        
        // 业绩统计
        stats: {
          totalSales: salesInfo.total,
          orderCount: salesInfo.count,
          memberCount: memberCount,
          subProviderCount: subProviderCount,
          totalUserCount: 1 + memberCount + subProviderCount, // 服务商自己 + 会员 + 下级服务商
          totalProfit: totalProfit,
        }
      };
    });

    // 计算汇总统计
    const summary = {
      totalProviders: providerData.length,
      totalMembers: providerData.reduce((sum, p) => sum + p.stats.memberCount, 0),
      totalSubProviders: providerData.reduce((sum, p) => sum + p.stats.subProviderCount, 0),
      totalSales: providerData.reduce((sum, p) => sum + p.stats.totalSales, 0),
      totalEnergyBalance: providerData.reduce((sum, p) => sum + p.account.energyBalance, 0),
      totalProfit: providerData.reduce((sum, p) => sum + p.stats.totalProfit, 0),
    };

    return NextResponse.json({
      success: true,
      data: {
        providers: providerData,
        summary
      }
    });

  } catch (error: any) {
    console.error('获取服务商管理数据失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
