import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 智算总台调整会员能量值
export async function POST(request: NextRequest) {
  try {
    const authUser = await authenticateRequest(request);
    if (!authUser || authUser.role !== 'admin') {
      return NextResponse.json({ success: false, error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { userId, amount, action, note } = body; // action: 'add' | 'deduct'

    if (!userId || !amount || !action) {
      return NextResponse.json({ success: false, error: '缺少必要参数' }, { status: 400 });
    }

    if (amount <= 0) {
      return NextResponse.json({ success: false, error: '金额必须大于0' }, { status: 400 });
    }

    // 查询用户当前能量值
    const userResult = await query('SELECT id, username, energy_value, role FROM users WHERE id = $1', [userId]);
    if (!userResult || userResult.length === 0) {
      return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
    }

    const user = userResult[0];
    const currentEnergy = Number(user.energy_value) || 0;

    if (action === 'deduct' && currentEnergy < amount) {
      return NextResponse.json({ success: false, error: `能量值不足，当前仅 ${currentEnergy}` }, { status: 400 });
    }

    const newEnergy = action === 'add' ? currentEnergy + amount : currentEnergy - amount;

    // 更新用户能量值
    await query('UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2', [newEnergy, userId]);

    // 更新或创建能量值账户
    const accountResult = await query('SELECT id, balance, total_in, total_out FROM energy_accounts WHERE user_id = $1', [userId]);
    if (accountResult && accountResult.length > 0) {
      const account = accountResult[0];
      const newBalance = Number(account.balance) + (action === 'add' ? amount : -amount);
      const newTotalIn = action === 'add' ? Number(account.total_in) + amount : Number(account.total_in);
      const newTotalOut = action === 'deduct' ? Number(account.total_out) + amount : Number(account.total_out);
      await query(
        'UPDATE energy_accounts SET balance = $1, total_in = $2, total_out = $3, updated_at = NOW() WHERE user_id = $4',
        [newBalance, newTotalIn, newTotalOut, userId]
      );
    } else {
      await query(
        'INSERT INTO energy_accounts (user_id, balance, total_in, total_out) VALUES ($1, $2, $3, $4)',
        [userId, action === 'add' ? amount : -amount, action === 'add' ? amount : 0, action === 'deduct' ? amount : 0]
      );
    }

    // 记录能量值流水
    const adjustNote = note || `智算总台${action === 'add' ? '增加' : '扣减'}能量值 ${amount}`;
    await query(
      `INSERT INTO energy_transactions (type, amount, from_user_id, to_user_id, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        action === 'add' ? 'manual_add' : 'manual_deduct',
        amount,
        action === 'add' ? authUser.userId : userId,
        action === 'add' ? userId : authUser.userId,
        adjustNote
      ]
    );

    // 通知用户
    await query(
      `INSERT INTO notifications (receiver_id, receiver_role, type, title, content, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        user.role,
        'energy_adjust',
        '能量值调整',
        `智算总台${action === 'add' ? '增加' : '扣减'}了您 ${amount} 能量值${note ? '，原因：' + note : ''}`,
        'unread'
      ]
    );

    return NextResponse.json({
      success: true,
      message: `已${action === 'add' ? '增加' : '扣减'} ${amount} 能量值`,
      data: {
        userId,
        previousEnergy: currentEnergy,
        newEnergy,
        action,
        amount
      }
    });
  } catch (error: any) {
    console.error('能量值调整失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
