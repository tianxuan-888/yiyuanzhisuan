import { NextRequest, NextResponse } from 'next/server';
import { query, execute, withTransaction } from '@/lib/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 智算总台审核提现申请
// 审核通过：提现金额全额回流到总台，手续费5%归平台
// 审核拒绝：退还余额给用户
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    if (!authorizeRole(authUser, ['admin'])) {
      return NextResponse.json({ error: '只有智算总台管理员可以审核提现' }, { status: 403 });
    }

    const body = await request.json();
    const { withdrawalId, action, note } = body;

    if (!withdrawalId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '操作类型无效，只能是 approve 或 reject' }, { status: 400 });
    }

    // 查询提现记录
    const withdrawal = await query<any>(
      'SELECT * FROM withdrawals WHERE id = $1',
      [withdrawalId]
    );

    if (!withdrawal || withdrawal.length === 0) {
      return NextResponse.json({ error: '提现记录不存在' }, { status: 404 });
    }

    const wd = withdrawal[0];

    if (wd.status !== 'pending') {
      return NextResponse.json({ error: `提现状态为 ${wd.status}，无法审核` }, { status: 400 });
    }

    const withdrawAmount = parseFloat(wd.amount) || 0;
    const fee = parseFloat(wd.fee) || 0;
    const actualAmount = parseFloat(wd.actual_amount) || 0;

    if (action === 'approve') {
      // 审核通过：提现金额全额回流到总台
      const result = await withTransaction(async (client) => {
        // 1. 更新提现记录状态为 approved
        await client.query(
          "UPDATE withdrawals SET status = 'approved', reviewed_at = NOW(), reviewed_by = $1, review_note = $2, updated_at = NOW() WHERE id = $3",
          [authUser.userId, note || '', withdrawalId]
        );

        // 2. 提现金额全额回流到总台（加到admin的balance）
        const adminRes = await client.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
        if (adminRes.rows && adminRes.rows.length > 0) {
          await client.query(
            'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
            [withdrawAmount.toFixed(2), adminRes.rows[0].id]
          );
        }

        // 3. 记录手续费到 company_fee_records
        await client.query(
          `INSERT INTO company_fee_records (type, amount, source_user_id, source_role, source_withdrawal_id, note, created_at)
           VALUES ('withdrawal_fee', $1, $2, $3, $4, $5, NOW())`,
          [fee.toFixed(2), wd.user_id, wd.user_role, withdrawalId, `提现手续费5%: ${fee}元，提现金额${withdrawAmount}元全额回流`]
        );

        // 4. 发送通知给用户
        await client.query(
          `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, type, title, content, created_at)
           VALUES ($1, $2, $3, $4, 'withdraw_approved', '提现审核通过', $5, NOW())`,
          [crypto.randomUUID(), wd.user_id, wd.user_role, authUser.userId,
           `您的提现申请 ${withdrawAmount} 元已审核通过，手续费 ${fee} 元，实际到账 ${actualAmount} 元，请注意查收。`]
        );

        return { withdrawAmount, fee, actualAmount };
      });

      return NextResponse.json({
        success: true,
        message: `提现审核通过，${withdrawAmount} 元已回流到总台，手续费 ${fee} 元`,
        data: result,
      });

    } else {
      // 审核拒绝：退还余额给用户
      const result = await withTransaction(async (client) => {
        // 1. 更新提现记录状态为 rejected
        await client.query(
          "UPDATE withdrawals SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $1, review_note = $2, updated_at = NOW() WHERE id = $3",
          [authUser.userId, note || '审核拒绝', withdrawalId]
        );

        // 2. 退还余额给用户
        await client.query(
          'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
          [withdrawAmount.toFixed(2), wd.user_id]
        );

        // 3. 发送通知
        await client.query(
          `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, type, title, content, created_at)
           VALUES ($1, $2, $3, $4, 'withdraw_rejected', '提现审核拒绝', $5, NOW())`,
          [crypto.randomUUID(), wd.user_id, wd.user_role, authUser.userId,
           `您的提现申请 ${withdrawAmount} 元已被拒绝，金额已退回您的账户。${note ? '原因：' + note : ''}`]
        );

        return { withdrawAmount };
      });

      return NextResponse.json({
        success: true,
        message: `提现审核已拒绝，${withdrawAmount} 元已退回用户账户`,
        data: result,
      });
    }
  } catch (error) {
    console.error('审核提现失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '审核提现失败' },
      { status: 500 }
    );
  }
}

// 获取所有提现记录（总台查看）
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    if (!authorizeRole(authUser, ['admin'])) {
      return NextResponse.json({ error: '只有智算总台管理员可以查看' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const userRole = searchParams.get('userRole');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    let sql = `SELECT w.*, u.username, u.role as user_role_name, u.phone 
               FROM withdrawals w 
               LEFT JOIN users u ON w.user_id = u.id 
               WHERE 1=1`;
    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      sql += ` AND w.status = $${paramIndex++}`;
      params.push(status);
    }

    if (userRole) {
      sql += ` AND w.user_role = $${paramIndex++}`;
      params.push(userRole);
    }

    // 获取总数
    const countSql = sql.replace('SELECT w.*, u.username, u.role as user_role_name, u.phone', 'SELECT COUNT(*) as total');
    const countResult = await query<any>(countSql, params);
    const total = countResult?.[0]?.total || 0;

    // 分页
    sql += ` ORDER BY w.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(pageSize, (page - 1) * pageSize);

    const data = await query<any>(sql, params);

    // 统计
    const statsSql = `SELECT 
      COUNT(*) as total_count,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) as pending_amount,
      COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0) as approved_amount,
      COALESCE(SUM(CASE WHEN status = 'approved' THEN fee ELSE 0 END), 0) as total_fee
    FROM withdrawals`;
    const stats = await query<any>(statsSql);

    return NextResponse.json({
      success: true,
      data: {
        records: data,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
        stats: stats?.[0] || {},
      },
    });
  } catch (error) {
    console.error('获取提现记录失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取提现记录失败' },
      { status: 500 }
    );
  }
}
