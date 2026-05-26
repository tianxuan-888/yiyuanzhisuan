import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

// 智算金互转 - 从 energy_value 扣除
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
    if (transferAmount < 50) {
      return NextResponse.json({ success: false, error: '最低转账金额为50' }, { status: 400 });
    }

    // 不能转给自己
    if (fromUserId === toUserId) {
      return NextResponse.json({ success: false, error: '不能转给自己' }, { status: 400 });
    }

    // 查询转出方
    const fromUser: any = await queryOne(
      'SELECT id, username, energy_value, points, role FROM users WHERE id::text = $1',
      [fromUserId]
    );

    if (!fromUser) {
      return NextResponse.json({ success: false, error: '转出方用户不存在' }, { status: 404 });
    }

    const fromEnergy = parseFloat(String(fromUser.energy_value)) || 0;
    if (fromEnergy < transferAmount) {
      return NextResponse.json({ success: false, error: `智算金余额不足，当前余额: ${fromEnergy}` }, { status: 400 });
    }

    // 查询转入方
    const toUser: any = await queryOne(
      'SELECT id, username, energy_value, points, role FROM users WHERE id::text = $1',
      [toUserId]
    );

    if (!toUser) {
      return NextResponse.json({ success: false, error: '转入方用户不存在' }, { status: 404 });
    }

    // 1. 扣除转出方智算金
    await query(
      'UPDATE users SET energy_value = energy_value - $1 WHERE id::text = $2',
      [transferAmount, fromUserId]
    );

    // 2. 转入方获得全部智算金
    await query(
      'UPDATE users SET energy_value = energy_value + $1 WHERE id::text = $2',
      [transferAmount, toUserId]
    );

    // 3. 记录 transactions 明细 - 转出方
    await query(
      `INSERT INTO transactions (id, user_id, order_id, type, amount, status, description, created_at)
       VALUES (gen_random_uuid(), $1, NULL, 'transfer_out', $2, 'completed', $3, NOW())`,
      [fromUserId, transferAmount, JSON.stringify({
        toUser: toUser.username,
        toUserId,
        note: note || '智算金转出'
      })]
    );

    // 4. 记录 transactions 明细 - 转入方
    await query(
      `INSERT INTO transactions (id, user_id, order_id, type, amount, status, description, created_at)
       VALUES (gen_random_uuid(), $1, NULL, 'transfer_in', $2, 'completed', $3, NOW())`,
      [toUserId, transferAmount, JSON.stringify({
        fromUser: fromUser.username,
        fromUserId,
        note: note || '智算金转入'
      })]
    );

    // 5. 记录 energy_transactions 明细 - 转出方
    await query(
      `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, note, created_at)
       VALUES (gen_random_uuid(), $1, 'transfer_out', $2, $1, $3, $4, NOW())`,
      [fromUserId, transferAmount, toUserId, `转出给${toUser.username}`]
    );

    // 6. 记录 energy_transactions 明细 - 转入方
    await query(
      `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, note, created_at)
       VALUES (gen_random_uuid(), $1, 'transfer_in', $2, $3, $1, $4, NOW())`,
      [toUserId, transferAmount, fromUserId, `来自${fromUser.username}转入`]
    );

    // 查询更新后的余额
    const updatedFromUser: any = await queryOne(
      'SELECT energy_value FROM users WHERE id::text = $1',
      [fromUserId]
    );
    const updatedToUser: any = await queryOne(
      'SELECT energy_value FROM users WHERE id::text = $1',
      [toUserId]
    );

    return NextResponse.json({
      success: true,
      message: `成功转账 ${transferAmount} 智算金给 ${toUser.username}`,
      data: {
        fromEnergyValue: parseFloat(String(updatedFromUser?.energy_value)) || 0,
        toEnergyValue: parseFloat(String(updatedToUser?.energy_value)) || 0,
        amount: transferAmount,
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
      `SELECT id, username, role, energy_value, unique_id, phone, real_name 
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
        energyValue: parseFloat(String(u.energy_value)) || 0,
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
