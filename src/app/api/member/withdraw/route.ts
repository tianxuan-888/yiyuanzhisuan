import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 提现申请
export async function POST(request: NextRequest) {
  try {
    // 鉴权
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { amount, alipayAccount, realName } = body;

    // 强制使用 JWT 中的 userId，防止冒充
    const userId = authUser.userId;

    if (!amount || !alipayAccount || !realName) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      return NextResponse.json(
        { error: '提现金额无效' },
        { status: 400 }
      );
    }

    if (withdrawAmount < 100) {
      return NextResponse.json(
        { error: '最小提现金额为 100 元' },
        { status: 400 }
      );
    }

    // 使用数据库事务保证原子性
    const result = await withTransaction(async (client) => {
      // 使用 FOR UPDATE 行锁防止并发扣款
      const userRes = await client.query(
        'SELECT id, username, balance, provider_id FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );

      if (userRes.rows.length === 0) {
        throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
      }

      const user = userRes.rows[0];
      const currentBalance = parseFloat(user.balance) || 0;

      if (currentBalance < withdrawAmount) {
        throw Object.assign(new Error('余额不足'), { statusCode: 400 });
      }

      const newBalance = currentBalance - withdrawAmount;

      // 扣减余额
      await client.query(
        'UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2',
        [newBalance.toFixed(2), userId]
      );

      // 创建提现记录
      const withdrawalRes = await client.query(
        `INSERT INTO withdrawals (user_id, amount, alipay_account, real_name, status, created_at)
         VALUES ($1, $2, $3, $4, 'pending', NOW()) RETURNING id`,
        [userId, withdrawAmount.toFixed(2), alipayAccount, realName]
      );

      const withdrawalId = withdrawalRes.rows[0].id;

      // 创建交易记录
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, created_at)
         VALUES ($1, 'withdraw', $2, $3, $4, $5, NOW())`,
        [userId, withdrawAmount.toFixed(2), currentBalance.toFixed(2), newBalance.toFixed(2), `提现申请: ${withdrawAmount}元`]
      );

      return { withdrawalId, newBalance, user };
    });

    return NextResponse.json({
      success: true,
      data: {
        withdrawalId: result.withdrawalId,
        balance: result.newBalance.toFixed(2),
      },
      message: '提现申请已提交，等待审核',
    });
  } catch (error: any) {
    console.error('提现申请失败:', error);
    const statusCode = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || '提现申请失败' },
      { status: statusCode }
    );
  }
}

// 获取提现记录
export async function GET(request: NextRequest) {
  try {
    // 鉴权
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    // 使用 JWT 中的 userId
    const userId = authUser.userId;

    const { query } = await import('@/storage/database/pg-client');

    const data = await query(
      'SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

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
