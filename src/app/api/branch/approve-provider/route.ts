import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

/**
 * 分公司审核服务商申请
 * 通过后：用户角色改为 provider，创建 providers 记录
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      applicationId,    // 申请ID
      action,           // approve(通过) / reject(拒绝)
      reviewerId,       // 审核人ID（分公司）
      note              // 审核备注
    } = body;

    // 参数验证
    if (!applicationId || !action || !reviewerId) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: '操作无效，请选择：通过 或 拒绝' },
        { status: 400 }
      );
    }

    // 查询申请记录
    const application = await queryOne<any>(
      `SELECT * FROM provider_applications WHERE id = $1`,
      [applicationId]
    );

    if (!application) {
      return NextResponse.json(
        { error: '申请记录不存在' },
        { status: 404 }
      );
    }

    if (application.status !== 'pending') {
      return NextResponse.json(
        { error: '该申请已处理，无需重复操作' },
        { status: 400 }
      );
    }

    // 验证审核人是分公司
    const reviewer = await queryOne<any>(
      `SELECT id, role FROM users WHERE id = $1`,
      [reviewerId]
    );

    if (!reviewer || reviewer.role !== 'branch') {
      return NextResponse.json(
        { error: '只有分公司才能审核服务商申请' },
        { status: 403 }
      );
    }

    // 验证审核人是否有权限审核该申请（申请归属该分公司）
    if (application.branch_id !== reviewerId) {
      return NextResponse.json(
        { error: '您没有权限审核该申请' },
        { status: 403 }
      );
    }

    if (action === 'reject') {
      // 拒绝申请：退还保证金
      const user = await queryOne<any>(
        `SELECT balance FROM users WHERE id = $1`,
        [application.user_id]
      );

      if (user && application.deposit_paid) {
        const newBalance = parseFloat(user.balance || '0') + application.deposit_amount;
        await query(
          `UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`,
          [newBalance, application.user_id]
        );

        // 记录退款
        await query(
          `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, created_at)
           VALUES ($1, 'deposit_refund', $2, $3, $4, $5, NOW())`,
          [application.user_id, application.deposit_amount, user.balance, newBalance, '服务商申请被拒绝，保证金退还']
        );
      }

      // 更新申请状态
      await query(
        `UPDATE provider_applications SET status = 'rejected', reject_reason = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
        [note || '申请被拒绝', reviewerId, applicationId]
      );

      // 发送通知
      const notifId = crypto.randomUUID();
      await query(
        `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, type, title, content, created_at)
         VALUES ($1, $2, 'member', $3, 'provider_apply_result', '申请被拒绝', $4, NOW())`,
        [notifId, application.user_id, reviewerId, `您申请成为服务商的请求已被拒绝，保证金 ${application.deposit_amount} 元已退还`]
      );

      return NextResponse.json({
        success: true,
        message: `已拒绝申请，保证金 ${application.deposit_amount} 元已退还`,
      });
    }

    // 通过申请
    // 1. 更新用户角色为 provider
    await query(
      `UPDATE users SET role = 'provider', updated_at = NOW() WHERE id = $1`,
      [application.user_id]
    );

    // 2. 在 providers 表创建服务商记录
    const providerId = crypto.randomUUID();
    await query(
      `INSERT INTO providers (id, user_id, branch_id, quota, used_quota, total_sales, split_count, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, 0, 0, 0, 0, true, NOW(), NOW())`,
      [providerId, application.user_id, application.branch_id]
    );

    // 3. 更新申请状态
    await query(
      `UPDATE provider_applications SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [reviewerId, applicationId]
    );

    // 4. 发送通知
    const notifId = crypto.randomUUID();
    await query(
      `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, type, title, content, created_at)
       VALUES ($1, $2, 'provider', $3, 'provider_apply_result', '申请已通过', $4, NOW())`,
      [notifId, application.user_id, reviewerId, `恭喜！您已成为服务商，保证金 ${application.deposit_amount} 元已缴纳。请联系分公司申请额度。`]
    );

    return NextResponse.json({
      success: true,
      message: `已通过申请，用户已成为服务商，可申请额度`,
    });
  } catch (error) {
    console.error('审核服务商申请失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '审核失败' },
      { status: 500 }
    );
  }
}

/**
 * 获取分公司的服务商申请列表
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    const status = searchParams.get('status');

    if (!branchId) {
      return NextResponse.json(
        { error: '分公司ID不能为空' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT pa.*, u.username, u.phone as user_phone, u.real_name
      FROM provider_applications pa
      JOIN users u ON pa.user_id = u.id
      WHERE pa.branch_id = $1
    `;
    const params: any[] = [branchId];

    if (status) {
      sql += ` AND pa.status = $2`;
      params.push(status);
    }

    sql += ` ORDER BY pa.created_at DESC`;

    const applications = await query<any>(sql, params);

    return NextResponse.json({
      success: true,
      data: applications || [],
    });
  } catch (error) {
    console.error('获取申请列表失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取申请列表失败' },
      { status: 500 }
    );
  }
}
