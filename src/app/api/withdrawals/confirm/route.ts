import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { queryOne, execute } from '@/lib/supabase-client';

/**
 * 提现审核API
 * 
 * POST /api/withdrawals/confirm
 * 
 * 审核权限：
 *   会员提现   → 网点审核
 *   服务商提现 → 网点审核
 *   网点提现   → 总台审核
 * 
 * 审核通过：状态 pending → approved（线下打款确认），金额到账审核人
 * 审核拒绝：状态 pending → rejected（退还扣除的金额）
 */

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) return NextResponse.json({ success: false, message: '未授权' }, { status: 401 });

    const body = await request.json();
    const { withdrawalId, action, rejectReason } = body;

    if (!withdrawalId || !action) {
      return NextResponse.json({ success: false, message: '缺少必要参数' });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ success: false, message: '操作类型无效，只支持 approve 或 reject' });
    }

    // 查询提现记录
    const withdrawal = await queryOne(
      `SELECT w.*, u.username, u.role as applicant_role, u.energy_value, u.balance
       FROM withdrawals w
       LEFT JOIN users u ON w.user_id = u.id
       WHERE w.id = $1`,
      [withdrawalId]
    );

    if (!withdrawal) {
      return NextResponse.json({ success: false, message: '提现记录不存在' });
    }

    if (withdrawal.status !== 'pending') {
      return NextResponse.json({ success: false, message: `该提现记录状态为${withdrawal.status}，无法审核` });
    }

    // 查询审核人信息
    const reviewer = await queryOne(
      `SELECT id, username, role, branch_id FROM users WHERE id = $1`,
      [auth.userId]
    );

    if (!reviewer) {
      return NextResponse.json({ success: false, message: '审核人不存在' });
    }

    // 验证审核权限
    if (reviewer.role === 'admin') {
      if (withdrawal.reviewer_type !== 'admin') {
        return NextResponse.json({ success: false, message: '您只能审核网点的提现申请' });
      }
    } else if (reviewer.role === 'branch') {
      if (withdrawal.reviewer_type !== 'branch') {
        return NextResponse.json({ success: false, message: '您只能审核会员和服务商的提现申请' });
      }
      // 进一步验证：该提现申请人是否属于本网点
      const applicantRole = withdrawal.applicant_role || withdrawal.user_role;
      if (applicantRole === 'provider') {
        const providerUser = await queryOne(
          `SELECT branch_id FROM users WHERE id = $1`,
          [withdrawal.user_id]
        );
        if (!providerUser || (providerUser.branch_id !== reviewer.id && providerUser.branch_id !== reviewer.branch_id)) {
          return NextResponse.json({ success: false, message: '该服务商不属于您的网点' });
        }
      } else if (applicantRole === 'member') {
        const memberUser = await queryOne(
          `SELECT provider_id FROM users WHERE id = $1`,
          [withdrawal.user_id]
        );
        if (memberUser && memberUser.provider_id) {
          const providerUser = await queryOne(
            `SELECT branch_id FROM users WHERE id = $1`,
            [memberUser.provider_id]
          );
          if (!providerUser || (providerUser.branch_id !== reviewer.id && providerUser.branch_id !== reviewer.branch_id)) {
            return NextResponse.json({ success: false, message: '该会员不属于您的网点' });
          }
        }
      }
    } else {
      return NextResponse.json({ success: false, message: '您没有审核权限' });
    }

    if (action === 'approve') {
      // 审核通过 → 标记为completed（审核通过即付款完成）
      await execute(
        `UPDATE withdrawals SET status = 'completed', reviewer_id = $1, reviewed_at = NOW(), completed_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [auth.userId, withdrawalId]
      );

      const applicantRole = withdrawal.applicant_role || withdrawal.user_role;
      const applicantName = withdrawal.username || '未知';

      if (reviewer.role === 'branch') {
        // 网点审核通过：会员/服务商提现智算金
        // 网点得到95%智算金到账，总公司得到5%手续费沉淀
        const feeRate = 0.05;
        const feeAmount = Math.round(withdrawal.amount * feeRate * 100) / 100;
        const branchAmount = withdrawal.amount - feeAmount;

        // 网点到账95%智算金
        await execute(
          `UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2`,
          [branchAmount, auth.userId]
        );

        // 总公司得到5%手续费沉淀（加到balance）
        const adminUser = await queryOne(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
        if (adminUser) {
          await execute(
            `UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2`,
            [feeAmount, adminUser.id]
          );
        }

        // 网点资金流水：提现收入
        await execute(
          `INSERT INTO capital_flow_records (user_id, flow_type, amount, fee_amount, actual_amount, related_user_id, note, status, created_at)
           VALUES ($1, 'withdraw_income', $2, $3, $4, $5, $6, 'completed', NOW())`,
          [auth.userId, withdrawal.amount, feeAmount, branchAmount, withdrawal.user_id, `审核${applicantName}提现，到账95%智算金`]
        );

        // 写入网点收益记录（branch_revenue_records）
        const revenueType = applicantRole === 'provider' ? 'provider_withdraw' : 'member_withdraw';
        const revenueId = crypto.randomUUID();
        await execute(
          `INSERT INTO branch_revenue_records (id, branch_id, type, amount, related_user_id, related_order_id, note, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', NOW())`,
          [revenueId, auth.userId, revenueType, branchAmount, withdrawal.user_id, withdrawalId, `审核${applicantName}提现，到账95%智算金（${withdrawal.amount}元扣5%手续费${feeAmount}元）`]
        );

      } else if (reviewer.role === 'admin') {
        // 总台审核通过：网点提现智算金，到账总台
        // 同样5%手续费沉淀
        const feeRate = 0.05;
        const feeAmount = Math.round(withdrawal.amount * feeRate * 100) / 100;
        const adminReceiveAmount = withdrawal.amount - feeAmount;

        // 总台到账95%智算金
        await execute(
          `UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2`,
          [adminReceiveAmount, auth.userId]
        );

        // 总公司资金流水：提现收入
        await execute(
          `INSERT INTO capital_flow_records (user_id, flow_type, amount, fee_amount, actual_amount, related_user_id, note, status, created_at)
           VALUES ($1, 'withdraw_income', $2, $3, $4, $5, $6, 'completed', NOW())`,
          [auth.userId, withdrawal.amount, feeAmount, adminReceiveAmount, withdrawal.user_id, `审核${applicantName}提现，到账95%智算金`]
        );
      }

      // 写入手续费沉淀记录（5%手续费）
      if (withdrawal.fee && parseFloat(withdrawal.fee) > 0) {
        await execute(
          `INSERT INTO fee_sedimentation_records (user_id, fee_type, amount, original_amount, fee_rate, related_order_id, related_type, note, status, created_at)
           VALUES ($1, 'withdrawal_fee', $2, $3, 5.00, $4, 'withdrawal', $5, 'completed', NOW())`,
          [withdrawal.user_id, withdrawal.fee, withdrawal.amount, withdrawalId, `提现手续费5%，提现金额¥${withdrawal.amount}`]
        );
      }

      // 写入资金流水记录 - 提现（申请人）
      await execute(
        `INSERT INTO capital_flow_records (user_id, flow_type, amount, fee_amount, actual_amount, related_order_id, note, status, created_at)
         VALUES ($1, 'withdraw', $2, $3, $4, $5, $6, 'completed', NOW())`,
        [withdrawal.user_id, withdrawal.amount, withdrawal.fee || 0, withdrawal.amount - (parseFloat(withdrawal.fee) || 0), withdrawalId, `智算金提现${reviewer.role === 'admin' ? '（总台审核）' : '（网点审核）'}`]
      );

      return NextResponse.json({
        success: true,
        message: '审核通过，提现金额已到账'
      });

    } else {
      // 审核拒绝 → 退还扣除的金额（统一退还到energy_value/智算金）
      // 退还金额
      await execute(
        `UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2`,
        [withdrawal.amount, withdrawal.user_id]
      );

      // 更新提现记录状态
      await execute(
        `UPDATE withdrawals SET status = 'rejected', reviewer_id = $1, reject_reason = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $3`,
        [auth.userId, rejectReason || '审核拒绝', withdrawalId]
      );

      // 写入退还流水
      await execute(
        `INSERT INTO energy_transactions (user_id, type, amount, from_user_id, to_user_id, note, created_at)
         VALUES ($1, 'withdraw_refund', $2, $1, $1, $3, NOW())`,
        [withdrawal.user_id, withdrawal.amount, '提现被拒绝，金额退还']
      );

      return NextResponse.json({
        success: true,
        message: '已拒绝提现申请，金额已退还'
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '审核操作失败';
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
