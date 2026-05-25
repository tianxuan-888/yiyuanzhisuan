import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 审批申请
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { applicationId, action, reviewerId, note } = body;

    if (!applicationId || !action) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 获取申请信息
    const applications = await query(
      `SELECT * FROM quota_applications WHERE id = $1`,
      [applicationId]
    );

    if (applications.length === 0) {
      return NextResponse.json(
        { success: false, error: '申请不存在' },
        { status: 404 }
      );
    }

    const application = applications[0];

    if (application.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: '该申请已处理' },
        { status: 400 }
      );
    }

    if (action === 'approve') {
      // 同意申请 - 下发额度
      // 智算中心管理员ID
      const ADMIN_ID = '00000000-0000-0000-0000-000000000001';
      const amount = application.amount;

      // 检查智算中心余额
      const adminAccount = await query(
        `SELECT balance FROM quota_accounts WHERE user_id = $1`,
        [ADMIN_ID]
      );

      if (adminAccount.length === 0 || Number(adminAccount[0].balance) < Number(amount)) {
        return NextResponse.json(
          { success: false, error: '智算中心额度不足' },
          { status: 400 }
        );
      }

      // 扣除智算中心余额
      await query(
        `UPDATE quota_accounts SET 
          balance = balance - $1, 
          total_out = total_out + $1,
          updated_at = NOW()
        WHERE user_id = $2`,
        [amount, ADMIN_ID]
      );

      // 增加服务网点余额
      await query(
        `INSERT INTO quota_accounts (user_id, balance, total_in, total_out, created_at, updated_at)
         VALUES ($1, $2, $3, 0, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           balance = quota_accounts.balance + $2,
           total_in = quota_accounts.total_in + $3,
           updated_at = NOW()`,
        [application.applicant_id, amount, amount]
      );

      // 记录流转
      await query(
        `INSERT INTO quota_records (from_user_id, to_user_id, amount, type, note)
         VALUES ($1, $2, $3, 'transfer', $4)`,
        [ADMIN_ID, application.applicant_id, amount, '服务网点申请通过: ' + (note || '')]
      );

      // 更新申请状态
      await query(
        `UPDATE quota_applications SET status = 'approved', reviewed_at = NOW(), note = COALESCE(note, '') || ' | ' || $1 WHERE id = $2`,
        [note || '审批通过', applicationId]
      );

      return NextResponse.json({
        success: true,
        message: '申请已通过，额度已下发',
      });
    } else if (action === 'reject') {
      // 拒绝申请
      await query(
        `UPDATE quota_applications SET status = 'rejected', reviewed_at = NOW(), note = COALESCE(note, '') || ' | 拒绝: ' || $1 WHERE id = $2`,
        [note || '', applicationId]
      );

      return NextResponse.json({
        success: true,
        message: '申请已拒绝',
      });
    }

    return NextResponse.json(
      { success: false, error: '无效的操作' },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
