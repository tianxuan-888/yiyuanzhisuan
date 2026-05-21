import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 服务网点提现申请（向智算总台提现）
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    if (authUser.role !== 'branch') {
      return NextResponse.json({ error: '仅服务网点可使用此接口' }, { status: 403 });
    }

    const body = await request.json();
    const { amount, alipayAccount, realName, withdrawalId, action } = body;
    const userId = authUser.userId;

    // 处理确认收款操作
    if (action === 'confirm_receipt' && withdrawalId) {
      const result = await withTransaction(async (client) => {
        const wRes = await client.query(
          'SELECT * FROM withdrawals WHERE id = $1 AND user_id = $2 AND user_role = $3',
          [withdrawalId, userId, 'branch']
        );

        if (!wRes.rows || wRes.rows.length === 0) {
          throw Object.assign(new Error('提现记录不存在'), { statusCode: 404 });
        }

        const w = wRes.rows[0];
        if (w.status !== 'transferred') {
          throw Object.assign(new Error('当前状态无法确认收款，需等待智算总台确认打款'), { statusCode: 400 });
        }

        await client.query(
          "UPDATE withdrawals SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1",
          [withdrawalId]
        );

        return { withdrawalId };
      });

      return NextResponse.json({
        success: true,
        data: result,
        message: '确认收款成功，提现已完成',
      });
    }

    // 提交提现申请
    if (!amount || !alipayAccount || !realName) {
      return NextResponse.json({ error: '缺少必要参数：金额、支付宝账号、真实姓名' }, { status: 400 });
    }

    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      return NextResponse.json({ error: '提现金额无效' }, { status: 400 });
    }

    if (withdrawAmount < 100) {
      return NextResponse.json({ error: '最小提现金额为 100 元' }, { status: 400 });
    }

    const fee = Math.round(withdrawAmount * 0.05 * 100) / 100;
    const actualAmount = withdrawAmount - fee;

    const result = await withTransaction(async (client) => {
      const userRes = await client.query(
        'SELECT id, username, balance FROM users WHERE id = $1',
        [userId]
      );

      if (!userRes.rows || userRes.rows.length === 0) {
        throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
      }

      const user = userRes.rows[0];
      const currentBalance = parseFloat(user.balance) || 0;

      if (currentBalance < withdrawAmount) {
        throw Object.assign(new Error('收益余额不足'), { statusCode: 400 });
      }

      const newBalance = currentBalance - withdrawAmount;

      // 1. 扣减服务网点余额
      await client.query(
        'UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2',
        [newBalance.toFixed(2), userId]
      );

      // 2. 创建提现记录
      const withdrawalRes = await client.query(
        `INSERT INTO withdrawals (user_id, user_role, amount, fee, actual_amount, alipay_account, real_name, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW()) RETURNING id`,
        [userId, 'branch', withdrawAmount.toFixed(2), fee.toFixed(2), actualAmount.toFixed(2), alipayAccount, realName]
      );

      const withdrawalId = withdrawalRes.rows[0].id;

      // 3. 手续费沉淀到智算总台（服务网点提现的手续费直接归智算总台）
      await client.query(
        `INSERT INTO company_fee_records (type, amount, source_user_id, source_role, source_withdrawal_id, note, created_at)
         VALUES ('withdrawal_fee', $1, $2, 'branch', $3, $4, NOW())`,
        [fee.toFixed(2), userId, withdrawalId, `服务网点提现手续费5%: ${fee}元`]
      );

      return { withdrawalId, newBalance, fee, actualAmount };
    });

    return NextResponse.json({
      success: true,
      data: {
        withdrawalId: result.withdrawalId,
        amount: withdrawAmount.toFixed(2),
        fee: result.fee.toFixed(2),
        actualAmount: result.actualAmount.toFixed(2),
        balance: result.newBalance.toFixed(2),
      },
      message: '提现申请已提交，等待智算总台审核',
    });
  } catch (error: any) {
    console.error('服务网点提现申请失败:', error);
    const statusCode = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || '提现申请失败' },
      { status: statusCode }
    );
  }
}

// 获取服务网点提现记录
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const userId = authUser.userId;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let sql = 'SELECT * FROM withdrawals WHERE user_id = $1 AND user_role = $2';
    const params: any[] = [userId, 'branch'];

    if (status) {
      sql += ' AND status = $3';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';

    const data = await query(sql, params);

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('获取提现记录失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取提现记录失败' },
      { status: 500 }
    );
  }
}
