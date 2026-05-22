import { NextRequest, NextResponse } from 'next/server';
import { query, execute } from '@/storage/database/pg-client';

// 智算总台向服务网点分配额度（1:1，无赠送）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { adminId, branchId, amount, note } = body;

    if (!adminId || !branchId || !amount) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 验证是智算总台操作
    const admin = await query<{ id: string; username: string; role: string }>(
      'SELECT id, username, role FROM users WHERE id = $1', [adminId]
    );

    if (!admin || admin.length === 0) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }
    if (admin[0].role !== 'admin') {
      return NextResponse.json({ error: '只有智算总台管理员可以执行此操作' }, { status: 403 });
    }

    // 验证服务网点存在
    const branch = await query<{ id: string; username: string; role: string }>(
      'SELECT id, username, role FROM users WHERE id = $1', [branchId]
    );

    if (!branch || branch.length === 0) {
      return NextResponse.json({ error: '服务网点不存在' }, { status: 404 });
    }
    if (branch[0].role !== 'branch') {
      return NextResponse.json({ error: '目标用户不是服务网点' }, { status: 400 });
    }

    const allocateAmount = parseFloat(amount);
    if (isNaN(allocateAmount) || allocateAmount <= 0) {
      return NextResponse.json({ error: '分配额度必须大于0' }, { status: 400 });
    }

    // 验证智算总台可用额度
    const companyQuota = await query<{ id: string; total_quota: number; used_quota: number; available_quota: number }>(
      'SELECT id, total_quota, used_quota, available_quota FROM company_quota LIMIT 1'
    );

    if (!companyQuota || companyQuota.length === 0) {
      return NextResponse.json({ error: '智算总台额度记录不存在' }, { status: 500 });
    }

    const availableQuota = Number(companyQuota[0].available_quota || 0);
    if (allocateAmount > availableQuota) {
      return NextResponse.json({ error: `智算总台可用额度不足，当前可用 ${availableQuota.toLocaleString()} 元` }, { status: 400 });
    }

    // ========== 1:1 分配 ==========

    // 1. 扣减智算总台额度
    await execute(
      `UPDATE company_quota SET used_quota = used_quota + $1, available_quota = available_quota - $1 WHERE id = $2`,
      [allocateAmount, companyQuota[0].id || '1']
    );

    // 2. 增加服务网点额度（quota_accounts）
    await execute(
      `INSERT INTO quota_accounts (user_id, balance, total_in, total_out, created_at, updated_at)
       VALUES ($1, $2, $3, 0, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         balance = quota_accounts.balance + $2,
         total_in = quota_accounts.total_in + $3,
         updated_at = NOW()`,
      [branchId, allocateAmount, allocateAmount]
    );

    // 3. 记录分配记录（quota_records）
    await execute(
      `INSERT INTO quota_records (id, from_user_id, to_user_id, amount, type, note, created_at)
       VALUES ($1, $2, $3, $4, 'allocate', $5, NOW())`,
      [crypto.randomUUID(), adminId, branchId, allocateAmount, note || `智算总台分配额度给服务网点 ${branch[0].username}`]
    );

    // 4. 发送通知
    await execute(
      `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, type, title, content, created_at)
       VALUES ($1, $2, 'branch', $3, 'quota_allocated', '额度已到账', $4, NOW())`,
      [crypto.randomUUID(), branchId, adminId, `智算总台已分配额度 ${allocateAmount.toLocaleString()} 元到您的账户。`]
    );

    return NextResponse.json({
      success: true,
      message: `已成功分配额度 ${allocateAmount.toLocaleString()} 元给 ${branch[0].username}`,
      data: {
        allocated_amount: allocateAmount,
        company_quota_available: Number(companyQuota[0].available_quota) - allocateAmount,
        branch_name: branch[0].username,
      },
    });
  } catch (error) {
    console.error('分配额度失败:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '分配额度失败' }, { status: 500 });
  }
}
