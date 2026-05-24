import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/lib/supabase-client';

// 智算总台审核提现申请（仅审核服务网点的提现，会员/服务商提现由服务网点审核）
// 用户数据库 withdrawals 表结构:
// id, user_id, user_role, amount, fee, actual_amount, alipay_account, real_name,
// reviewer_id, status, reject_reason, reviewed_at, transferred_at, completed_at, note, created_at, updated_at

// 申请时不扣balance，审核通过时才扣
// 审核通过：从网点balance扣除提现金额，5%手续费回流总台
// 审核拒绝：不扣钱（因为申请时没扣）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { withdrawalId, action, note, adminUserId } = body;

    if (!withdrawalId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '操作类型无效，只能是 approve 或 reject' }, { status: 400 });
    }

    // 查询提现记录
    const wd = await queryOne(
      'SELECT * FROM withdrawals WHERE id = $1',
      [withdrawalId]
    );

    if (!wd) {
      return NextResponse.json({ error: '提现记录不存在' }, { status: 404 });
    }

    if (wd.status !== 'pending') {
      return NextResponse.json({ error: `提现状态为 ${wd.status}，无法审核` }, { status: 400 });
    }

    const withdrawAmount = parseFloat(wd.amount) || 0;
    const fee = parseFloat(wd.fee) || Math.round(withdrawAmount * 0.05 * 100) / 100;
    const actualAmount = parseFloat(wd.actual_amount) || withdrawAmount - fee;

    if (action === 'approve') {
      // 审核通过：从用户balance扣除提现金额，全额回流到总台

      // 1. 检查用户余额是否足够
      const user = await queryOne(
        'SELECT id, balance FROM users WHERE id = $1',
        [wd.user_id]
      );

      if (!user) {
        return NextResponse.json({ error: '用户不存在' }, { status: 404 });
      }

      const currentBalance = parseFloat(user.balance) || 0;
      if (currentBalance < withdrawAmount) {
        // 余额不足，自动拒绝
        await execute(
          "UPDATE withdrawals SET status = 'rejected', reject_reason = '审核时余额不足，自动拒绝', reviewed_at = NOW(), updated_at = NOW() WHERE id = $1",
          [withdrawalId]
        );
        return NextResponse.json({ error: '用户当前余额不足，已自动拒绝' }, { status: 400 });
      }

      // 2. 从用户balance扣除
      await execute(
        'UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE id = $2',
        [withdrawAmount.toFixed(2), wd.user_id]
      );

      // 3. 提现金额全额回流到总台（网点提现，手续费归总台）
      const admin = await queryOne("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      if (admin) {
        await execute(
          'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
          [withdrawAmount.toFixed(2), admin.id]
        );
      }

      // 4. 更新提现记录状态为 approved
      await execute(
        "UPDATE withdrawals SET status = 'approved', reviewer_id = $1, reviewed_at = NOW(), transferred_at = NOW(), note = $2, updated_at = NOW() WHERE id = $3",
        [adminUserId || 'admin', note || '', withdrawalId]
      );

      // 5. 记录交易流水
      await execute(
        `INSERT INTO transactions (user_id, type, amount, note, created_at)
         VALUES ($1, 'withdraw', $2, $3, NOW())`,
        [wd.user_id, withdrawAmount.toFixed(2), `提现审核通过，金额${withdrawAmount}元，手续费${fee}元，实际到账${actualAmount}元`]
      );

      return NextResponse.json({
        success: true,
        message: `提现审核通过，${withdrawAmount}元已从用户扣除并回流到总台，手续费${fee}元`,
        data: { withdrawAmount, fee, actualAmount },
      });

    } else {
      // 审核拒绝
      await execute(
        "UPDATE withdrawals SET status = 'rejected', reviewer_id = $1, reject_reason = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $3",
        [adminUserId || 'admin', note || '审核拒绝', withdrawalId]
      );

      // 记录交易流水
      await execute(
        `INSERT INTO transactions (user_id, type, amount, note, created_at)
         VALUES ($1, 'withdraw_rejected', $2, $3, NOW())`,
        [wd.user_id, '0', `提现申请${withdrawAmount}元被拒绝。${note ? '原因：' + note : ''}`]
      );

      return NextResponse.json({
        success: true,
        message: `提现审核已拒绝`,
        data: { withdrawAmount },
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

// 获取所有提现记录（总台只看网点提现，会员/服务商提现由网点审核）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    // 总台只审核服务网点提现（user_role = 'branch'）
    let sql = `SELECT w.*, u.username, u.role as user_role_name, u.phone 
               FROM withdrawals w 
               LEFT JOIN users u ON w.user_id = u.id 
               WHERE w.user_role = 'branch'`;
    const params: any[] = [];

    if (status) {
      sql += ` AND w.status = $${params.length + 1}`;
      params.push(status);
    }

    sql += ' ORDER BY w.created_at DESC LIMIT 50';

    const data = await query(sql, params);

    // 统计 - 只统计网点提现
    const stats = await queryOne(
      `SELECT 
        COUNT(*) as total_count,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) as pending_amount,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0) as approved_amount,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN COALESCE(fee, 0) ELSE 0 END), 0) as total_fee
      FROM withdrawals WHERE user_role = 'branch'`
    );

    return NextResponse.json({
      success: true,
      data: {
        records: data,
        stats: stats || {},
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
