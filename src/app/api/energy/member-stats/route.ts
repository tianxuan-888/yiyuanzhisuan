import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 会员视角：能量值统计
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { success: false, error: '缺少userId参数' },
        { status: 400 }
      );
    }

    // 验证是否为会员
    const user = await query('SELECT * FROM users WHERE id = $1 AND role = $2', [userId, 'member']);
    if (user.length === 0) {
      return NextResponse.json(
        { success: false, error: '无效的用户ID' },
        { status: 400 }
      );
    }

    // 会员能量值账户
    const userAccount = await query(
      'SELECT * FROM energy_accounts WHERE user_id = $1',
      [userId]
    );
    let userBalance = userAccount.length > 0 ? Number(userAccount[0].balance || 0) : 0;
    // 兜底：如果 energy_accounts 无记录或 balance 为 0，从 users 表获取
    if (userBalance === 0) {
      const userInfo = await query('SELECT energy_value FROM users WHERE id = $1', [userId]);
      const ev = userInfo.length > 0 ? Number(userInfo[0].energy_value || 0) : 0;
      if (ev > 0) {
        userBalance = ev;
      }
    }
    const userTotalIn = userAccount.length > 0 ? Number(userAccount[0].total_in || 0) : 0;
    const userTotalOut = userAccount.length > 0 ? Number(userAccount[0].total_out || 0) : 0;

    // 最近30天能量值变化趋势
    const trend = await query(
      `SELECT DATE(created_at) as date,
              SUM(CASE WHEN from_user_id = $1 THEN amount ELSE 0 END) as outflow,
              SUM(CASE WHEN to_user_id = $1 THEN amount ELSE 0 END) as inflow
       FROM energy_transactions
       WHERE created_at >= NOW() - INTERVAL '30 days'
         AND (from_user_id = $1 OR to_user_id = $1)
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [userId]
    );

    // 累计充值
    const totalRecharge = await query(
      `SELECT SUM(amount) as total_recharge
       FROM energy_transactions
       WHERE type IN ('purchase', 'manual')
         AND to_user_id = $1`,
      [userId]
    );

    // 累计转入
    const totalTransferIn = await query(
      `SELECT SUM(amount) as total_transfer_in
       FROM energy_transactions
       WHERE type = 'market_transfer'
         AND to_user_id = $1`,
      [userId]
    );

    // 累计转出（支付市场费）
    const totalTransferOut = await query(
      `SELECT SUM(amount) as total_transfer_out
       FROM energy_transactions
       WHERE type = 'market_transfer'
         AND from_user_id = $1`,
      [userId]
    );

    // 最近充值记录
    const recentRecharge = await query(
      `SELECT et.*, fu.username as from_username
       FROM energy_transactions et
       LEFT JOIN users fu ON fu.id = et.from_user_id
       WHERE et.type IN ('purchase', 'manual')
         AND et.to_user_id = $1
       ORDER BY et.created_at DESC
       LIMIT 10`,
      [userId]
    );

    // 最近转入记录
    const recentTransferIn = await query(
      `SELECT et.*, fu.username as from_username, fu.role as from_role
       FROM energy_transactions et
       LEFT JOIN users fu ON fu.id = et.from_user_id
       WHERE et.type = 'market_transfer'
         AND et.to_user_id = $1
       ORDER BY et.created_at DESC
       LIMIT 10`,
      [userId]
    );

    // 最近转出记录（支付市场费）
    const recentTransferOut = await query(
      `SELECT et.*, tu.username as to_username, tu.role as to_role
       FROM energy_transactions et
       LEFT JOIN users tu ON tu.id = et.to_user_id
       WHERE et.type = 'market_transfer'
         AND et.from_user_id = $1
       ORDER BY et.created_at DESC
       LIMIT 10`,
      [userId]
    );

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: userId,
          username: user[0].username,
          balance: userBalance,
          totalIn: userTotalIn,
          totalOut: userTotalOut,
        },
        summary: {
          totalRecharge: Number(totalRecharge[0]?.total_recharge || 0),
          totalTransferIn: Number(totalTransferIn[0]?.total_transfer_in || 0),
          totalTransferOut: Number(totalTransferOut[0]?.total_transfer_out || 0),
        },
        trend: trend.map(t => ({
          date: t.date,
          outflow: Number(t.outflow),
          inflow: Number(t.inflow),
        })),
        recentRecharge: recentRecharge.map(r => ({
          id: r.id,
          type: r.type,
          amount: Number(r.amount),
          fromUsername: r.from_username,
          note: r.note,
          createdAt: r.created_at,
        })),
        recentTransferIn: recentTransferIn.map(r => ({
          id: r.id,
          amount: Number(r.amount),
          fromUsername: r.from_username,
          fromRole: r.from_role,
          note: r.note,
          createdAt: r.created_at,
        })),
        recentTransferOut: recentTransferOut.map(r => ({
          id: r.id,
          amount: Number(r.amount),
          toUsername: r.to_username,
          toRole: r.to_role,
          note: r.note,
          createdAt: r.created_at,
        })),
      },
    });
  } catch (error: any) {
    console.error('获取会员能量值统计失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
