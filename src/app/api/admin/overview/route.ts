import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取智算总台数据总览统计
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'all';
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
      const products = await query<{
        id: string; status: string; price: number; period: number; updated_at: string; created_at: string;
      }>(`SELECT id, status, price, period, updated_at, created_at FROM products`);

      productStats.totalSold = products.filter(p => p.status === 'sold').length;
      productStats.idleCount = products.filter(p => p.status === 'available' || p.status === 'unlisted').length;
      productStats.totalSalesAmount = products
        .filter(p => p.status === 'sold')
        .reduce((sum, p) => sum + (p.price || 0), 0);

      const today = new Date().toISOString().split('T')[0];
      const todayProducts = products.filter(p => p.status === 'sold' && p.updated_at && p.updated_at.startsWith(today));
      productStats.todaySold = todayProducts.length;
      productStats.todaySalesAmount = todayProducts.reduce((sum, p) => sum + (p.price || 0), 0);

      const periodMap = new Map<number, { count: number; amount: number }>();
      products.filter(p => p.status === 'sold').forEach(p => {
        const existing = periodMap.get(p.period) || { count: 0, amount: 0 };
        periodMap.set(p.period, { count: existing.count + 1, amount: existing.amount + (p.price || 0) });
      });
      productStats.productsByPeriod = Array.from(periodMap.entries())
        .map(([period, data]) => ({ period, ...data }))
        .sort((a, b) => a.period - b.period);

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const recentOrders = await query<{ created_at: string; amount: number }>(
        `SELECT created_at, amount FROM orders WHERE order_type = 'buy' AND status = 'completed' AND created_at >= $1`,
        [sevenDaysAgo.toISOString()]
      );

      const orderMap = new Map<string, { count: number; amount: number }>();
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        orderMap.set(date.toISOString().split('T')[0], { count: 0, amount: 0 });
      }
      recentOrders.forEach(order => {
        const dateStr = order.created_at.split('T')[0];
        const existing = orderMap.get(dateStr);
        if (existing) { existing.count += 1; existing.amount += order.amount || 0; }
      });
      productStats.salesTrend = Array.from(orderMap.entries()).map(([date, data]) => ({ date, ...data }));
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
      const users = await query<{
        id: string; role: string; created_at: any; branch_id: string | null;
      }>(`SELECT id, role, created_at::text as created_at, branch_id FROM users`);

      userStats.totalUsers = users.length;
      userStats.totalMembers = users.filter(u => u.role === 'member').length;

      const today = new Date().toISOString().split('T')[0];
      userStats.todayNewUsers = users.filter(u => String(u.created_at || '').startsWith(today)).length;
      userStats.todayNewMembers = users.filter(u => u.role === 'member' && String(u.created_at || '').startsWith(today)).length;

      const roleMap = new Map<string, number>();
      users.forEach(u => { roleMap.set(u.role, (roleMap.get(u.role) || 0) + 1); });
      userStats.userDistribution.byRole = Object.fromEntries(roleMap);

      const branchMap = new Map<string, number>();
      users.forEach(u => { if (u.branch_id) branchMap.set(u.branch_id, (branchMap.get(u.branch_id) || 0) + 1); });
      userStats.userDistribution.byBranch = Object.fromEntries(branchMap);

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const recentUsers = users.filter(u => u.created_at && new Date(String(u.created_at)) >= sevenDaysAgo);
      const newUserMap = new Map<string, number>();
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        newUserMap.set(date.toISOString().split('T')[0], 0);
      }
      recentUsers.forEach(u => {
        const dateStr = String(u.created_at || '').split('T')[0];
        if (newUserMap.has(dateStr)) newUserMap.set(dateStr, (newUserMap.get(dateStr) || 0) + 1);
      });
      userStats.newUsersTrend = Array.from(newUserMap.entries()).map(([date, count]) => ({ date, count }));

      const recentOrders = await query<{ created_at: string; amount: number }>(
        `SELECT created_at, amount FROM orders WHERE order_type = 'buy' AND status = 'completed' AND created_at >= $1`,
        [sevenDaysAgo.toISOString()]
      );
      const purchaseMap = new Map<string, number>();
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        purchaseMap.set(date.toISOString().split('T')[0], 0);
      }
      recentOrders.forEach(order => {
        const dateStr = order.created_at.split('T')[0];
        if (purchaseMap.has(dateStr)) purchaseMap.set(dateStr, (purchaseMap.get(dateStr) || 0) + (order.amount || 0));
      });
      userStats.todayPurchaseAmount = purchaseMap.get(today) || 0;
      userStats.purchaseTrend = Array.from(purchaseMap.entries()).map(([date, amount]) => ({ date, amount }));
    }

    // ============ 收益数据统计（原能量值，改为基于balance） ============
    const balanceStats = {
      totalBalance: 0,
      todayBalanceChange: 0,
      balanceTrend: [] as { date: string; totalBalance: number; change: number }[],
      balanceDistribution: {
        byProvider: {} as Record<string, number>,
        byMember: {} as Record<string, number>,
        byBranch: {} as Record<string, number>,
        admin: 0,
        branch: 0,
        provider: 0,
        member: 0,
      },
      topBalanceUsers: [] as { userId: string; username: string; balance: number }[],
    };

    if (type === 'all' || type === 'energy') {
      // 直接从users表获取balance
      const usersWithBalance = await query<{
        id: string; username: string; role: string; balance: any;
      }>(`SELECT id, username, role, balance FROM users`);

      const balanceMap = new Map<string, number>();
      let branchBalance = 0, providerBalance = 0, memberBalance = 0, adminBalance = 0;

      usersWithBalance.forEach(u => {
        const bal = parseFloat(String(u.balance || '0')) || 0;
        balanceMap.set(u.id, bal);
        switch (u.role) {
          case 'admin': adminBalance += bal; break;
          case 'branch': branchBalance += bal; break;
          case 'provider': providerBalance += bal; break;
          case 'member': memberBalance += bal; break;
        }
      });

      balanceStats.totalBalance = adminBalance + branchBalance + providerBalance + memberBalance;
      balanceStats.balanceDistribution = {
        admin: adminBalance, branch: branchBalance, provider: providerBalance, member: memberBalance,
        byProvider: { total: providerBalance }, byMember: { total: memberBalance }, byBranch: { total: branchBalance },
      };

      // Top 10 收益用户
      balanceStats.topBalanceUsers = usersWithBalance
        .filter(u => (balanceMap.get(u.id) || 0) > 0)
        .map(u => ({ userId: u.id, username: u.username, balance: balanceMap.get(u.id) || 0 }))
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 10);

      // 近7天收益趋势（从release_records获取5%释放记录）
      const trendMap = new Map<string, number>();
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        trendMap.set(date.toISOString().split('T')[0], 0);
      }

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      try {
        const releaseRecords = await query<{ created_at: any; release_amount: number }>(
          `SELECT created_at::text as created_at, release_amount FROM release_records WHERE created_at >= $1`,
          [sevenDaysAgo.toISOString()]
        );
        if (releaseRecords && releaseRecords.length > 0) {
          releaseRecords.forEach(rr => {
            const dateStr = String(rr.created_at || '').split('T')[0];
            if (trendMap.has(dateStr)) trendMap.set(dateStr, (trendMap.get(dateStr) || 0) + (parseFloat(String(rr.release_amount)) || 0));
          });
        }
      } catch {
        // release_records表可能不存在
      }

      const today = new Date().toISOString().split('T')[0];
      balanceStats.todayBalanceChange = trendMap.get(today) || 0;

      balanceStats.balanceTrend = Array.from(trendMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, change]) => ({ date, totalBalance: balanceStats.totalBalance, change }));
    }

    return NextResponse.json({
      success: true,
      data: {
        product: productStats,
        user: userStats,
        energy: balanceStats, // 保持字段名兼容前端
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
