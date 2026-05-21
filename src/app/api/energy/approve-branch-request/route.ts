import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 智算总台审核服务网点能量值申请
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { requestId, adminId, action, note } = body;

    if (!requestId || !adminId || !action) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json(
        { success: false, error: '无效的操作类型' },
        { status: 400 }
      );
    }

    // 查询申请记录
    const requests = await query(
      `SELECT r.*, u.username as branch_name
       FROM energy_branch_requests r
       JOIN users u ON u.id = r.branch_id
       WHERE r.id::text = $1`,
      [requestId]
    );

    if (requests.length === 0) {
      return NextResponse.json(
        { success: false, error: '申请记录不存在' },
        { status: 404 }
      );
    }

    const requestRecord = requests[0];

    if (requestRecord.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: '该申请已被处理' },
        { status: 400 }
      );
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const branchId = requestRecord.branch_id;
    const requestAmount = Number(requestRecord.amount);

    if (action === 'approve') {
      // 检查智算总台能量值余额
      const adminAccount = await query(
        `SELECT ea.balance::text as balance 
         FROM energy_accounts ea 
         WHERE ea.user_id = (SELECT id FROM users WHERE role = 'admin' LIMIT 1)`
      );
      const adminBalance = adminAccount.length > 0 ? parseFloat(adminAccount[0].balance || '0') : 0;

      if (adminBalance < requestAmount) {
        return NextResponse.json(
          { success: false, error: `智算总台能量值余额不足（余额：${adminBalance.toLocaleString()}）` },
          { status: 400 }
        );
      }

      // 1. 扣除智算总台能量值
      await query(
        `UPDATE energy_accounts 
         SET balance = balance - $1,
             total_out = total_out + $1,
             updated_at = NOW()
         WHERE user_id = (SELECT id FROM users WHERE role = 'admin' LIMIT 1)`,
        [requestAmount]
      );

      // 2. 增加服务网点能量值
      await query(
        `INSERT INTO energy_accounts (user_id, balance, total_in, total_out, created_at, updated_at)
         VALUES ($1, 0, 0, 0, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           balance = energy_accounts.balance + $2,
           total_in = energy_accounts.total_in + $2,
           updated_at = NOW()`,
        [branchId, requestAmount]
      );

      // 3. 记录能量值流水（从智算总台转出）
      await query(
        `INSERT INTO energy_transactions
         (id, user_id, type, amount, energy_before, energy_after, note, status, created_at)
         VALUES ($1, (SELECT id FROM users WHERE role = 'admin' LIMIT 1), 'transfer_out', $2, $3::numeric, $4::numeric, $5, 'completed', NOW())`,
        [
          crypto.randomUUID(),
          requestAmount,
          adminBalance.toString(),
          (adminBalance - requestAmount).toString(),
          `向服务网点 ${requestRecord.branch_name} 下发能量值 ${requestAmount.toLocaleString()}`
        ]
      );

      // 4. 获取服务网点更新后的余额
      const branchAccount = await query(
        `SELECT balance FROM energy_accounts WHERE user_id = $1`,
        [branchId]
      );
      const branchBalance = branchAccount.length > 0 ? Number(branchAccount[0].balance || 0) : 0;

      // 5. 记录服务网点能量值流水（从智算总台转入）
      await query(
        `INSERT INTO energy_transactions
         (id, user_id, type, amount, energy_before, energy_after, note, status, created_at)
         VALUES ($1, $2, 'transfer_in', $3, $4::numeric, $5::numeric, $6, 'completed', NOW())`,
        [
          crypto.randomUUID(),
          branchId,
          requestAmount,
          (branchBalance - requestAmount).toString(),
          branchBalance.toString(),
          `收到智算总台下发能量值 ${requestAmount.toLocaleString()}`
        ]
      );

      // 6. 发送通知给服务网点
      await query(
        `INSERT INTO notifications 
         (id, receiver_id, receiver_role, sender_id, type, title, content, created_at)
         VALUES ($1, $2, 'branch', $3, 'energy_granted', '能量值已到账', $4, NOW())`,
        [
          crypto.randomUUID(),
          branchId,
          adminId,
          `您的能量值申请已通过，已到账 ${requestAmount.toLocaleString()} 能量值`
        ]
      );
    }

    // 更新申请状态
    await query(
      `UPDATE energy_branch_requests 
       SET status = $1, reviewer_id = $2, reviewer_note = $3, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [newStatus, adminId, note || null, requestId]
    );

    const actionText = action === 'approve' ? '通过' : '拒绝';
    const message = action === 'approve' 
      ? `已通过申请，已向 ${requestRecord.branch_name} 下发 ${requestAmount.toLocaleString()} 能量值`
      : `已拒绝 ${requestRecord.branch_name} 的能量值申请`;

    return NextResponse.json({
      success: true,
      message,
      data: {
        requestId,
        status: newStatus,
        amount: requestAmount,
        branchName: requestRecord.branch_name,
        reviewedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('审核能量值申请失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '审核失败' },
      { status: 500 }
    );
  }
}
