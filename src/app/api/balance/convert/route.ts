import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, amount } = body;

    if (!userId || !amount || amount <= 0) {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    // 最低转换金额
    if (amount < 10) {
      return NextResponse.json({ error: '最低转换金额为10' }, { status: 400 });
    }

    // 查询用户余额
    const user: any = await queryOne(
      'SELECT id, username, balance, points FROM users WHERE id::text = $1',
      [userId]
    );

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    const currentBalance = Number(user.balance) || 0;
    if (currentBalance < amount) {
      return NextResponse.json({ error: '智算金余额不足' }, { status: 400 });
    }

    // 1:1 转换，智算金转积分
    const newBalance = currentBalance - amount;
    const newPoints = (Number(user.points) || 0) + amount;

    // 扣除智算金
    await query(
      'UPDATE users SET balance = $1, points = $2 WHERE id::text = $3',
      [newBalance, newPoints, userId]
    );

    // 记录交易
    await query(
      `INSERT INTO transactions (id, user_id, order_id, type, amount, status, description, created_at)
       VALUES (gen_random_uuid(), $1, NULL, 'balance_to_points', $2, 'completed', $3, NOW())`,
      [userId, amount, JSON.stringify({ 
        note: `智算金转积分：${amount}`,
        beforeBalance: currentBalance,
        afterBalance: newBalance,
        beforePoints: Number(user.points) || 0,
        afterPoints: newPoints
      })]
    );

    return NextResponse.json({
      success: true,
      message: `成功将${amount}智算金转为积分`,
      data: {
        balance: newBalance,
        points: newPoints,
        convertedAmount: amount
      }
    });
  } catch (error: any) {
    console.error('[balance-convert] error:', error);
    return NextResponse.json({ error: error.message || '转换失败' }, { status: 500 });
  }
}
