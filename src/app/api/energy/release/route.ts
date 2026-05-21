import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { execute, queryOne } from '@/lib/pg-client';

// 能量值下发（智算总台 → 服务网点 → 服务商）
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅管理员和服务网点可操作
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'branch'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { fromUserId, toUserId, amount, note } = body;

    // 参数验证
    if (!fromUserId || !toUserId || !amount || amount <= 0) {
      return NextResponse.json({ success: false, error: '参数不完整或金额无效' }, { status: 400 });
    }

    // 验证操作者权限
    if (user.role !== 'admin' && user.userId !== fromUserId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    // 查询转出方用户信息
    const fromUser = await queryOne(
      `SELECT id, username, role, energy_value FROM users WHERE id = $1`,
      [fromUserId]
    );

    if (!fromUser) {
      return NextResponse.json({ success: false, error: '转出方用户不存在' }, { status: 404 });
    }

    // 验证角色权限：只有 admin 和 branch 可以释放能量值
    if (fromUser.role !== 'admin' && fromUser.role !== 'branch') {
      return NextResponse.json({ success: false, error: '只有智算总台和服务网点可以释放能量值' }, { status: 403 });
    }

    // 查询接收方用户信息
    const toUser = await queryOne(
      `SELECT id, username, role, energy_value FROM users WHERE id = $1`,
      [toUserId]
    );

    if (!toUser) {
      return NextResponse.json({ success: false, error: '接收方用户不存在' }, { status: 404 });
    }

    // 检查能量值是否足够
    const fromEnergy = parseFloat(fromUser.energy_value || '0');
    if (fromEnergy < amount) {
      return NextResponse.json({
        success: false,
        error: '能量值余额不足',
        data: { required: amount, current: fromEnergy, short: amount - fromEnergy }
      }, { status: 400 });
    }

    const toEnergy = parseFloat(toUser.energy_value || '0');

    // 扣除转出方能量值（使用SQL直接更新）
    await execute(
      `UPDATE users SET energy_value = energy_value - $1, updated_at = NOW() WHERE id = $2`,
      [amount, fromUserId]
    );

    // 增加接收方能量值
    await execute(
      `UPDATE users SET energy_value = energy_value + $1, updated_at = NOW() WHERE id = $2`,
      [amount, toUserId]
    );

    // 更新 energy_accounts
    await execute(
      `UPDATE energy_accounts SET balance = balance - $1, total_out = total_out + $1, updated_at = NOW() WHERE user_id = $2`,
      [amount, fromUserId]
    ).catch(() => {/* 可能没有账户记录 */});

    await execute(
      `UPDATE energy_accounts SET balance = balance + $1, total_in = total_in + $1, updated_at = NOW() WHERE user_id = $2`,
      [amount, toUserId]
    ).catch(() => {/* 可能没有账户记录 */});

    // 记录流水
    await execute(
      `INSERT INTO energy_transactions (id, type, amount, from_user_id, to_user_id, note, status, created_at) VALUES (gen_random_uuid(), 'release', $1, $2, $3, $4, 'completed', NOW())`,
      [amount, fromUserId, toUserId, note || '能量值下发']
    );

    return NextResponse.json({
      success: true,
      message: '能量值下发成功',
      data: {
        fromEnergy: fromEnergy - amount,
        toEnergy: toEnergy + amount,
        amount
      }
    });
  } catch (error) {
    console.error('能量值下发失败:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
