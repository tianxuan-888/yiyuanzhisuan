import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 智算总台向任意用户转账收益
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅管理员可操作
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['admin'])) {
      return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
    }

    const body = await request.json();
    const { fromUserId, toUserId, amount, note } = body;

    // 参数验证
    if (!fromUserId || !toUserId || !amount) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 验证是智算总台操作
    const fromUser = await query<{
      id: string;
      username: string;
      role: string;
    }>(
      'SELECT id, username, role FROM users WHERE id = $1',
      [fromUserId]
    );

    if (!fromUser || fromUser.length === 0) {
      return NextResponse.json(
        { error: '转出方用户不存在' },
        { status: 404 }
      );
    }

    if (fromUser[0].role !== 'admin') {
      return NextResponse.json(
        { error: '只有智算总台管理员可以执行此操作' },
        { status: 403 }
      );
    }

    // 验证转入方用户存在
    const toUser = await query<{
      id: string;
      username: string;
      role: string;
    }>(
      'SELECT id, username, role FROM users WHERE id = $1',
      [toUserId]
    );

    if (!toUser || toUser.length === 0) {
      return NextResponse.json(
        { error: '转入方用户不存在' },
        { status: 404 }
      );
    }

    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      return NextResponse.json(
        { error: '转账金额必须大于0' },
        { status: 400 }
      );
    }

    // 获取转出方当前收益（从 energy_accounts 表）
    const fromAccount = await query(
      'SELECT balance FROM energy_accounts WHERE user_id = $1',
      [fromUserId]
    );
    const fromEnergyValue = fromAccount.length > 0 ? Number(fromAccount[0].balance || 0) : 0;

    if (fromEnergyValue < transferAmount) {
      return NextResponse.json(
        { error: `收益不足，当前余额 ${fromEnergyValue.toLocaleString()}` },
        { status: 400 }
      );
    }

    // 获取转入方当前收益（从 energy_accounts 表）
    const toAccount = await query(
      'SELECT balance FROM energy_accounts WHERE user_id = $1',
      [toUserId]
    );
    const toEnergyValue = toAccount.length > 0 ? Number(toAccount[0].balance || 0) : 0;

    // 执行转账操作
    // 1. 扣除转出方收益
    await query(
      `INSERT INTO energy_accounts (user_id, balance, total_in, total_out, created_at, updated_at)
       VALUES ($1, 0, 0, $2, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         balance = energy_accounts.balance - $2,
         total_out = energy_accounts.total_out + $2,
         updated_at = NOW()`,
      [fromUserId, transferAmount]
    );

    // 2. 增加转入方收益
    await query(
      `INSERT INTO energy_accounts (user_id, balance, total_in, total_out, created_at, updated_at)
       VALUES ($1, $2, $3, 0, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         balance = energy_accounts.balance + $2,
         total_in = energy_accounts.total_in + $3,
         updated_at = NOW()`,
      [toUserId, transferAmount, transferAmount]
    );

    // 3. 记录转出方的收益变动
    await query(
      `INSERT INTO energy_transactions 
       (id, user_id, type, amount, energy_before, energy_after, related_user_id, note, status, from_user_id, to_user_id, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
      [
        crypto.randomUUID(),
        fromUserId,
        'manual',
        -transferAmount,
        fromEnergyValue.toFixed(2),
        (fromEnergyValue - transferAmount).toFixed(2),
        toUserId,
        note || `向 ${toUser[0].username} 转账`,
        'completed',
        fromUserId,
        toUserId
      ]
    );

    // 4. 记录转入方的收益变动
    await query(
      `INSERT INTO energy_transactions 
       (id, user_id, type, amount, energy_before, energy_after, related_user_id, note, status, from_user_id, to_user_id, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
      [
        crypto.randomUUID(),
        toUserId,
        'transfer_in',
        transferAmount,
        toEnergyValue.toFixed(2),
        (toEnergyValue + transferAmount).toFixed(2),
        fromUserId,
        `智算总台 ${fromUser[0].username} 转账`,
        'completed',
        fromUserId,
        toUserId
      ]
    );

    return NextResponse.json({
      success: true,
      message: `成功向 ${toUser[0].username} 转账 ${transferAmount.toLocaleString()} 收益`,
      data: {
        from_user: {
          id: fromUserId,
          username: fromUser[0].username,
          balance: fromEnergyValue - transferAmount,
        },
        to_user: {
          id: toUserId,
          username: toUser[0].username,
          balance: toEnergyValue + transferAmount,
        },
        amount: transferAmount,
      },
    });
  } catch (error) {
    console.error('转账失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '转账失败' },
      { status: 500 }
    );
  }
}
