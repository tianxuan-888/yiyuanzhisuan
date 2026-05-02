import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 分公司审核提现（审核会员/服务商的提现申请）
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    if (authUser.role !== 'branch') {
      return NextResponse.json({ error: '仅分公司可审核提现' }, { status: 403 });
    }

    const body = await request.json();
    const { withdrawalId, action, rejectReason } = body;

    if (!withdrawalId || !action) {
      return NextResponse.json({ error: '缺少提现单ID和操作类型' }, { status: 400 });
    }

    if (!['approve', 'reject', 'confirm_transfer', 'complete'].includes(action)) {
      return NextResponse.json({ error: '无效的操作类型' }, { status: 400 });
    }

    const reviewerId = authUser.userId;

    const result = await withTransaction(async (client) => {
      // 查询提现单
      const withdrawalRes = await client.query(
        'SELECT * FROM withdrawals WHERE id = $1',
        [withdrawalId]
      );

      if (!withdrawalRes.rows || withdrawalRes.rows.length === 0) {
        throw Object.assign(new Error('提现单不存在'), { statusCode: 404 });
      }

      const withdrawal = withdrawalRes.rows[0];

      // 验证状态流转
      if (action === 'approve' && withdrawal.status !== 'pending') {
        throw Object.assign(new Error('只能审核待审核的提现单'), { statusCode: 400 });
      }
      if (action === 'confirm_transfer' && withdrawal.status !== 'approved') {
        throw Object.assign(new Error('只能确认已审核的提现单'), { statusCode: 400 });
      }
      if (action === 'complete' && withdrawal.status !== 'transferred') {
        throw Object.assign(new Error('只能完成已转账的提现单'), { statusCode: 400 });
      }
      if (action === 'reject' && withdrawal.status !== 'pending') {
        throw Object.assign(new Error('只能拒绝待审核的提现单'), { statusCode: 400 });
      }

      if (action === 'approve') {
        // 审核通过
        await client.query(
          `UPDATE withdrawals SET status = 'approved', reviewer_id = $1, reviewed_at = NOW(), updated_at = NOW() WHERE id = $2`,
          [reviewerId, withdrawalId]
        );

        // 更新分公司收益记录状态
        await client.query(
          `UPDATE branch_revenue_records SET status = 'approved', updated_at = NOW() WHERE related_withdrawal_id = $1`,
          [withdrawalId]
        );

        // 增加分公司余额（95%到账金额）
        const actualAmount = parseFloat(withdrawal.actual_amount) || 0;
        if (actualAmount > 0) {
          const branchRes = await client.query(
            'SELECT balance FROM users WHERE id = $1',
            [reviewerId]
          );
          if (branchRes.rows && branchRes.rows.length > 0) {
            const currentBalance = parseFloat(branchRes.rows[0].balance) || 0;
            const newBalance = currentBalance + actualAmount;
            await client.query(
              'UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2',
              [newBalance.toFixed(2), reviewerId]
            );
          }
        }

        return { newStatus: 'approved', message: '审核通过，请线下转账后确认打款' };
      }

      if (action === 'confirm_transfer') {
        // 确认已线下转账
        await client.query(
          `UPDATE withdrawals SET status = 'transferred', transferred_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [withdrawalId]
        );

        // 更新分公司收益记录
        await client.query(
          `UPDATE branch_revenue_records SET status = 'paid', updated_at = NOW() WHERE related_withdrawal_id = $1`,
          [withdrawalId]
        );

        return { newStatus: 'transferred', message: '已确认转账，等待会员确认收款' };
      }

      if (action === 'complete') {
        // 完成提现
        await client.query(
          `UPDATE withdrawals SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [withdrawalId]
        );

        // 更新分公司收益记录
        await client.query(
          `UPDATE branch_revenue_records SET status = 'completed', updated_at = NOW() WHERE related_withdrawal_id = $1`,
          [withdrawalId]
        );

        return { newStatus: 'completed', message: '提现已完成' };
      }

      if (action === 'reject') {
        // 审核拒绝 - 退还余额
        const userId = withdrawal.user_id;
        const amount = parseFloat(withdrawal.amount);
        const fee = parseFloat(withdrawal.fee);
        const actualAmount = parseFloat(withdrawal.actual_amount) || 0;

        const userRes = await client.query(
          'SELECT balance FROM users WHERE id = $1',
          [userId]
        );

        if (userRes.rows && userRes.rows.length > 0) {
          const currentBalance = parseFloat(userRes.rows[0].balance) || 0;
          const newBalance = currentBalance + amount;

          await client.query(
            'UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2',
            [newBalance.toFixed(2), userId]
          );
        }

        // 扣除分公司已增加的余额（如果审批时已加）
        if (actualAmount > 0) {
          const branchRes = await client.query(
            'SELECT balance FROM users WHERE id = $1',
            [reviewerId]
          );
          if (branchRes.rows && branchRes.rows.length > 0) {
            const currentBalance = parseFloat(branchRes.rows[0].balance) || 0;
            const newBalance = Math.max(0, currentBalance - actualAmount);
            await client.query(
              'UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2',
              [newBalance.toFixed(2), reviewerId]
            );
          }
        }

        // 更新提现单状态
        await client.query(
          `UPDATE withdrawals SET status = 'rejected', reviewer_id = $1, reject_reason = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $3`,
          [reviewerId, rejectReason || '审核拒绝', withdrawalId]
        );

        // 删除分公司收益记录（退还）
        await client.query(
          `DELETE FROM branch_revenue_records WHERE related_withdrawal_id = $1`,
          [withdrawalId]
        );

        // 删除总公司手续费记录（退还）
        await client.query(
          `DELETE FROM company_fee_records WHERE source_withdrawal_id = $1`,
          [withdrawalId]
        );

        return { newStatus: 'rejected', message: '提现申请已拒绝，金额已退还' };
      }

      return { newStatus: withdrawal.status, message: '操作完成' };
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('审核提现失败:', error);
    const statusCode = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || '审核失败' },
      { status: statusCode }
    );
  }
}

// 获取分公司待审核/所有提现列表
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    if (authUser.role !== 'branch') {
      return NextResponse.json({ error: '仅分公司可查看' }, { status: 403 });
    }

    const branchUserId = authUser.userId;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const userRole = searchParams.get('userRole');

    // 获取分公司下所有会员和服务商的提现单
    // 先找分公司下的服务商
    const providers = await query(
      'SELECT user_id FROM providers WHERE branch_id = $1',
      [branchUserId]
    );
    const providerUserIds = providers.map((p: any) => p.user_id);

    // 找服务商下的会员
    let memberUserIds: string[] = [];
    if (providerUserIds.length > 0) {
      const members = await query(
        `SELECT id FROM users WHERE provider_id = ANY($1)`,
        [providerUserIds]
      );
      memberUserIds = members.map((m: any) => m.id);
    }

    // 合并所有下属用户ID
    const allUserIds = [...providerUserIds, ...memberUserIds];
    if (allUserIds.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    let sql = `SELECT w.*, u.username, u.phone, u.role as user_role_info 
               FROM withdrawals w 
               LEFT JOIN users u ON w.user_id = u.id 
               WHERE w.user_id = ANY($1) AND w.user_role IN ('member', 'provider')`;
    const params: any[] = [allUserIds];
    let paramIdx = 2;

    if (status) {
      sql += ` AND w.status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }

    if (userRole) {
      sql += ` AND w.user_role = $${paramIdx}`;
      params.push(userRole);
    }

    sql += ' ORDER BY w.created_at DESC';

    const data = await query(sql, params);

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('获取提现列表失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取提现列表失败' },
      { status: 500 }
    );
  }
}
