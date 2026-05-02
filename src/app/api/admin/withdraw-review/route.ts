import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 总公司审核分公司提现
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    if (authUser.role !== 'admin') {
      return NextResponse.json({ error: '仅总公司可审核' }, { status: 403 });
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
      const withdrawalRes = await client.query(
        'SELECT * FROM withdrawals WHERE id = $1',
        [withdrawalId]
      );

      if (!withdrawalRes.rows || withdrawalRes.rows.length === 0) {
        throw Object.assign(new Error('提现单不存在'), { statusCode: 404 });
      }

      const withdrawal = withdrawalRes.rows[0];

      if (withdrawal.user_role !== 'branch') {
        throw Object.assign(new Error('仅可审核分公司提现单'), { statusCode: 400 });
      }

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
        await client.query(
          `UPDATE withdrawals SET status = 'approved', reviewer_id = $1, reviewed_at = NOW(), updated_at = NOW() WHERE id = $2`,
          [reviewerId, withdrawalId]
        );
        return { newStatus: 'approved', message: '审核通过，请线下转账后确认打款' };
      }

      if (action === 'confirm_transfer') {
        await client.query(
          `UPDATE withdrawals SET status = 'transferred', transferred_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [withdrawalId]
        );
        return { newStatus: 'transferred', message: '已确认转账' };
      }

      if (action === 'complete') {
        await client.query(
          `UPDATE withdrawals SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [withdrawalId]
        );
        return { newStatus: 'completed', message: '提现已完成' };
      }

      if (action === 'reject') {
        const userId = withdrawal.user_id;
        const amount = parseFloat(withdrawal.amount);

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

        await client.query(
          `UPDATE withdrawals SET status = 'rejected', reviewer_id = $1, reject_reason = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $3`,
          [reviewerId, rejectReason || '审核拒绝', withdrawalId]
        );

        // 删除手续费记录
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
    console.error('总公司审核提现失败:', error);
    const statusCode = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || '审核失败' },
      { status: statusCode }
    );
  }
}

// 获取总公司待审核的分公司提现列表
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    if (authUser.role !== 'admin') {
      return NextResponse.json({ error: '仅总公司可查看' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let sql = `SELECT w.*, u.username, u.phone, u.branch_id as branch_info 
               FROM withdrawals w 
               LEFT JOIN users u ON w.user_id = u.id 
               WHERE w.user_role = 'branch'`;
    const params: any[] = [];
    let paramIdx = 1;

    if (status) {
      sql += ` AND w.status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
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
