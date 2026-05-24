import { NextRequest, NextResponse } from 'next/server';
import { execute, queryOne, query } from '@/lib/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { branchId, amount, alipayAccount, realName } = body;

    if (!branchId || !amount || Number(amount) < 100) {
      return NextResponse.json({ error: '参数错误，最低提现金额为100' }, { status: 400 });
    }

    const withdrawAmount = Number(amount);

    // 查询网点balance
    const user = await queryOne(
      `SELECT id, username, balance FROM users WHERE id = $1 AND role = 'branch'`,
      [branchId]
    );

    if (!user) {
      return NextResponse.json({ error: '网点不存在' }, { status: 404 });
    }

    const currentBalance = parseFloat(String(user.balance || '0'));
    if (currentBalance < withdrawAmount) {
      return NextResponse.json({ error: `智算金余额不足，当前余额 ${currentBalance.toFixed(2)}` }, { status: 400 });
    }

    const fee = Math.round(withdrawAmount * 0.05 * 100) / 100;
    const actualAmount = withdrawAmount - fee;

    // 冻结余额（申请时即扣除，避免审核时余额变化）
    await execute(
      'UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE id = $2',
      [withdrawAmount.toFixed(2), branchId]
    );

    // 创建提现记录（已冻结余额，等总台审核）
    await execute(
      `INSERT INTO withdrawals (user_id, user_role, amount, fee, actual_amount, alipay_account, real_name, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())`,
      [branchId, 'branch', withdrawAmount.toFixed(2), fee.toFixed(2), actualAmount.toFixed(2), alipayAccount || '', realName || '']
    );

    return NextResponse.json({
      success: true,
      message: '提现申请已提交，等待总台审核',
      data: { fee: fee.toFixed(2), actualAmount: actualAmount.toFixed(2) }
    });

  } catch (error: any) {
    console.error('网点提现申请失败:', error);
    return NextResponse.json({ error: error.message || '提现申请失败' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId') || searchParams.get('userId');

    if (!branchId) {
      return NextResponse.json({ error: '缺少branchId参数' }, { status: 400 });
    }

    // 查询该网点的提现记录
    const records = await query(
      `SELECT id, amount, alipay_account, real_name, status, fee, actual_amount, created_at, updated_at
       FROM withdrawals
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [branchId]
    );

    return NextResponse.json({
      success: true,
      data: records || []
    });

  } catch (error: any) {
    console.error('查询网点提现记录失败:', error);
    return NextResponse.json({ error: error.message || '查询失败' }, { status: 500 });
  }
}
