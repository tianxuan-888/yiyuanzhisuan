import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 总公司创建能量值（不能超过下发给分公司额度总和的30%）
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅管理员可操作
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['admin'])) {
      return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, amount, note } = body;

    // 参数验证
    if (!userId || !amount) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 验证是总公司操作
    const users = await query<{
      id: string;
      username: string;
      role: string;
    }>(
      'SELECT id, username, role FROM users WHERE id = $1',
      [userId]
    );

    if (!users || users.length === 0) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      );
    }

    const user = users[0];

    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: '只有总公司管理员可以执行此操作' },
        { status: 403 }
      );
    }

    // 查询分公司列表
    const branches = await query<{ id: string }>(
      `SELECT u.id FROM users u WHERE u.role = 'branch'`
    );

    // 计算下发给分公司的额度总和（从 quota_accounts 表）
    let totalAllocatedQuota = 0;
    if (branches.length > 0) {
      const branchIds = branches.map(b => `'${b.id}'`).join(',');
      const quotaData = await query(
        `SELECT COALESCE(SUM(total_in), 0) as total_allocated FROM quota_accounts WHERE user_id IN (${branchIds})`
      );
      totalAllocatedQuota = parseFloat(quotaData[0]?.total_allocated || 0);
    }

    // 下发额度的30%作为创建上限
    const maxCreateAmount = totalAllocatedQuota * 0.3;

    const createAmount = parseFloat(amount);
    if (isNaN(createAmount) || createAmount <= 0) {
      return NextResponse.json(
        { error: '创建金额必须大于0' },
        { status: 400 }
      );
    }

    // 验证不能超过下发额度的30%
    if (totalAllocatedQuota > 0 && createAmount > maxCreateAmount) {
      return NextResponse.json(
        { error: `创建金额不能超过下发额度的30%（下发额度：${totalAllocatedQuota.toLocaleString()}，上限：${maxCreateAmount.toLocaleString()}）` },
        { status: 400 }
      );
    }

    // 获取当前能量值（从 energy_accounts 表）
    const currentAccount = await query(
      'SELECT balance FROM energy_accounts WHERE user_id = $1',
      [userId]
    );
    const currentEnergy = currentAccount.length > 0 ? Number(currentAccount[0].balance || 0) : 0;

    // 增加能量值（使用 energy_accounts 表）
    await query(
      `INSERT INTO energy_accounts (user_id, balance, total_in, total_out, created_at, updated_at)
       VALUES ($1, $2, $3, 0, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         balance = energy_accounts.balance + $2,
         total_in = energy_accounts.total_in + $3,
         updated_at = NOW()`,
      [userId, createAmount, createAmount]
    );

    // 记录能量值创建流水（类型为 create）
    await query(
      `INSERT INTO energy_transactions 
       (id, user_id, type, amount, energy_before, energy_after, related_user_id, note, status, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        crypto.randomUUID(),
        userId,
        'create',
        createAmount,
        currentEnergy.toFixed(2),
        (currentEnergy + createAmount).toFixed(2),
        userId,
        note || '总公司创建能量值',
        'completed'
      ]
    );

    return NextResponse.json({
      success: true,
      message: `成功创建 ${createAmount.toLocaleString()} 能量值`,
      data: {
        user: {
          id: userId,
          username: user.username,
          new_energy: currentEnergy + createAmount,
        },
        created_amount: createAmount,
        total_allocated_quota: totalAllocatedQuota,
        max_create_amount: maxCreateAmount,
      },
    });
  } catch (error) {
    console.error('创建能量值失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建失败' },
      { status: 500 }
    );
  }
}
