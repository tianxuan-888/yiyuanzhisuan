import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取智算总台数据总览统计
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'all'; // product | user | energy | all
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // ============ 产品数据统计 ============
    const productStats = {
      totalSold: 0,
      idleCount: 0,
      totalSalesAmount: 0,
      todaySold: 0,
      todaySalesAmount: 0,
      productsByPeriod: [] as { period: number; count: number; amount: number }[],
      salesTrend: [] as { date: string; count: number; amount: number }[],
    };

    if (type === 'all' || type === 'product') {
      // 查询产品数据
      const products = await query<{
        id: string;
        status: string;
        price: number;
        period: number;
        updated_at: string;
        created_at: string;
      }>(`SELECT id, status, price, period, updated_at, created_at FROM products`);

      // 统计已售出
      productStats.totalSold = products.filter(p => p.status === 'sold').length;
      // 统计闲置
      productStats.idleCount = products.filter(p => p.status === 'available' || p.status === 'unlisted').length;
      // 统计总销售额
      productStats.totalSalesAmount = products
        .filter(p => p.status === 'sold')
        .reduce((sum, p) => sum + (p.price || 0), 0);

      // 今日统计
      const today = new Date().toISOString().split('T')[0];
      const todayProducts = products.filter(p =>
        p.status === 'sold' &&
        p.updated_at &&
        p.updated_at.startsWith(today)
      );
      productStats.todaySold = todayProducts.length;
      productStats.todaySalesAmount = todayProducts.reduce((sum, p) => sum + (p.price || 0), 0);

      // 按周期分组统计
      const periodMap = new Map<number, { count: number; amount: number }>();
      products.filter(p => p.status === 'sold').forEach(p => {
        const existing = periodMap.get(p.period) || { count: 0, amount: 0 };
        periodMap.set(p.period, {
          count: existing.count + 1,
          amount: existing.amount + (p.price || 0),
        });
      });
      productStats.productsByPeriod = Array.from(periodMap.entries())
        .map(([period, data]) => ({ period, ...data }))
        .sort((a, b) => a.period - b.period);

      // 近7天销售趋势
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const recentOrders = await query<{ created_at: string; amount: number }>(
        `SELECT created_at, amount FROM orders 
         WHERE order_type = 'buy' AND status = 'completed' 
         AND created_at >= $1`,
        [sevenDaysAgo.toISOString()]
      );

      // 按日期分组
      const orderMap = new Map<string, { count: number; amount: number }>();
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        orderMap.set(dateStr, { count: 0, amount: 0 });
      }
      recentOrders.forEach(order => {
        const dateStr = order.created_at.split('T')[0];
        const existing = orderMap.get(dateStr);
        if (existing) {
          existing.count += 1;
          existing.amount += order.amount || 0;
        }
      });
      productStats.salesTrend = Array.from(orderMap.entries())
        .map(([date, data]) => ({ date, ...data }));
    }

    // ============ 用户数据统计 ============
    const userStats = {
      totalUsers: 0,
      totalMembers: 0,
      todayNewUsers: 0,
      todayNewMembers: 0,
      todayPurchaseAmount: 0,
      newUsersTrend: [] as { date: string; count: number }[],
      purchaseTrend: [] as { date: string; amount: number }[],
      userDistribution: {
        byRole: {} as Record<string, number>,
        byBranch: {} as Record<string, number>,
      },
    };

    if (type === 'all' || type === 'user') {
      // 查询用户数据
      const users = await query<{
        id: string;
        role: string;
        created_at: any;
        branch_id: string | null;
      }>(`SELECT id, role, created_at::text as created_at, branch_id FROM users`);

      userStats.totalUsers = users.length;
      userStats.totalMembers = users.filter(u => u.role === 'member').length;

      // 今日新增
      const today = new Date().toISOString().split('T')[0];
      userStats.todayNewUsers = users.filter(u => {
        const createdAt = String(u.created_at || '');
        return createdAt.startsWith(today);
      }).length;
      userStats.todayNewMembers = users.filter(u =>
        u.role === 'member' && String(u.created_at || '').startsWith(today)
      ).length;

      // 按角色分布
      const roleMap = new Map<string, number>();
      users.forEach(u => {
        const count = roleMap.get(u.role) || 0;
        roleMap.set(u.role, count + 1);
      });
      userStats.userDistribution.byRole = Object.fromEntries(roleMap);

      // 按服务网点分布
      const branchMap = new Map<string, number>();
      users.forEach(u => {
        if (u.branch_id) {
          const count = branchMap.get(u.branch_id) || 0;
          branchMap.set(u.branch_id, count + 1);
        }
      });
      userStats.userDistribution.byBranch = Object.fromEntries(branchMap);

      // 近7天新增用户趋势
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const recentUsers = users.filter(u => {
        const createdAt = String(u.created_at || '');
        return createdAt && new Date(createdAt) >= sevenDaysAgo;
      });
      const newUserMap = new Map<string, number>();
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        newUserMap.set(dateStr, 0);
      }
      recentUsers.forEach(u => {
        const dateStr = String(u.created_at || '').split('T')[0];
        const existing = newUserMap.get(dateStr);
        if (existing !== undefined) {
          newUserMap.set(dateStr, existing + 1);
        }
      });
      userStats.newUsersTrend = Array.from(newUserMap.entries())
        .map(([date, count]) => ({ date, count }));

      // 近7天购买金额趋势
      const recentOrders = await query<{ created_at: string; amount: number }>(
        `SELECT created_at, amount FROM orders 
         WHERE order_type = 'buy' AND status = 'completed' 
         AND created_at >= $1`,
        [sevenDaysAgo.toISOString()]
      );

      const purchaseMap = new Map<string, number>();
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        purchaseMap.set(dateStr, 0);
      }
      recentOrders.forEach(order => {
        const dateStr = order.created_at.split('T')[0];
        const existing = purchaseMap.get(dateStr);
        if (existing !== undefined) {
          purchaseMap.set(dateStr, existing + (order.amount || 0));
        }
      });
      userStats.todayPurchaseAmount = purchaseMap.get(today) || 0;
      userStats.purchaseTrend = Array.from(purchaseMap.entries())
        .map(([date, amount]) => ({ date, amount }));
    }

    // ============ 能力值数据统计 ============
    const energyStats = {
      totalEnergy: 0,
      todayEnergyChange: 0,
      energyTrend: [] as { date: string; totalEnergy: number; change: number }[],
      energyDistribution: {
        byProvider: {} as Record<string, number>,
        byMember: {} as Record<string, number>,
        byBranch: {} as Record<string, number>,
        admin: 0,
        branch: 0,
        provider: 0,
        member: 0,
      },
      topEnergyUsers: [] as { userId: string; username: string; energyValue: number }[],
    };

    if (type === 'all' || type === 'energy') {
      // 从 energy_accounts 表获取所有用户的收益数据
      const energyAccounts = await query<{
        user_id: string;
        balance: string;
      }>(`SELECT user_id, balance FROM energy_accounts`);

      // 建立用户ID到收益的映射
      const energyMap = new Map<string, number>();
      energyAccounts.forEach(ea => {
        energyMap.set(ea.user_id, parseFloat(ea.balance) || 0);
      });

      // 获取所有用户信息
      const users = await query<{
        id: string;
        username: string;
        role: string;
        created_at: string;
      }>(`SELECT id, username, role, created_at FROM users`);

      // 统计各类收益
      let branchEnergyTotal = 0;
      let providerEnergyTotal = 0;
      let memberEnergyTotal = 0;
      let adminEnergy = 0;

      users.forEach(u => {
        const energy = energyMap.get(u.id) || 0;

        switch (u.role) {
          case 'branch':
            branchEnergyTotal += energy;
            break;
          case 'provider':
            providerEnergyTotal += energy;
            break;
          case 'member':
            memberEnergyTotal += energy;
            break;
          case 'admin':
            adminEnergy = energy;
            break;
        }
      });

      // 能力值总额 = 服务网点 + 服务商 + 会员 + 智算总台收益
      energyStats.totalEnergy = branchEnergyTotal + providerEnergyTotal + memberEnergyTotal + adminEnergy;
      energyStats.energyDistribution.admin = adminEnergy;
      energyStats.energyDistribution.branch = branchEnergyTotal;
      energyStats.energyDistribution.provider = providerEnergyTotal;
      energyStats.energyDistribution.member = memberEnergyTotal;

      // 按角色分布
      energyStats.energyDistribution.byProvider = { total: providerEnergyTotal };
      energyStats.energyDistribution.byMember = { total: memberEnergyTotal };

      // Top 10 收益用户
      energyStats.topEnergyUsers = users
        .filter(u => (energyMap.get(u.id) || 0) > 0)
        .map(u => ({
          userId: u.id,
          username: u.username,
          energyValue: energyMap.get(u.id) || 0,
        }))
        .sort((a, b) => b.energyValue - a.energyValue)
        .slice(0, 10);

      // 近7天收益趋势
      const trendMap = new Map<string, number>();
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        trendMap.set(dateStr, 0);
      }

      // 查询收益交易记录
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const energyTransactions = await query<{
        created_at: any;
        amount: number;
        type: string;
      }>(
        `SELECT created_at::text as created_at, amount, type FROM energy_transactions 
         WHERE created_at >= $1`,
        [sevenDaysAgo.toISOString()]
      );

      // 计算每日收益变化
      if (energyTransactions && energyTransactions.length > 0) {
        energyTransactions.forEach(tx => {
          const dateStr = tx.created_at.split('T')[0];
          const existing = trendMap.get(dateStr);
          if (existing !== undefined) {
            const change = tx.type === 'transfer_out' ? -tx.amount : tx.amount;
            trendMap.set(dateStr, existing + change);
          }
        });

        // 今日收益变化
        const today = new Date().toISOString().split('T')[0];
        energyStats.todayEnergyChange = trendMap.get(today) || 0;
      }

      // 生成趋势数据
      energyStats.energyTrend = Array.from(trendMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, change]) => ({
          date,
          totalEnergy: energyStats.totalEnergy,
          change
        }));
    }

    return NextResponse.json({
      success: true,
      data: {
        product: productStats,
        user: userStats,
        energy: energyStats,
      },
    });
  } catch (error) {
    console.error('获取数据总览失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取数据失败' },
      { status: 500 }
    );
  }
}
