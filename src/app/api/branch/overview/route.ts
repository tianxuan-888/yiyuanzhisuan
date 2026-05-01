import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

// 获取分公司概览数据
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');

    if (!branchId) {
      return NextResponse.json(
        { success: false, error: '缺少分公司ID' },
        { status: 400 }
      );
    }

    // 查询分公司信息（从 energy_accounts 表获取能量值）
    const branch = await queryOne<{
      id: string;
      username: string;
      energy_value: string;
      energy_balance: string;
      balance: string;
      phone: string;
    }>(
      `SELECT u.id, u.username, u.energy_value, u.balance, u.phone,
              COALESCE(ea.balance, 0) as energy_balance
       FROM users u
       LEFT JOIN energy_accounts ea ON u.id::uuid = ea.user_id
       WHERE u.id = $1 AND u.role = 'branch'`,
      [branchId]
    );

    if (!branch) {
      return NextResponse.json(
        { success: false, error: '分公司不存在' },
        { status: 404 }
      );
    }

    // 查询该分公司的服务商（从 users 表）
    const providers = await query<{
      id: string;
      username: string;
      energy_value: string;
      balance: string;
      created_at: string;
    }>(
      `SELECT id, username, energy_value, balance, created_at 
       FROM users 
       WHERE role = 'provider' AND branch_id = $1`,
      [branchId]
    );

    const providerIds = providers.map(p => p.id);

    // 查询服务商名下的会员总数
    let totalMembers = 0;
    let totalMemberEnergy = 0;
    let totalMemberBalance = 0;

    if (providerIds.length > 0) {
      const members = await query<{
        energy_value: string;
        balance: string;
      }>(
        `SELECT energy_value, balance FROM users 
         WHERE provider_id = ANY($1) AND role = 'member'`,
        [providerIds]
      );
      
      totalMembers = members.length;
      totalMemberEnergy = members.reduce((sum, m) => sum + parseFloat(m.energy_value || '0'), 0);
      totalMemberBalance = members.reduce((sum, m) => sum + parseFloat(m.balance || '0'), 0);
    }

    // 查询待处理事项（待审核的卖出订单）
    const pendingSells = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM orders 
       WHERE order_type = 'sell' AND status = 'pending' 
       AND user_id IN (SELECT id FROM users WHERE provider_id = ANY($1))`,
      [providerIds.length > 0 ? providerIds : ['']]
    );

    // 查询待审核的提现申请
    const pendingWithdrawals = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM withdrawals WHERE status = 'pending'`
    );

    // 获取通知
    const notifications = await query(
      `SELECT * FROM notifications 
       WHERE receiver_id = $1 AND receiver_role = 'branch'
       ORDER BY created_at DESC LIMIT 20`,
      [branchId]
    );

    return NextResponse.json({
      success: true,
      data: {
        branch: {
          id: branch.id,
          username: branch.username,
          energy_value: branch.energy_value,
          energy_balance: Number(branch.energy_balance) || 0,
          balance: branch.balance,
          phone: branch.phone,
        },
        stats: {
          provider_count: providers.length,
          member_count: totalMembers,
          total_member_energy: totalMemberEnergy,
          total_member_balance: totalMemberBalance,
          pending_sell_count: parseInt(pendingSells?.[0]?.count || '0'),
          pending_withdrawal_count: parseInt(pendingWithdrawals?.[0]?.count || '0'),
        },
        providers: providers.map(p => ({
          id: p.id,
          username: p.username,
          energy_value: parseFloat(p.energy_value || '0'),
          balance: parseFloat(p.balance || '0'),
          created_at: p.created_at,
        })),
        notifications: notifications || [],
      },
    });
  } catch (error) {
    console.error('获取分公司概览失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '获取分公司概览失败' },
      { status: 500 }
    );
  }
}
