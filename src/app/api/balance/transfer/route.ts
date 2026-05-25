import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

// 智算金（balance）互转 - 5%转化为积分，95%到账对方智算金
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fromUserId, toUserId, amount, note } = body;

    if (!fromUserId || !toUserId || !amount) {
      return NextResponse.json({ success: false, error: '缺少必要参数' }, { status: 400 });
    }

    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      return NextResponse.json({ success: false, error: '转账金额必须大于0' }, { status: 400 });
    }

    // 最低转账金额
    if (transferAmount < 100) {
      return NextResponse.json({ success: false, error: '最低转账金额为100' }, { status: 400 });
    }

    // 不能转给自己
    if (fromUserId === toUserId) {
      return NextResponse.json({ success: false, error: '不能转给自己' }, { status: 400 });
    }

    // 查询转出方余额
    const fromUser: any = await queryOne(
      'SELECT id, username, balance, points, role FROM users WHERE id::text = $1',
      [fromUserId]
    );

    if (!fromUser) {
      return NextResponse.json({ success: false, error: '转出方用户不存在' }, { status: 404 });
    }

    const fromBalance = parseFloat(String(fromUser.balance)) || 0;
    if (fromBalance < transferAmount) {
      return NextResponse.json({ success: false, error: `余额不足，当前余额: ${fromBalance}` }, { status: 400 });
    }

    // 查询转入方
    const toUser: any = await queryOne(
      'SELECT id, username, balance, points, role FROM users WHERE id::text = $1',
      [toUserId]
    );

    if (!toUser) {
      return NextResponse.json({ success: false, error: '转入方用户不存在' }, { status: 404 });
    }

    // 计算互转分配：5%→积分，95%→对方智算金
    const pointsFee = Math.round(transferAmount * 0.05 * 100) / 100;
    const actualReceive = Math.round((transferAmount - pointsFee) * 100) / 100;

    // 1. 扣除转出方全部转账金额
    await query(
      'UPDATE users SET balance = (balance::float - $1)::numeric WHERE id::text = $2',
      [transferAmount, fromUserId]
    );

    // 2. 转出方获得5%积分
    await query(
      'UPDATE users SET points = (COALESCE(points::float, 0) + $1)::numeric WHERE id::text = $2',
      [pointsFee, fromUserId]
    );

    // 3. 转入方获得95%智算金
    await query(
      'UPDATE users SET balance = (balance::float + $1)::numeric WHERE id::text = $2',
      [actualReceive, toUserId]
    );

    // 4. 记录交易 - 转出方
    await query(
      `INSERT INTO transactions (id, user_id, order_id, type, amount, status, description, created_at)
       VALUES (gen_random_uuid(), $1, NULL, 'balance_transfer_out', $2, 'completed', $3, NOW())`,
      [fromUserId, transferAmount, JSON.stringify({ 
        toUser: toUser.username, toUserId, 
        actualReceive, pointsFee,
        note: note || '智算金转出' 
      })]
    );

    // 5. 记录交易 - 转出方获得积分
    await query(
      `INSERT INTO transactions (id, user_id, order_id, type, amount, status, description, created_at)
       VALUES (gen_random_uuid(), $1, NULL, 'points_from_transfer', $2, 'completed', $3, NOW())`,
      [fromUserId, pointsFee, JSON.stringify({ 
        fromTransfer: true, 
        originalAmount: transferAmount,
        note: '互转获得5%积分' 
      })]
    );

    // 6. 记录交易 - 转入方
    await query(
      `INSERT INTO transactions (id, user_id, order_id, type, amount, status, description, created_at)
       VALUES (gen_random_uuid(), $1, NULL, 'balance_transfer_in', $2, 'completed', $3, NOW())`,
      [toUserId, actualReceive, JSON.stringify({ 
        fromUser: fromUser.username, fromUserId, 
        originalAmount: transferAmount,
        pointsFee,
        note: note || '智算金转入' 
      })]
    );

    // 7. 更新积分（5%转为积分）
    await query(
      'UPDATE users SET points = COALESCE(points, 0) + $1 WHERE id::text = $2',
      [pointsFee, fromUserId]
    );

    // 查询更新后的余额
    const updatedFromUser: any = await queryOne(
      'SELECT balance, points FROM users WHERE id::text = $1',
      [fromUserId]
    );
    const updatedToUser: any = await queryOne(
      'SELECT balance FROM users WHERE id::text = $1',
      [toUserId]
    );

    return NextResponse.json({
      success: true,
      message: `成功转账 ${transferAmount} 智算金给 ${toUser.username}（对方到账 ${actualReceive}，您获得 ${pointsFee} 积分）`,
      data: {
        fromBalance: parseFloat(String(updatedFromUser?.balance)) || 0,
        fromPoints: parseFloat(String(updatedFromUser?.points)) || 0,
        toBalance: parseFloat(String(updatedToUser?.balance)) || 0,
        amount: transferAmount,
        actualReceive,
        pointsFee,
      },
    });
  } catch (error) {
    console.error('智算金转账失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '转账失败' },
      { status: 500 }
    );
  }
}

// 搜索可转账用户 - 支持按用户名/手机号/专属ID搜索
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get('keyword') || '';
    const currentUserId = searchParams.get('userId') || '';

    if (!keyword || keyword.length < 1) {
      return NextResponse.json({ success: true, data: [] });
    }

    // 搜索所有用户（排除自己），按用户名/手机号/专属ID模糊匹配
    const users: any = await query(
      `SELECT id, username, role, balance, unique_id, phone, real_name 
       FROM users 
       WHERE is_active = true 
         AND id::text != $1
         AND (username ILIKE $2 OR phone ILIKE $2 OR unique_id ILIKE $2 OR real_name ILIKE $2)
       ORDER BY 
         CASE 
           WHEN username ILIKE $2 THEN 0
           WHEN phone ILIKE $2 THEN 1
           WHEN unique_id ILIKE $2 THEN 2
           ELSE 3
         END,
         username
       LIMIT 20`,
      [currentUserId, `%${keyword}%`]
    );

    const roleLabels: Record<string, string> = {
      admin: '总台',
      branch: '服务网点',
      provider: '服务商',
      member: '会员',
    };

    return NextResponse.json({
      success: true,
      data: (users || []).map((u: any) => ({
        id: u.id,
        username: u.username,
        realName: u.real_name,
        role: u.role,
        roleLabel: roleLabels[u.role] || u.role,
        balance: parseFloat(String(u.balance)) || 0,
        uniqueId: u.unique_id,
        phone: u.phone ? u.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') : '',
      })),
    });
  } catch (error) {
    console.error('搜索用户失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '搜索失败' },
      { status: 500 }
    );
  }
}
