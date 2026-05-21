import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取能量值总览（五大板块统计）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // quota_match, purchase, market, withdraw, all

    // 板块1：算力额度比例匹配能量值（智算总台→服务网点）
    const quotaMatchRecords = await query(
      `SELECT et.*, 
              fu.username as from_username,
              tu.username as to_username
       FROM energy_transactions et
       LEFT JOIN users fu ON fu.id = et.from_user_id
       LEFT JOIN users tu ON tu.id = et.to_user_id
       WHERE et.type = 'quota_match'
       ORDER BY et.created_at DESC
       LIMIT 100`
    );
    const quotaMatchTotal = quotaMatchRecords.reduce((sum, r) => sum + Number(r.amount), 0);

    // 板块2：能量值购买记录（服务网点→智算总台）
    const purchaseRecords = await query(
      `SELECT et.*, 
              fu.username as from_username,
              tu.username as to_username
       FROM energy_transactions et
       LEFT JOIN users fu ON fu.id = et.from_user_id
       LEFT JOIN users tu ON tu.id = et.to_user_id
       WHERE et.type = 'purchase'
       ORDER BY et.created_at DESC
       LIMIT 100`
    );
    const purchaseTotal = purchaseRecords.reduce((sum, r) => sum + Number(r.amount), 0);

    // 板块3：服务商/会员能量值分布
    const marketAccounts = await query(
      `SELECT ea.*, u.username, u.role
       FROM energy_accounts ea
       JOIN users u ON u.id = ea.user_id
       WHERE u.role IN ('provider', 'member')
       ORDER BY ea.balance DESC
       LIMIT 100`
    );
    const marketTotal = marketAccounts.reduce((sum, a) => sum + Number(a.balance || 0), 0);

    // 板块4：市场内流转记录（会员↔服务商↔服务网点）
    const marketTransferRecords = await query(
      `SELECT et.*, 
              fu.username as from_username, fu.role as from_role,
              tu.username as to_username, tu.role as to_role
       FROM energy_transactions et
       LEFT JOIN users fu ON fu.id = et.from_user_id
       LEFT JOIN users tu ON tu.id = et.to_user_id
       WHERE et.type = 'market_transfer'
       ORDER BY et.created_at DESC
       LIMIT 100`
    );
    const marketTransferTotal = marketTransferRecords.reduce((sum, r) => sum + Number(r.amount), 0);

    // 板块5：服务网点向智算总台提现/变现能量值（包含 burn + withdraw 流水）
    const withdrawAndBurnRecords = await query(
      `SELECT et.*, 
              fu.username as from_username,
              tu.username as to_username
       FROM energy_transactions et
       LEFT JOIN users fu ON fu.id = et.from_user_id
       LEFT JOIN users tu ON tu.id = et.to_user_id
       WHERE et.type IN ('withdraw', 'burn')
       ORDER BY et.created_at DESC
       LIMIT 100`
    );
    const withdrawTotal = withdrawAndBurnRecords.reduce((sum, r) => sum + Number(r.amount), 0);

    // 获取变现申请统计数据
    const withdrawStats = await query(
      `SELECT status, SUM(actual_amount) as total_actual, SUM(amount) as total_amount, COUNT(*) as count
       FROM energy_withdraw_requests
       GROUP BY status`
    );

    let withdrawPendingCount = 0;
    let withdrawPendingAmount = 0;
    let withdrawApprovedAmount = 0; // 实际到账金额
    let burnAmount = 0; // 销毁金额（用户申请变现时扣除的总能量值）
    let feeAmount = 0; // 手续费（沉淀）

    withdrawStats.forEach((r: any) => {
      if (r.status === 'pending') {
        withdrawPendingCount = parseInt(r.count || 0);
        withdrawPendingAmount = parseFloat(r.total_amount || 0);
      } else if (r.status === 'approved') {
        const actualAmount = parseFloat(r.total_actual || 0);
        const totalAmount = parseFloat(r.total_amount || 0);
        withdrawApprovedAmount = actualAmount; // 实际到账金额
        burnAmount = totalAmount; // 销毁金额 = 提现金额总和
        feeAmount = totalAmount - actualAmount; // 手续费 = 提现金额 - 实际到账
      }
    });

    // 智算总台能量值账户 - 从 energy_accounts 表获取
    const adminAccount = await query(
      `SELECT ea.balance FROM energy_accounts ea 
       JOIN users u ON u.id = ea.user_id 
       WHERE u.role = 'admin' LIMIT 1`
    );

    // 智算总台能量值余额 - 统一从 energy_accounts 表获取
    const adminEnergyBalance = adminAccount.length > 0 ? Number(adminAccount[0].balance || 0) : 0;

    return NextResponse.json({
      success: true,
      data: {
        // 板块1：算力额度比例匹配
        quotaMatch: {
          records: quotaMatchRecords,
          total: quotaMatchTotal,
        },
        // 板块2：能量值购买
        purchase: {
          records: purchaseRecords,
          total: purchaseTotal,
        },
        // 板块3：市场能量值分布
        marketDistribution: {
          accounts: marketAccounts,
          total: marketTotal,
        },
        // 板块4：市场内流转
        marketTransfer: {
          records: marketTransferRecords,
          total: marketTransferTotal,
        },
        // 板块5：提现沉淀
        withdraw: {
          records: withdrawAndBurnRecords,
          total: withdrawTotal,
          // 变现申请统计
          withdrawApprovedAmount: withdrawApprovedAmount, // 实际到账金额
          burnAmount: burnAmount, // 销毁金额
          feeAmount: feeAmount, // 手续费（沉淀）
          pendingCount: withdrawPendingCount,
          pendingAmount: withdrawPendingAmount,
        },
        // 智算总台能量值余额
        adminBalance: adminEnergyBalance,
      },
    });
  } catch (error: any) {
    console.error('获取能量值总览失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
