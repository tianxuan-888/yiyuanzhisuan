import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/lib/supabase-client';

// 会员提现申请（对接服务网点审核，申请时不扣balance，审核通过后才扣）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, amount, alipayAccount, realName } = body;

    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

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

    // 检查余额是否足够
    const user = await queryOne(
      'SELECT id, username, balance FROM users WHERE id = $1',
      [userId]
    );

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    const currentBalance = parseFloat(user.balance) || 0;

    if (currentBalance < withdrawAmount) {
      return NextResponse.json({ error: '智算金余额不足，当前余额 ' + currentBalance.toFixed(2) + ' 元' }, { status: 400 });
    }

    // 计算手续费5%
    const fee = Math.round(withdrawAmount * 0.05 * 100) / 100;
    const actualAmount = withdrawAmount - fee;

    // 冻结余额（申请时即扣除，避免审核时余额变化）
    await execute(
      'UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE id = $2',
      [withdrawAmount.toFixed(2), userId]
    );

    // 创建提现申请（已冻结余额，等服务网点审核）
    await execute(
      `INSERT INTO withdrawals (user_id, user_role, amount, fee, actual_amount, alipay_account, real_name, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())`,
      [userId, 'member', withdrawAmount.toFixed(2), fee.toFixed(2), actualAmount.toFixed(2), alipayAccount, realName]
    );

    return NextResponse.json({
      success: true,
      data: {
        amount: withdrawAmount.toFixed(2),
        fee: fee.toFixed(2),
        actualAmount: actualAmount.toFixed(2),
        currentBalance: currentBalance.toFixed(2),
      },
      message: '提现申请已提交，等待服务网点审核',
    });
  } catch (error: any) {
    console.error('会员提现申请失败:', error);
    return NextResponse.json(
      { error: error.message || '提现申请失败' },
      { status: 500 }
    );
  }
}

// 获取会员提现记录
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: '缺少userId参数' }, { status: 400 });
    }

    const status = searchParams.get('status');

    let sql = 'SELECT * FROM withdrawals WHERE user_id = $1';
    const params: any[] = [userId];

    if (status) {
      sql += ' AND status = $2';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';

    const data = await query(sql, params);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('获取提现记录失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取提现记录失败' },
      { status: 500 }
    );
  }
}
