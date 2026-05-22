import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 获取会员详细记录（购买记录、收益流水、持仓信息）
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ success: false, error: '未登录，请先登录' }, { status: 401 });
    }

    if (authUser.role !== 'admin') {
      return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ success: false, error: '缺少userId参数' }, { status: 400 });
    }

    // 1. 获取用户基本信息
    const userRows = await query<any>(`
      SELECT 
        u.id, u.username, u.phone, u.role, u.balance,
        u.is_active, u.created_at, u.provider_id, u.inviter_id, u.branch_id,
        br.username as branch_name, pr.username as provider_name
      FROM users u
      LEFT JOIN users br ON u.branch_id = br.id
      LEFT JOIN users pr ON u.provider_id = pr.id
      WHERE u.id = $1
    `, [userId]);

    if (!userRows || userRows.length === 0) {
      return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
    }

    const user = userRows[0];

    // 2. 获取持仓信息
    const holdings = await query<any>(`
      SELECT 
        up.id, up.purchase_price, up.purchase_date, up.expire_date,
        up.expected_profit, up.market_fee, up.status,
        p.name as product_name, p.code as product_code, p.period, p.price as product_price
      FROM user_products up
      LEFT JOIN products p ON up.product_id = p.id
      WHERE up.user_id = $1
      ORDER BY up.purchase_date DESC
    `, [userId]);

    // 3. 获取订单记录
    const orders = await query<any>(`
      SELECT id, user_product_id, order_type, amount, status, created_at
      FROM orders
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [userId]);

    // 4. 获取收益流水
    const energyRecords = await query<any>(`
      SELECT id, type, amount, from_user_id, to_user_id, created_at, note
      FROM energy_transactions
      WHERE from_user_id = $1 OR to_user_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [userId]);

    // 5. 汇总统计（从 orders 表统计购买/卖出次数和金额）
    const statsRows = await query<any>(`
      SELECT 
        COALESCE(SUM(CASE WHEN order_type = 'buy' AND status = 'completed' THEN amount ELSE 0 END), 0) as total_purchase,
        COALESCE(SUM(CASE WHEN order_type = 'sell' AND status = 'completed' THEN amount ELSE 0 END), 0) as total_sell,
        COALESCE(COUNT(CASE WHEN order_type = 'buy' THEN 1 END), 0) as buy_count,
        COALESCE(COUNT(CASE WHEN order_type = 'sell' THEN 1 END), 0) as sell_count
      FROM orders
      WHERE user_id = $1
    `, [userId]);

    // 从 user_products 表统计持有数
    const holdingRows = await query<any>(`
      SELECT 
        COALESCE(COUNT(CASE WHEN status = 'holding' THEN 1 END), 0) as holding_count
      FROM user_products
      WHERE user_id = $1
    `, [userId]);

    // 获取收益账户信息
    const energyAccountRows = await query<any>(`
      SELECT balance, total_in, total_out
      FROM energy_accounts
      WHERE user_id = $1
    `, [userId]);

    const stats = statsRows?.[0] || {};
    const holdingCount = holdingRows?.[0]?.holding_count || 0;
    const energyAccount = energyAccountRows?.[0] || { balance: 0, total_in: 0, total_out: 0 };

    // 解析 numeric 类型
    const parseNum = (v: unknown): number => {
      if (!v) return 0;
      if (typeof v === 'number') return v;
      const n = Number(v);
      return isNaN(n) ? 0 : n;
    };

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          phone: user.phone,
          role: user.role,
          
          balance: parseNum(user.balance),
          isActive: user.is_active,
          createdAt: user.created_at,
          branchName: user.branch_name || '-',
          providerName: user.provider_name || '-',
        },
        holdings: (holdings || []).map((h: any) => ({
          id: h.id,
          productName: h.product_name || '-',
          productCode: h.product_code || '-',
          purchasePrice: parseNum(h.purchase_price),
          productPrice: parseNum(h.product_price),
          period: h.period,
          purchaseDate: h.purchase_date,
          expireDate: h.expire_date,
          expectedProfit: parseNum(h.expected_profit),
          marketFee: parseNum(h.market_fee),
          status: h.status,
        })),
        orders: (orders || []).map((o: any) => ({
          id: o.id,
          orderType: o.order_type,
          amount: parseNum(o.amount),
          status: o.status,
          createdAt: o.created_at,
        })),
        energyRecords: (energyRecords || []).map((e: any) => ({
          id: e.id,
          type: e.type,
          amount: parseNum(e.amount),
          fromUserId: e.from_user_id,
          toUserId: e.to_user_id,
          createdAt: e.created_at,
          note: e.note,
        })),
        stats: {
          totalPurchase: parseNum(stats.total_purchase),
          totalSell: parseNum(stats.total_sell),
          buyCount: parseNum(stats.buy_count),
          sellCount: parseNum(stats.sell_count),
          holdingCount: parseNum(holdingCount),
          energyBalance: parseNum(energyAccount.balance),
          energyTotalIn: parseNum(energyAccount.total_in),
          energyTotalOut: parseNum(energyAccount.total_out),
        },
      },
    });

  } catch (error) {
    console.error('获取会员详情失败:', error);
    return NextResponse.json({ success: false, error: '获取会员详情失败' }, { status: 500 });
  }
}
