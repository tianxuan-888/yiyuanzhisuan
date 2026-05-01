import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 分公司视角：能量值统计
// 支持使用 branchId 或 username 来查询
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    const username = searchParams.get('username');

    if (!branchId && !username) {
      return NextResponse.json(
        { success: false, error: '缺少branchId或username参数' },
        { status: 400 }
      );
    }

    // 验证是否为分公司
    let branch;
    if (username) {
      branch = await query('SELECT id, username, role FROM users WHERE username = $1 AND role = $2', [username, 'branch']);
    } else {
      branch = await query('SELECT id, username, role FROM users WHERE id = $1 AND role = $2', [branchId, 'branch']);
    }
    
    if (branch.length === 0) {
      return NextResponse.json(
        { success: false, error: '未找到分公司信息' },
        { status: 404 }
      );
    }

    const currentBranch = branch[0];
    const actualBranchId = currentBranch.id;
    
    // 从 energy_accounts 表获取分公司的能量值余额
    const branchAccount = await query(
      `SELECT balance FROM energy_accounts WHERE user_id::text = '${actualBranchId}'`,
      []
    );
    const branchBalance = branchAccount.length > 0 ? Number(branchAccount[0].balance || 0) : 0;

    // 下级服务商能量值分布 - 只查询属于当前分公司的服务商
    const providers = await query(
      `SELECT u.id, u.username, u.phone, 
              COALESCE((SELECT ea.balance FROM energy_accounts ea WHERE ea.user_id::text = u.id), 0) as balance
       FROM users u
       WHERE u.role = 'provider' AND u.branch_id = $1
       ORDER BY balance DESC
       LIMIT 50`,
      [actualBranchId]
    );

    // 下级服务商汇总
    const providerTotal = providers.reduce(
      (sum, p) => sum + Number(p.balance || 0),
      0
    );

    // 下级会员能量值分布
    const members = await query(
      `SELECT u.id, u.username, u.phone,
              COALESCE((SELECT ea.balance FROM energy_accounts ea WHERE ea.user_id::text = u.id), 0) as balance
       FROM users u
       WHERE u.role = 'member' AND u.provider_id IN (
         SELECT id FROM users WHERE role = 'provider' AND branch_id = $1
       )
       ORDER BY balance DESC
       LIMIT 50`,
      [actualBranchId]
    );

    // 下级会员汇总
    const memberTotal = members.reduce(
      (sum, m) => sum + Number(m.balance || 0),
      0
    );

    // 最近30天能量值变化趋势
    const trend = await query(
      `SELECT DATE(created_at) as date,
              SUM(CASE WHEN type IN ('transfer_in', 'create', 'recharge') THEN amount ELSE 0 END) as inflow,
              SUM(CASE WHEN type IN ('transfer_out', 'withdraw') THEN amount ELSE 0 END) as outflow
       FROM energy_transactions
       WHERE user_id::text = '${actualBranchId}' AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      []
    );

    // 已完成的转账总额（转出）
    const totalOutflow = await query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM energy_transactions 
       WHERE user_id::text = '${actualBranchId}' AND type IN ('transfer_out', 'withdraw')`,
      []
    );

    return NextResponse.json({
      success: true,
      data: {
        branch: {
          id: actualBranchId,
          username: currentBranch.username,
          balance: branchBalance,
        },
        providers: providers.map(p => ({
          id: p.id,
          username: p.username,
          phone: p.phone,
          balance: Number(p.balance || 0),
        })),
        members: members.map(m => ({
          id: m.id,
          username: m.username,
          phone: m.phone,
          balance: Number(m.balance || 0),
        })),
        stats: {
          providerCount: providers.length,
          memberCount: members.length,
          providerEnergy: providerTotal,
          memberEnergy: memberTotal,
          pendingRequests: 0,
          totalOutflow: Number(totalOutflow[0]?.total || 0),
        },
        trend: trend.map(t => ({
          date: t.date,
          inflow: Number(t.inflow || 0),
          outflow: Number(t.outflow || 0),
        })),
      },
    });
  } catch (error: any) {
    console.error('获取分公司能量值统计失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
