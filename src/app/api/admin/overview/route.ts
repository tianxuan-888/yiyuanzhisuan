import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

// 获取智算中心数据总览统计 - 优化版：使用SQL聚合替代全表查询
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'all';

    const promises: Record<string, any> = {};

    // ============ 产品数据统计 ============
    if (type === 'all' || type === 'product') {
      // 用SQL聚合一次查询获取所有产品统计
      promises.productBase = queryOne<{
        total_sold: string; idle_count: string; total_sales: string;
        today_sold: string; today_sales: string;
      }>(`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END), 0)::text as total_sold,
          COALESCE(SUM(CASE WHEN status IN ('available','unlisted') THEN 1 ELSE 0 END), 0)::text as idle_count,
          COALESCE(SUM(CASE WHEN status = 'sold' THEN price ELSE 0 END), 0)::text as total_sales,
          COALESCE(SUM(CASE WHEN status = 'sold' AND updated_at::date = CURRENT_DATE THEN 1 ELSE 0 END), 0)::text as today_sold,
          COALESCE(SUM(CASE WHEN status = 'sold' AND updated_at::date = CURRENT_DATE THEN price ELSE 0 END), 0)::text as today_sales
        FROM products
      `);

      // 按周期分布（仅已售出）
      promises.productsByPeriod = query<{ period: number; count: string; amount: string }>(`
        SELECT period,
          COUNT(*)::text as count,
          COALESCE(SUM(price), 0)::text as amount
        FROM products WHERE status = 'sold'
        GROUP BY period ORDER BY period
      `);

      // 近7天销售趋势
      promises.salesTrend = query<{ date: string; count: string; amount: string }>(`
        SELECT d.date::text,
          COALESCE(COUNT(o.id), 0)::text as count,
          COALESCE(SUM(o.amount), 0)::text as amount
        FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day') AS d(date)
        LEFT JOIN orders o ON o.order_type = 'buy' AND o.status = 'completed' AND o.created_at::date = d.date
        GROUP BY d.date ORDER BY d.date
      `);
    }

    // ============ 用户数据统计 ============
    if (type === 'all' || type === 'user') {
      // 用户基础统计 + 按角色分布
      promises.userBase = queryOne<{
        total_users: string; total_members: string;
        today_new_users: string; today_new_members: string;
      }>(`
        SELECT
          COUNT(*)::text as total_users,
          COALESCE(SUM(CASE WHEN role = 'member' THEN 1 ELSE 0 END), 0)::text as total_members,
          COALESCE(SUM(CASE WHEN created_at::date = CURRENT_DATE THEN 1 ELSE 0 END), 0)::text as today_new_users,
          COALESCE(SUM(CASE WHEN role = 'member' AND created_at::date = CURRENT_DATE THEN 1 ELSE 0 END), 0)::text as today_new_members
        FROM users
      `);

      // 角色分布
      promises.userByRole = query<{ role: string; count: string }>(`
        SELECT role, COUNT(*)::text as count FROM users GROUP BY role
      `);

      // 分公司分布
      promises.userByBranch = query<{ branch_id: string; count: string }>(`
        SELECT branch_id, COUNT(*)::text as count FROM users WHERE branch_id IS NOT NULL GROUP BY branch_id
      `);

      // 近7天新增用户趋势
      promises.newUsersTrend = query<{ date: string; count: string }>(`
        SELECT d.date::text,
          COALESCE(COUNT(u.id), 0)::text as count
        FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day') AS d(date)
        LEFT JOIN users u ON u.created_at::date = d.date
        GROUP BY d.date ORDER BY d.date
      `);

      // 今日购买金额 + 近7天购买趋势
      promises.purchaseTrend = query<{ date: string; amount: string }>(`
        SELECT d.date::text,
          COALESCE(SUM(o.amount), 0)::text as amount
        FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day') AS d(date)
        LEFT JOIN orders o ON o.order_type = 'buy' AND o.status = 'completed' AND o.created_at::date = d.date
        GROUP BY d.date ORDER BY d.date
      `);
    }

    // ============ 收益数据统计 ============
    if (type === 'all' || type === 'energy') {
      // 按角色聚合balance
      promises.balanceByRole = query<{ role: string; total: string }>(`
        SELECT role, COALESCE(SUM(balance), 0)::text as total FROM users GROUP BY role
      `);

      // Top 10 收益用户
      promises.topBalanceUsers = query<{ user_id: string; username: string; balance: string }>(`
        SELECT id as user_id, username, COALESCE(balance, 0)::text as balance
        FROM users WHERE balance > 0
        ORDER BY balance DESC LIMIT 10
      `);

      // 近7天收益趋势（从release_records获取）
      promises.balanceTrend = (async () => {
        try {
          return await query<{ date: string; change: string }>(`
            SELECT d.date::text,
              COALESCE(SUM(rr.release_amount), 0)::text as change
            FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day') AS d(date)
            LEFT JOIN release_records rr ON rr.created_at::date = d.date
            GROUP BY d.date ORDER BY d.date
          `);
        } catch {
          return [];
        }
      })();
    }

    // 并行执行所有查询
    const results = await Promise.all(
      Object.entries(promises).map(([key, promise]) =>
        Promise.resolve(promise).then(value => ({ key, value }))
      )
    );

    // 汇总结果
    const data: Record<string, any> = {};
    for (const { key, value } of results) {
      data[key] = value;
    }

    // 构建产品统计
    const productStats = {
      totalSold: 0, idleCount: 0, totalSalesAmount: 0,
      todaySold: 0, todaySalesAmount: 0,
      productsByPeriod: [] as { period: number; count: number; amount: number }[],
      salesTrend: [] as { date: string; count: number; amount: number }[],
    };
    if (data.productBase) {
      productStats.totalSold = parseInt(data.productBase.total_sold) || 0;
      productStats.idleCount = parseInt(data.productBase.idle_count) || 0;
      productStats.totalSalesAmount = parseFloat(data.productBase.total_sales) || 0;
      productStats.todaySold = parseInt(data.productBase.today_sold) || 0;
      productStats.todaySalesAmount = parseFloat(data.productBase.today_sales) || 0;
    }
    if (data.productsByPeriod) {
      productStats.productsByPeriod = data.productsByPeriod.map((p: any) => ({
        period: p.period, count: parseInt(p.count), amount: parseFloat(p.amount),
      }));
    }
    if (data.salesTrend) {
      productStats.salesTrend = data.salesTrend.map((s: any) => ({
        date: s.date, count: parseInt(s.count), amount: parseFloat(s.amount),
      }));
    }

    // 构建用户统计
    const userStats = {
      totalUsers: 0, totalMembers: 0,
      todayNewUsers: 0, todayNewMembers: 0, todayPurchaseAmount: 0,
      newUsersTrend: [] as { date: string; count: number }[],
      purchaseTrend: [] as { date: string; amount: number }[],
      userDistribution: {
        byRole: {} as Record<string, number>,
        byBranch: {} as Record<string, number>,
      },
    };
    if (data.userBase) {
      userStats.totalUsers = parseInt(data.userBase.total_users) || 0;
      userStats.totalMembers = parseInt(data.userBase.total_members) || 0;
      userStats.todayNewUsers = parseInt(data.userBase.today_new_users) || 0;
      userStats.todayNewMembers = parseInt(data.userBase.today_new_members) || 0;
    }
    if (data.userByRole) {
      data.userByRole.forEach((r: any) => {
        userStats.userDistribution.byRole[r.role] = parseInt(r.count);
      });
    }
    if (data.userByBranch) {
      data.userByBranch.forEach((b: any) => {
        userStats.userDistribution.byBranch[b.branch_id] = parseInt(b.count);
      });
    }
    if (data.newUsersTrend) {
      userStats.newUsersTrend = data.newUsersTrend.map((u: any) => ({
        date: u.date, count: parseInt(u.count),
      }));
    }
    if (data.purchaseTrend) {
      userStats.purchaseTrend = data.purchaseTrend.map((p: any) => ({
        date: p.date, amount: parseFloat(p.amount),
      }));
      // 今日购买金额
      const today = new Date().toISOString().split('T')[0];
      const todayData = data.purchaseTrend.find((p: any) => p.date === today);
      userStats.todayPurchaseAmount = todayData ? parseFloat(todayData.amount) : 0;
    }

    // 构建收益统计
    const balanceStats = {
      totalBalance: 0,
      todayBalanceChange: 0,
      balanceTrend: [] as { date: string; totalBalance: number; change: number }[],
      balanceDistribution: {
        byProvider: {} as Record<string, number>,
        byMember: {} as Record<string, number>,
        byBranch: {} as Record<string, number>,
        admin: 0, branch: 0, provider: 0, member: 0,
      },
      topBalanceUsers: [] as { userId: string; username: string; balance: number }[],
    };
    if (data.balanceByRole) {
      let totalBalance = 0;
      data.balanceByRole.forEach((r: any) => {
        const val = parseFloat(r.total) || 0;
        totalBalance += val;
        switch (r.role) {
          case 'admin': balanceStats.balanceDistribution.admin = val; break;
          case 'branch': balanceStats.balanceDistribution.branch = val; break;
          case 'provider': balanceStats.balanceDistribution.provider = val; break;
          case 'member': balanceStats.balanceDistribution.member = val; break;
        }
      });
      balanceStats.totalBalance = totalBalance;
      balanceStats.balanceDistribution.byProvider = { total: balanceStats.balanceDistribution.provider };
      balanceStats.balanceDistribution.byMember = { total: balanceStats.balanceDistribution.member };
      balanceStats.balanceDistribution.byBranch = { total: balanceStats.balanceDistribution.branch };
    }
    if (data.topBalanceUsers) {
      balanceStats.topBalanceUsers = data.topBalanceUsers.map((u: any) => ({
        userId: u.user_id, username: u.username, balance: parseFloat(u.balance),
      }));
    }
    if (data.balanceTrend && data.balanceTrend.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      const todayTrend = data.balanceTrend.find((t: any) => t.date === today);
      balanceStats.todayBalanceChange = todayTrend ? parseFloat(todayTrend.change) : 0;

      balanceStats.balanceTrend = data.balanceTrend.map((t: any) => ({
        date: t.date,
        totalBalance: balanceStats.totalBalance,
        change: parseFloat(t.change),
      }));
    }

    return NextResponse.json({
      success: true,
      data: {
        product: productStats,
        user: userStats,
        energy: balanceStats,
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
