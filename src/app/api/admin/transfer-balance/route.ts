import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

// 总台给任意账号转智算金 - 直接到账，无手续费
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { toUserId, amount, note } = body;

    if (!toUserId || !amount) {
      return NextResponse.json({ success: false, error: '缺少必要参数' }, { status: 400 });
    }

    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      return NextResponse.json({ success: false, error: '转账金额必须大于0' }, { status: 400 });
    }

    // 查询目标用户
    const toUser: any = await queryOne(
      'SELECT id, username, balance, role, phone, unique_id FROM users WHERE id::text = $1',
      [toUserId]
    );

    if (!toUser) {
      return NextResponse.json({ success: false, error: '目标用户不存在' }, { status: 404 });
    }

    const roleLabel = toUser.role === 'admin' ? '总台' : toUser.role === 'branch' ? '服务网点' : toUser.role === 'provider' ? '服务商' : '会员';

    // 1. 直接增加目标用户智算金
    await query(
      'UPDATE users SET balance = (balance::float + $1)::numeric WHERE id::text = $2',
      [transferAmount, toUserId]
    );

    // 2. 记录交易
    await query(
      `INSERT INTO transactions (id, user_id, order_id, type, amount, status, description, created_at)
       VALUES (gen_random_uuid(), $1, NULL, 'admin_transfer', $2, 'completed', $3, NOW())`,
      [toUserId, transferAmount, JSON.stringify({
        fromAdmin: true,
        note: note || `总台转入${transferAmount}智算金`,
      })]
    );

    // 3. 查询更新后的余额
    const updatedUser: any = await queryOne(
      'SELECT balance FROM users WHERE id::text = $1',
      [toUserId]
    );

    return NextResponse.json({
      success: true,
      message: `成功向${roleLabel} ${toUser.username} 转入 ${transferAmount} 智算金`,
      data: {
        toUserId,
        toUsername: toUser.username,
        toUserRole: toUser.role,
        toUserPhone: toUser.phone,
        amount: transferAmount,
        newBalance: parseFloat(String(updatedUser?.balance)) || 0,
      },
    });
  } catch (error) {
    console.error('总台转智算金失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '转账失败' },
      { status: 500 }
    );
  }
}
