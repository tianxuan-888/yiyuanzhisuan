import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 会员提现申请
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { action, withdrawalId, amount, alipayAccount, realName } = body;
    const userId = authUser.userId;

    // 会员确认收款
    if (action === 'confirm_receipt') {
      if (!withdrawalId) {
        return NextResponse.json({ error: '缺少提现单ID' }, { status: 400 });
      }
      const result = await withTransaction(async (client) => {
        const wdRes = await client.query(
          "SELECT id, status, amount FROM withdrawals WHERE id = $1 AND user_id = $2",
          [withdrawalId, userId]
        );
        if (!wdRes.rows || wdRes.rows.length === 0) {
          throw Object.assign(new Error('提现记录不存在'), { statusCode: 404 });
        }
        const wd = wdRes.rows[0];
        if (wd.status !== 'transferred') {
          throw Object.assign(new Error('当前状态无法确认收款，需等待服务网点打款'), { statusCode: 400 });
        }
        await client.query(
          "UPDATE withdrawals SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1",
          [withdrawalId]
        );

        // 更新服务网点收益记录状态为已完成
        await client.query(
          "UPDATE branch_revenue_records SET status = 'completed', updated_at = NOW() WHERE related_withdrawal_id = $1",
          [withdrawalId]
        );

        return { withdrawalId, amount: wd.amount };
      });
      return NextResponse.json({
        success: true,
        message: '已确认收款，提现完成',
        data: result
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

    if (withdrawAmount < 50) {
      return NextResponse.json({ error: '最小提现金额为 50 元' }, { status: 400 });
    }

    // 计算手续费和到账金额
    const fee = Math.round(withdrawAmount * 0.05 * 100) / 100; // 5%手续费
    const actualAmount = withdrawAmount - fee; // 95%到账

    const result = await withTransaction(async (client) => {
      // 查询用户余额
      const userRes = await client.query(
        'SELECT id, username, balance, provider_id, branch_id FROM users WHERE id = $1',
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

      // 获取服务网点ID：通过 provider_id → providers.branch_id
      let branchId = user.branch_id;
      if (!branchId && user.provider_id) {
        const providerRes = await client.query(
          'SELECT branch_id FROM providers WHERE user_id = $1',
          [user.provider_id]
        );
        if (providerRes.rows && providerRes.rows.length > 0) {
          branchId = providerRes.rows[0].branch_id;
        }
      }

      if (!branchId) {
        throw Object.assign(new Error('未找到所属服务网点，无法提现'), { statusCode: 400 });
      }

      const newBalance = currentBalance - withdrawAmount;

      // 1. 扣减会员余额
      await client.query(
        'UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2',
        [newBalance.toFixed(2), userId]
      );

      // 2. 创建提现记录
      const withdrawalRes = await client.query(
        `INSERT INTO withdrawals (user_id, user_role, amount, fee, actual_amount, alipay_account, real_name, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW()) RETURNING id`,
        [userId, 'member', withdrawAmount.toFixed(2), fee.toFixed(2), actualAmount.toFixed(2), alipayAccount, realName]
      );

      const withdrawalId = withdrawalRes.rows[0].id;

      // 3. 记入服务网点现金收益
      await client.query(
        `INSERT INTO branch_revenue_records (branch_id, type, amount, related_user_id, related_withdrawal_id, status, note, created_at)
         VALUES ($1, 'member_withdraw', $2, $3, $4, 'received', $5, NOW())`,
        [branchId, actualAmount.toFixed(2), userId, withdrawalId, `会员提现: ${withdrawAmount}元，到账${actualAmount}元`]
      );

      // 4. 手续费沉淀到智算总台
      await client.query(
        `INSERT INTO company_fee_records (type, amount, source_user_id, source_role, source_withdrawal_id, note, created_at)
         VALUES ('withdrawal_fee', $1, $2, 'member', $3, $4, NOW())`,
        [fee.toFixed(2), userId, withdrawalId, `会员提现手续费5%: ${fee}元`]
      );

      return { withdrawalId, newBalance, fee, actualAmount, branchId };
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
      message: '提现申请已提交，等待服务网点审核',
    });
  } catch (error: any) {
    console.error('会员提现申请失败:', error);
    const statusCode = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || '提现申请失败' },
      { status: statusCode }
    );
  }
}

// 获取会员提现记录
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
    const params: any[] = [userId, 'member'];

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
