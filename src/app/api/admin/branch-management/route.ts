import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取所有服务网点的管理数据（增强版）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId'); // 可选：筛选单个服务网点
    const includeProviders = searchParams.get('includeProviders') === 'true'; // 是否包含服务商详情

    // 构建查询条件
    let branchFilter = '';
    let params: any[] = [];
    
    if (branchId) {
      branchFilter = 'WHERE u.id = $1 AND u.role = $2';
      params = [branchId, 'branch'];
    } else {
      branchFilter = 'WHERE u.role = $1';
      params = ['branch'];
    }

    // 1. 查询所有服务网点基本信息
    const branches = await query<{
      id: string;
      username: string;
      phone: string;
      
      balance: string;
      created_at: string;
    }>(
      `SELECT u.id, u.username, u.phone, 0, u.balance, u.created_at,
              COALESCE(ea.balance, 0)::text as energy_balance
       FROM users u
       LEFT JOIN energy_accounts ea ON u.id = ea.user_id
       ${branchFilter}
       ORDER BY u.created_at DESC`,
      params
    );

    // 2. 查询每个服务网点的服务商数量（从 providers 表获取）
    const providerCounts = await query<{ branch_id: string; count: string }>(
      `SELECT p.branch_id, COUNT(*) as count 
       FROM providers p
       WHERE p.branch_id IS NOT NULL
       GROUP BY p.branch_id`
    );

    // 3. 查询每个服务网点的服务商体系用户数量（服务商 + 会员）
    const userCounts = await query<{ branch_id: string; provider_count: string; member_count: string }>(
      `SELECT 
        p.branch_id,
        COUNT(DISTINCT p.user_id)::text as provider_count,
        (SELECT COUNT(*) FROM users u WHERE u.provider_id IN (SELECT user_id FROM providers WHERE branch_id = p.branch_id) AND u.role = 'member')::text as member_count
       FROM providers p
       WHERE p.branch_id IS NOT NULL
       GROUP BY p.branch_id`
    );

    // 4. 查询算力额度申请数额（从 quota_requests 表）
    const quotaRequests = await query<{ requester_id: string; total_amount: string; status: string }>(
      `SELECT requester_id, SUM(requested_amount)::text as total_amount, status
       FROM quota_requests
       WHERE requester_type = 'branch'
       GROUP BY requester_id, status`
    );

    // 5. 查询产品额度（从 quota_accounts 表获取服务网点的算力账户余额）
    const quotaAccountBalances = await query<{ 
      user_id: string;
      balance: string;
      total_in: string;
    }>(
      `SELECT 
        qa.user_id,
        COALESCE(qa.balance, 0)::text as balance,
        COALESCE(qa.total_in, 0)::text as total_in
       FROM quota_accounts qa
       JOIN users u ON qa.user_id = u.id
       WHERE u.role = 'branch'`
    );
    console.log('[BranchManagement] quotaAccountBalances:', quotaAccountBalances);
    console.log('[BranchManagement] branches:', branches.map(b => b.id));

    // 6. 查询每个服务网点及其体系下的收益总和
    // 包括：服务网点自己的收益 + 该服务网点下所有服务商的收益 + 所有会员的收益
    // 先查询所有用户的收益
    const allUserEnergy = await query<{ 
      user_id: string;
      branch_id: string | null;
      role: string;
      balance: string;
    }>(
      `SELECT 
        ea.user_id::text as user_id,
        u.branch_id,
        u.role,
        COALESCE(ea.balance, 0)::text as balance
       FROM energy_accounts ea
       LEFT JOIN users u ON ea.user_id::text = u.id`
    );

    // 在内存中计算每个服务网点的收益总和
    const branchEnergyMap = new Map<string, { branch: number; provider: number; member: number; total: number }>();
    
    allUserEnergy.forEach(e => {
      const balance = parseFloat(e.balance || '0');
      
      // 服务网点收益 - 服务网点的 branch_id 为 NULL，所以用 user_id 作为 key
      if (e.role === 'branch') {
        const key = e.user_id;  // 用 user_id 作为服务网点的 key
        const existing = branchEnergyMap.get(key) || { branch: 0, provider: 0, member: 0, total: 0 };
        existing.branch += balance;
        existing.total += balance;
        branchEnergyMap.set(key, existing);
      }
      
      // 服务商收益 - 通过 providers 表获取 branch_id
      if (e.role === 'provider') {
        const providerData = allUserEnergy.filter(p => p.user_id === e.user_id);
        // 需要从 providers 表获取 branch_id
      }
    });

    // 7. 查询所有服务商的 branch_id
    const providersList = await query<{ user_id: string; branch_id: string }>(
      `SELECT user_id::text, branch_id FROM providers WHERE branch_id IS NOT NULL`
    );

    // 创建 user_id -> branch_id 映射
    const userToBranchMap = new Map<string, string>();
    providersList.forEach(p => {
      userToBranchMap.set(p.user_id, p.branch_id);
    });

    // 再次遍历所有用户，计算服务商和会员的收益
    allUserEnergy.forEach(e => {
      const branchId = userToBranchMap.get(e.user_id);
      // 如果没有通过 providers 表找到 branch_id，且角色是 branch，则用 user_id 本身作为 branch_id
      const effectiveBranchId = branchId || (e.role === 'branch' ? e.user_id : null);
      if (!effectiveBranchId) return;

      const balance = parseFloat(e.balance || '0');
      const existing = branchEnergyMap.get(effectiveBranchId) || { branch: 0, provider: 0, member: 0, total: 0 };

      if (e.role === 'provider') {
        existing.provider += balance;
        existing.total += balance;
      } else if (e.role === 'member') {
        existing.member += balance;
        existing.total += balance;
      }

      branchEnergyMap.set(effectiveBranchId, existing);
    });

    // 7. 查询创造的产品收益（通过订单统计）
    const orderStats = await query<{ 
      branch_id: string; 
      total_sales: string; 
      order_count: string;
    }>(
      `SELECT p.branch_id,
              COALESCE(SUM(o.amount), 0)::text as total_sales,
              COUNT(o.id)::text as order_count
       FROM orders o
       JOIN users u ON u.id = o.user_id
       JOIN providers p ON u.provider_id = p.user_id
       WHERE o.order_type = 'buy' AND o.status = 'completed'
       GROUP BY p.branch_id`
    );

    // 8. 查询每个服务网点的服务商详细数据
    const providerStats = await query<{
      branch_id: string;
      provider_id: string;
      provider_name: string;
      quota: string;
      used_quota: string;
      total_sales: string;
      member_count: string;
    }>(
      `SELECT 
        p.branch_id,
        p.user_id as provider_id,
        u.username as provider_name,
        p.quota,
        p.used_quota,
        p.total_sales,
        (SELECT COUNT(*) FROM users m WHERE m.provider_id = p.user_id AND m.role = 'member')::text as member_count
       FROM providers p
       JOIN users u ON p.user_id = u.id
       WHERE p.branch_id IS NOT NULL`
    );

    // 9. 查询服务商销售产品数量
    const providerProductStats = await query<{
      provider_id: string;
      sold_count: string;
      sold_amount: string;
    }>(
      `SELECT 
        p.provider_id,
        COUNT(o.id)::text as sold_count,
        COALESCE(SUM(o.amount), 0)::text as sold_amount
       FROM orders o
       JOIN user_products up ON o.user_product_id = up.id
       JOIN products p ON up.product_id = p.id
       WHERE o.order_type = 'buy' AND o.status = 'completed'
       GROUP BY p.provider_id`
    );

    // 10. 查询会员购买情况
    const memberPurchaseStats = await query<{
      provider_id: string;
      member_id: string;
      member_name: string;
      total_purchase: string;
      order_count: string;
    }>(
      `SELECT 
        u.provider_id,
        u.id as member_id,
        u.username as member_name,
        COALESCE(SUM(o.amount), 0)::text as total_purchase,
        COUNT(o.id)::text as order_count
       FROM users u
       LEFT JOIN orders o ON u.id = o.user_id AND o.order_type = 'buy' AND o.status = 'completed'
       WHERE u.role = 'member' AND u.provider_id IS NOT NULL
       GROUP BY u.id, u.provider_id, u.username`
    );

    // 构建统计数据映射
    const providerCountMap = new Map<string, number>();
    providerCounts.forEach(p => {
      providerCountMap.set(p.branch_id, parseInt(p.count));
    });

    const userCountMap = new Map<string, { providers: number; members: number }>();
    userCounts.forEach(u => {
      userCountMap.set(u.branch_id, {
        providers: parseInt(u.provider_count || '0'),
        members: parseInt(u.member_count || '0')
      });
    });

    const quotaRequestMap = new Map<string, number>();
    quotaRequests
      .filter(q => q.status === 'approved')
      .forEach(q => {
        const current = quotaRequestMap.get(q.requester_id) || 0;
        quotaRequestMap.set(q.requester_id, current + parseFloat(q.total_amount || '0'));
      });

    // 产品额度映射 - 从 quota_accounts 获取服务网点的算力账户余额
    const quotaBalanceMap = new Map<string, { 
      balance: number;    // 当前余额
      totalIn: number;    // 累计收入
    }>();
    
    branches.forEach(b => {
      const account = quotaAccountBalances.find(a => a.user_id === b.id);
      if (account) {
        quotaBalanceMap.set(b.id, {
          balance: parseFloat(account.balance || '0'),
          totalIn: parseFloat(account.total_in || '0'),
        });
      } else {
        quotaBalanceMap.set(b.id, { balance: 0, totalIn: 0 });
      }
    });

    const orderStatsMap = new Map<string, { total: number; count: number }>();
    orderStats.forEach(o => {
      orderStatsMap.set(o.branch_id, {
        total: parseFloat(o.total_sales || '0'),
        count: parseInt(o.order_count || '0')
      });
    });

    // 服务商统计数据映射
    const providerStatsMap = new Map<string, any[]>();
    providerStats.forEach(p => {
      const stats = {
        providerId: p.provider_id,
        providerName: p.provider_name,
        quota: parseFloat(p.quota || '0'),
        usedQuota: parseFloat(p.used_quota || '0'),
        availableQuota: parseFloat(p.quota || '0') - parseFloat(p.used_quota || '0'),
        totalSales: parseFloat(p.total_sales || '0'),
        memberCount: parseInt(p.member_count || '0'),
        soldProducts: 0,
        soldAmount: 0,
      };
      
      // 累加销售产品统计
      const productStats = providerProductStats.filter(ps => ps.provider_id === p.provider_id);
      productStats.forEach(ps => {
        stats.soldProducts += parseInt(ps.sold_count || '0');
        stats.soldAmount += parseFloat(ps.sold_amount || '0');
      });
      
      const existing = providerStatsMap.get(p.branch_id) || [];
      existing.push(stats);
      providerStatsMap.set(p.branch_id, existing);
    });

    // 会员购买统计映射
    const memberPurchaseMap = new Map<string, any[]>();
    memberPurchaseStats.forEach(m => {
      // 找到该会员所属的服务商
      for (const [branchId, providers] of providerStatsMap.entries()) {
        const provider = providers.find(p => p.providerId === m.provider_id);
        if (provider) {
          const existing = memberPurchaseMap.get(branchId) || [];
          existing.push({
            memberId: m.member_id,
            memberName: m.member_name,
            totalPurchase: parseFloat(m.total_purchase || '0'),
            orderCount: parseInt(m.order_count || '0'),
          });
          memberPurchaseMap.set(branchId, existing);
          break;
        }
      }
    });

    // 组合数据
    const branchData = branches.map(branch => {
      const providerCount = providerCountMap.get(branch.id) || 0;
      const userCount = userCountMap.get(branch.id) || { providers: 0, members: 0 };
      const quotaApproved = quotaRequestMap.get(branch.id) || 0;
      const quotaBalance = quotaBalanceMap.get(branch.id) || { balance: 0, totalIn: 0 };
      // 服务网点体系下所有收益（服务网点+服务商+会员）
      const energyStats = branchEnergyMap.get(branch.id) || { branch: 0, provider: 0, member: 0, total: 0 };
      const salesInfo = orderStatsMap.get(branch.id) || { total: 0, count: 0 };
      const providers = providerStatsMap.get(branch.id) || [];
      const members = memberPurchaseMap.get(branch.id) || [];

      // 计算服务商汇总数据
      const providerSummary = {
        totalQuota: providers.reduce((sum, p) => sum + p.quota, 0),
        usedQuota: providers.reduce((sum, p) => sum + p.usedQuota, 0),
        availableQuota: providers.reduce((sum, p) => sum + p.availableQuota, 0),
        totalSoldProducts: providers.reduce((sum, p) => sum + p.soldProducts, 0),
        totalSoldAmount: providers.reduce((sum, p) => sum + p.soldAmount, 0),
      };

      return {
        id: branch.id,
        name: branch.username,
        phone: branch.phone || '-',
        createdAt: branch.created_at,
        
        stats: {
          branchCount: 1,
          // 服务网点额度（从 quota_accounts 获取）
          quotaApplied: quotaApproved,
          quotaTotal: quotaBalance.totalIn,  // 累计收入 = 下发总额
          quotaUsed: quotaBalance.totalIn - quotaBalance.balance,  // 已分配 = 累计收入 - 当前余额
          quotaAvailable: quotaBalance.balance,  // 可用 = 当前余额
          // 服务商额度（从服务商汇总计算）
          providerQuotaTotal: providerSummary.totalQuota,
          providerQuotaUsed: providerSummary.usedQuota,
          providerQuotaAvailable: providerSummary.availableQuota,
          // 服务网点体系收益（服务网点+服务商+会员）
          energyBalance: energyStats.total,
          energyBranchBalance: energyStats.branch,
          energyProviderBalance: energyStats.provider,
          energyMemberBalance: energyStats.member,
          providerCount: providerCount,
          totalUserCount: userCount.providers + userCount.members,
          providerUserCount: userCount.providers,
          memberUserCount: userCount.members,
          energyQuota: energyStats.total,
          totalProductRevenue: salesInfo.total,
          productOrderCount: salesInfo.count,
          providerSummary,
        },

        // 如果需要包含服务商详情
        ...(includeProviders && {
          providers: providers,
          members: members,
        })
      };
    });

    // 计算汇总统计
    const summary = {
      totalBranches: branchData.length,
      totalQuotaApplied: branchData.reduce((sum, b) => sum + b.stats.quotaApplied, 0),
      // 所有服务网点体系收益总和（服务网点+服务商+会员）
      totalEnergyBalance: branchData.reduce((sum, b) => sum + b.stats.energyBalance, 0),
      totalEnergyBranchBalance: branchData.reduce((sum, b) => sum + (b.stats.energyBranchBalance || 0), 0),
      totalEnergyProviderBalance: branchData.reduce((sum, b) => sum + (b.stats.energyProviderBalance || 0), 0),
      totalEnergyMemberBalance: branchData.reduce((sum, b) => sum + (b.stats.energyMemberBalance || 0), 0),
      totalProviders: branchData.reduce((sum, b) => sum + b.stats.providerCount, 0),
      totalUsers: branchData.reduce((sum, b) => sum + b.stats.totalUserCount, 0),
      totalProductRevenue: branchData.reduce((sum, b) => sum + b.stats.totalProductRevenue, 0),
      // 服务网点总额度
      totalQuotaAvailable: branchData.reduce((sum, b) => sum + b.stats.quotaAvailable, 0),
      totalQuota: branchData.reduce((sum, b) => sum + b.stats.quotaTotal, 0),
      // 服务商分配总额度
      totalProviderQuota: branchData.reduce((sum, b) => sum + b.stats.providerQuotaTotal, 0),
      totalSoldProducts: branchData.reduce((sum, b) => sum + (b.stats.providerSummary?.totalSoldProducts || 0), 0),
    };

    return NextResponse.json({
      success: true,
      data: {
        branches: branchData,
        summary
      }
    });

  } catch (error: any) {
    console.error('获取服务网点管理数据失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
