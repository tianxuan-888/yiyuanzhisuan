import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 服务商视角：收益统计
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: '缺少providerId参数' },
        { status: 400 }
      );
    }

    // 验证是否为服务商
    const provider = await query('SELECT * FROM users WHERE id = $1 AND role = $2', [providerId, 'provider']);
    if (provider.length === 0) {
      return NextResponse.json(
        { success: false, error: '无效的服务商ID' },
        { status: 400 }
      );
    }

    // 服务商收益账户
    const providerAccount = await query(
      'SELECT * FROM energy_accounts WHERE user_id = $1',
      [providerId]
    );
    const providerBalance = providerAccount.length > 0 ? Number(providerAccount[0].balance || 0) : 0;
    const providerTotalIn = providerAccount.length > 0 ? Number(providerAccount[0].total_in || 0) : 0;
    const providerTotalOut = providerAccount.length > 0 ? Number(providerAccount[0].total_out || 0) : 0;

    // 下级会员收益分布
    const members = await query(
      `SELECT u.id, u.username, u.phone, 
              COALESCE(ea.balance, 0) as balance,
              COALESCE(ea.total_in, 0) as total_in,
              COALESCE(ea.total_out, 0) as total_out
       FROM users u
       LEFT JOIN energy_accounts ea ON u.id = ea.user_id
       WHERE u.role = 'member'
       ORDER BY COALESCE(ea.balance, 0) DESC
       LIMIT 50`
    );

    // 下级会员汇总
    const memberTotal = members.reduce(
      (sum, m) => sum + Number(m.balance || 0),
      0
    );

    // 最近30天收益变化趋势
    const trend = await query(
      `SELECT DATE(created_at) as date,
              SUM(CASE WHEN from_user_id = $1 THEN amount ELSE 0 END) as outflow,
              SUM(CASE WHEN to_user_id = $1 THEN amount ELSE 0 END) as inflow
       FROM energy_transactions
       WHERE created_at >= NOW() - INTERVAL '30 days'
         AND (from_user_id = $1 OR to_user_id = $1)
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [providerId]
    );

    // 最近30天收益统计
    const incomeStats = await query(
      `SELECT DATE(created_at) as date,
              SUM(amount) as total_income,
              COUNT(*) as transaction_count
       FROM energy_transactions
       WHERE type = 'market_transfer'
         AND to_user_id = $1
         AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [providerId]
    );

    // 累计收益
    const totalIncome = await query(
      `SELECT SUM(amount) as total_income
       FROM energy_transactions
       WHERE type = 'market_transfer' AND to_user_id = $1`,
      [providerId]
    );

    // 最近充值记录
    const recentRecharge = await query(
      `SELECT * FROM energy_transactions
       WHERE type IN ('purchase', 'manual')
         AND to_user_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [providerId]
    );

    // 最近收益记录
    const recentIncome = await query(
      `SELECT * FROM energy_transactions
       WHERE type = 'market_transfer'
         AND to_user_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [providerId]
    );

    return NextResponse.json({
      success: true,
      data: {
        provider: {
          id: providerId,
          username: provider[0].username,
          balance: providerBalance,
          totalIn: providerTotalIn,
          totalOut: providerTotalOut,
        },
        members: members.map(m => ({
          id: m.id,
          username: m.username,
          phone: m.phone,
          balance: Number(m.balance || 0),
          totalIn: Number(m.total_in || 0),
          totalOut: Number(m.total_out || 0),
        })),
        memberTotal,
        trend: trend.map(t => ({
          date: t.date,
          outflow: Number(t.outflow),
          inflow: Number(t.inflow),
        })),
        incomeStats: incomeStats.map(s => ({
          date: s.date,
          totalIncome: Number(s.total_income),
          transactionCount: parseInt(s.transaction_count),
        })),
        totalIncome: Number(totalIncome[0]?.total_income || 0),
        recentRecharge,
        recentIncome,
      },
    });
  } catch (error: any) {
    console.error('获取服务商收益统计失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
