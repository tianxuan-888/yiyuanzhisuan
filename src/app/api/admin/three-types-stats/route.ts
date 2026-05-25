import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取三类数据统一统计
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'all'; // all | users | quota | energy

    // ============ 第一类：用户账号体系统计 ============
    const userStats = {
      totalUsers: 0,
      byRole: {
        admin: 0,
        branch: 0,
        provider: 0,
        member: 0,
      },
      bindingRelations: {
        totalProviders: 0,
        totalMembers: 0,
        avgMembersPerProvider: 0,
      },
    };

    if (type === 'all' || type === 'users') {
      // 统计各角色用户数量
      const roleStats = await query<{ role: string; count: string }>(
        `SELECT role, COUNT(*)::text as count FROM users WHERE role IS NOT NULL GROUP BY role`
      );
      
      roleStats.forEach(r => {
        if (r.role === 'admin') userStats.byRole.admin = parseFloat(r.count);
        else if (r.role === 'branch') userStats.byRole.branch = parseFloat(r.count);
        else if (r.role === 'provider') userStats.byRole.provider = parseFloat(r.count);
        else if (r.role === 'member') userStats.byRole.member = parseFloat(r.count);
      });
      
      userStats.totalUsers = roleStats.reduce((sum, r) => sum + parseFloat(r.count), 0);

      // 绑定关系统计
      const providerCount = await query(`SELECT COUNT(*)::text as count FROM providers`);
      userStats.bindingRelations.totalProviders = parseFloat(providerCount[0]?.count || '0');

      const memberCount = await query(`SELECT COUNT(*)::text as count FROM users WHERE role = 'member'`);
      userStats.bindingRelations.totalMembers = parseFloat(memberCount[0]?.count || '0');

      if (userStats.bindingRelations.totalProviders > 0) {
        userStats.bindingRelations.avgMembersPerProvider = 
          userStats.bindingRelations.totalMembers / userStats.bindingRelations.totalProviders;
      }
    }

    // ============ 第二类：算力额度流转统计 ============
    const quotaStats = {
      // 额度生成
      companyQuota: {
        totalQuota: 0,
        usedQuota: 0,
        availableQuota: 0,
      },
      // 额度分配
      allocations: {
        toBranches: 0,        // 智算中心分配给服务网点
        toProviders: 0,       // 服务网点分配给服务商
        totalAllocated: 0,
      },
      // 服务商额度
      providerQuota: {
        total: 0,
        used: 0,
        available: 0,
      },
      // 产品统计
      products: {
        total: 0,
        available: 0,
        sold: 0,
        totalSalesAmount: 0,
      },
      // 用户持仓
      userHoldings: {
        totalHoldings: 0,
        totalMembers: 0,
        avgHoldingsPerMember: 0,
      },
    };

    if (type === 'all' || type === 'quota') {
      // 智算中心额度
      const companyQuotaData = await query(
        `SELECT total_quota, used_quota FROM company_quota LIMIT 1`
      );
      if (companyQuotaData.length > 0) {
        quotaStats.companyQuota.totalQuota = parseFloat(companyQuotaData[0]?.total_quota || '0');
        quotaStats.companyQuota.usedQuota = parseFloat(companyQuotaData[0]?.used_quota || '0');
        quotaStats.companyQuota.availableQuota = 
          quotaStats.companyQuota.totalQuota - quotaStats.companyQuota.usedQuota;
      }

      // 额度分配统计（区分智算中心→服务网点 和 服务网点→服务商）
      const allocationStats = await query<{ 
        branch_id: string; 
        provider_id: string; 
        quota_amount: string;
        used_amount: string;
      }>(
        `SELECT branch_id, provider_id, quota_amount, used_amount FROM quota_allocations`
      );
      
      allocationStats.forEach(a => {
        if (a.provider_id === null || a.provider_id === '') {
          // 智算中心分配给服务网点
          quotaStats.allocations.toBranches += parseFloat(a.quota_amount || '0');
        } else {
          // 服务网点分配给服务商
          quotaStats.allocations.toProviders += parseFloat(a.quota_amount || '0');
        }
      });
      quotaStats.allocations.totalAllocated = 
        quotaStats.allocations.toBranches + quotaStats.allocations.toProviders;

      // 服务商额度统计
      const providerQuotaData = await query<{ quota: string; used_quota: string }>(
        `SELECT quota, used_quota FROM providers`
      );
      providerQuotaData.forEach(p => {
        quotaStats.providerQuota.total += parseFloat(p.quota || '0');
        quotaStats.providerQuota.used += parseFloat(p.used_quota || '0');
      });
      quotaStats.providerQuota.available = 
        quotaStats.providerQuota.total - quotaStats.providerQuota.used;

      // 产品统计
      const productStats = await query<{ status: string; price: string }>(
        `SELECT status, price FROM products`
      );
      quotaStats.products.total = productStats.length;
      productStats.forEach(p => {
        if (p.status === 'available' || p.status === 'unlisted') {
          quotaStats.products.available += 1;
        } else if (p.status === 'sold') {
          quotaStats.products.sold += 1;
          quotaStats.products.totalSalesAmount += parseFloat(p.price || '0');
        }
      });

      // 用户持仓统计
      const holdingStats = await query<{ total: string; member_count: string }>(
        `SELECT 
          COUNT(*)::text as total,
          COUNT(DISTINCT user_id)::text as member_count
         FROM user_products WHERE status IN ('holding', 'pending_sell')`
      );
      if (holdingStats.length > 0) {
        quotaStats.userHoldings.totalHoldings = parseFloat(holdingStats[0]?.total || '0');
        quotaStats.userHoldings.totalMembers = parseFloat(holdingStats[0]?.member_count || '0');
        if (quotaStats.userHoldings.totalMembers > 0) {
          quotaStats.userHoldings.avgHoldingsPerMember = 
            quotaStats.userHoldings.totalHoldings / quotaStats.userHoldings.totalMembers;
        }
      }
    }

    // ============ 第三类：收益流转统计 ============
    const energyStats = {
      // 各角色收益持有
      holdings: {
        admin: 0,
        branch: 0,
        provider: 0,
        member: 0,
        total: 0,
      },
      // 收益来源统计
      sources: {
        create: 0,        // 智算中心创建
        quotaMatch: 0,   // 额度匹配下发
        purchase: 0,     // 服务网点购买
        transferIn: 0,  // 市场转入
        total: 0,
      },
      // 收益消耗统计
      consumption: {
        transferOut: 0,   // 市场转出
        withdraw: 0,      // 变现发放
        burn: 0,          // 销毁
        total: 0,
      },
      // 变现统计
      withdraw: {
        totalRequests: 0,
        pendingCount: 0,
        pendingAmount: 0,
        approvedAmount: 0,  // 实际发放
        totalBurn: 0,       // 销毁总量
        totalFee: 0,        // 手续费沉淀
      },
    };

    if (type === 'all' || type === 'energy') {
      // 各角色收益持有
      const energyHoldings = await query<{ role: string; balance: string }>(
        `SELECT u.role, COALESCE(ea.balance, 0)::text as balance
         FROM users u
         LEFT JOIN energy_accounts ea ON u.id = ea.user_id
         WHERE u.role IS NOT NULL`
      );
      
      energyHoldings.forEach(h => {
        const balance = parseFloat(h.balance || '0');
        if (h.role === 'admin') energyStats.holdings.admin = balance;
        else if (h.role === 'branch') energyStats.holdings.branch += balance;
        else if (h.role === 'provider') energyStats.holdings.provider += balance;
        else if (h.role === 'member') energyStats.holdings.member += balance;
        energyStats.holdings.total += balance;
      });

      // 收益来源统计
      const sourceStats = await query<{ type: string; total: string }>(
        `SELECT type, SUM(ABS(amount))::text as total 
         FROM energy_transactions 
         WHERE type IN ('create', 'quota_match', 'purchase', 'transfer_in')
         GROUP BY type`
      );
      
      sourceStats.forEach(s => {
        const amount = parseFloat(s.total || '0');
        if (s.type === 'create') energyStats.sources.create = amount;
        else if (s.type === 'quota_match') energyStats.sources.quotaMatch = amount;
        else if (s.type === 'purchase') energyStats.sources.purchase = amount;
        else if (s.type === 'transfer_in') energyStats.sources.transferIn = amount;
        energyStats.sources.total += amount;
      });

      // 收益消耗统计
      const consumptionStats = await query<{ type: string; total: string }>(
        `SELECT type, SUM(ABS(amount))::text as total 
         FROM energy_transactions 
         WHERE type IN ('transfer_out', 'withdraw', 'burn')
         GROUP BY type`
      );
      
      consumptionStats.forEach(c => {
        const amount = parseFloat(c.total || '0');
        if (c.type === 'transfer_out') energyStats.consumption.transferOut = amount;
        else if (c.type === 'withdraw') energyStats.consumption.withdraw = amount;
        else if (c.type === 'burn') energyStats.consumption.burn = amount;
        energyStats.consumption.total += amount;
      });

      // 变现申请统计
      const withdrawStats = await query<{ status: string; amount: string; actual_amount: string; count: string }>(
        `SELECT status, 
                SUM(amount)::text as amount,
                SUM(COALESCE(actual_amount, 0))::text as actual_amount,
                COUNT(*)::text as count
         FROM energy_withdraw_requests
         GROUP BY status`
      );
      
      withdrawStats.forEach(w => {
        const amt = parseFloat(w.amount || '0');
        const actualAmt = parseFloat(w.actual_amount || '0');
        
        if (w.status === 'pending') {
          energyStats.withdraw.pendingCount = parseFloat(w.count || '0');
          energyStats.withdraw.pendingAmount = amt;
        } else if (w.status === 'approved') {
          energyStats.withdraw.approvedAmount = actualAmt;  // 实际发放
          energyStats.withdraw.totalBurn = amt;             // 销毁 = 申请金额
          energyStats.withdraw.totalFee = amt - actualAmt;  // 手续费 = 申请 - 实发
        }
        energyStats.withdraw.totalRequests += parseFloat(w.count || '0');
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        // 第一类：用户账号体系
        users: userStats,
        // 第二类：算力额度流转
        quota: quotaStats,
        // 第三类：收益流转
        energy: energyStats,
        // 汇总
        summary: {
          totalUsers: userStats.totalUsers,
          totalQuota: quotaStats.companyQuota.totalQuota,
          totalEnergy: energyStats.holdings.total,
          totalProductsSold: quotaStats.products.sold,
          totalSalesAmount: quotaStats.products.totalSalesAmount,
        },
      },
    });

  } catch (error: any) {
    console.error('获取三类数据统计失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
