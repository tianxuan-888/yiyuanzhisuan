import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/pg-client';
import { generateUUID } from '@/lib/utils';

// 分公司向总公司申请提现能量值
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fromUserId, toUserId, amount, note } = body;

    // 验证参数
    if (!fromUserId || !toUserId || !amount || amount <= 0) {
      return NextResponse.json(
        { success: false, error: '参数不完整或金额无效' },
        { status: 400 }
      );
    }

    // 验证操作人是否为分公司
    const fromUser = await query('SELECT * FROM users WHERE id = $1', [fromUserId]);
    if (fromUser.length === 0 || fromUser[0].role !== 'branch') {
      return NextResponse.json(
        { success: false, error: '只有分公司可以申请提现能量值' },
        { status: 403 }
      );
    }

    // 检查分公司能量值余额
    const fromAccount = await query(
      'SELECT * FROM energy_accounts WHERE user_id = $1',
      [fromUserId]
    );
    const fromBalance = fromAccount.length > 0 ? Number(fromAccount[0].balance || 0) : 0;

    if (fromBalance < amount) {
      return NextResponse.json(
        { success: false, error: '能量值余额不足' },
        { status: 400 }
      );
    }

    // 检查最低提现金额（50能量值）
    if (amount < 50) {
      return NextResponse.json(
        { success: false, error: '最低提现金额为50能量值' },
        { status: 400 }
      );
    }

    // 验证总公司账户存在
    const toAccount = await query(
      'SELECT * FROM energy_accounts WHERE user_id = $1',
      [toUserId]
    );

    // 使用事务执行
    await withTransaction(async (client) => {
      // 扣除分公司能量值
      if (fromAccount.length > 0) {
        await client.query(
          `UPDATE energy_accounts 
           SET balance = balance - $1, 
               total_out = total_out + $1,
               updated_at = NOW()
           WHERE user_id = $2`,
          [amount, fromUserId]
        );
      }

      // 增加总公司能量值
      if (toAccount.length > 0) {
        await client.query(
          `UPDATE energy_accounts 
           SET balance = balance + $1, 
               total_in = total_in + $1,
               updated_at = NOW()
           WHERE user_id = $2`,
          [amount, toUserId]
        );
      } else {
        await client.query(
          `INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out)
           VALUES ($1, $2, $3, $3, 0)`,
          [generateUUID(), toUserId, amount]
        );
      }

      // 记录流水
      const txId = generateUUID();
      await client.query(
        `INSERT INTO energy_transactions 
         (id, type, amount, from_user_id, to_user_id, note, status)
         VALUES ($1, 'withdraw', $2, $3, $4, $5, 'completed')`,
        [txId, amount, fromUserId, toUserId, note || '分公司提现能量值']
      );
    });

    // 获取最新余额
    const newFromAccount = await query(
      'SELECT balance FROM energy_accounts WHERE user_id = $1',
      [fromUserId]
    );
    const newToAccount = await query(
      'SELECT balance FROM energy_accounts WHERE user_id = $1',
      [toUserId]
    );

    return NextResponse.json({
      success: true,
      message: '能量值提现成功',
      data: {
        amount,
        fromBalance: Number(newFromAccount[0]?.balance || 0),
        toBalance: Number(newToAccount[0]?.balance || 0),
      },
    });

  } catch (error: any) {
    console.error('能量值提现失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
