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
 * 审核通过：状态 pending → completed（线下打款确认）
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
      `SELECT id, role, branch_id FROM users WHERE id = $1`,
      [auth.userId]
    );

    if (!reviewer) {
      return NextResponse.json({ success: false, message: '审核人不存在' });
    }

    // 验证审核权限
    // 总台只能审核 reviewer_type = admin 的提现（网点提现）
    // 网点只能审核 reviewer_type = branch 的提现（会员/服务商提现）
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
        // 验证服务商是否属于该网点
        const providerUser = await queryOne(
          `SELECT branch_id FROM users WHERE id = $1`,
          [withdrawal.user_id]
        );
        if (!providerUser || (providerUser.branch_id !== reviewer.id && providerUser.branch_id !== reviewer.branch_id)) {
          return NextResponse.json({ success: false, message: '该服务商不属于您的网点' });
        }
      } else if (applicantRole === 'member') {
        // 验证会员是否属于该网点下的服务商
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
      // 审核通过 → 标记为approved
      await execute(
        `UPDATE withdrawals SET status = 'approved', reviewer_id = $1, reviewed_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [auth.userId, withdrawalId]
      );

      return NextResponse.json({
        success: true,
        message: '审核通过，提现已完成'
      });

    } else {
      // 审核拒绝 → 退还扣除的金额
      const applicantRole = withdrawal.applicant_role || withdrawal.user_role;
      const isEnergyWithdraw = ['member', 'provider'].includes(applicantRole);
      const refundField = isEnergyWithdraw ? 'energy_value' : 'balance';

      // 退还金额
      await execute(
        `UPDATE users SET ${refundField} = ${refundField} + $1, updated_at = NOW() WHERE id = $2`,
        [withdrawal.amount, withdrawal.user_id]
      );

      // 更新提现记录状态
      await execute(
        `UPDATE withdrawals SET status = 'rejected', reviewer_id = $1, reject_reason = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $3`,
        [auth.userId, rejectReason || '审核拒绝', withdrawalId]
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
