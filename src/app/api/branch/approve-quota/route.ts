import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

/**
 * 服务网点确认发放额度
 * 确认收款后，将额度分配给服务商
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // 支持两种格式：requestId 或 request_id
    const requestId = body.requestId || body.request_id;
    const action = body.action;
    const reviewerId = body.reviewerId || body.reviewer_id;
    const approvedAmount = body.approvedAmount || body.approved_amount;
    const note = body.note || body.reject_reason;

    // 参数验证
    if (!requestId || !action || !reviewerId) {
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
    const quotaRequest = await queryOne<any>(
      `SELECT * FROM quota_requests WHERE id = $1`,
      [requestId]
    );

    if (!quotaRequest) {
      return NextResponse.json(
        { error: '申请记录不存在' },
        { status: 404 }
      );
    }

    if (quotaRequest.status !== 'pending') {
      return NextResponse.json(
        { error: '该申请已处理，无需重复操作' },
        { status: 400 }
      );
    }

    // 验证审核人是服务网点
    const reviewer = await queryOne<any>(
      `SELECT id, role FROM users WHERE id = $1`,
      [reviewerId]
    );

    if (!reviewer || reviewer.role !== 'branch') {
      return NextResponse.json(
        { error: '只有服务网点才能审批额度申请' },
        { status: 403 }
      );
    }

    // 验证审核人是否有权限（申请归属该服务网点）
    if (quotaRequest.parent_id !== reviewerId) {
      return NextResponse.json(
        { error: '您没有权限审批该申请' },
        { status: 403 }
      );
    }

    if (action === 'reject') {
      // 拒绝申请
      await query(
        `UPDATE quota_requests SET status = 'rejected', reject_reason = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
        [note || '申请被拒绝', reviewerId, requestId]
      );

      // 发送通知
      const notifId = crypto.randomUUID();
      await query(
        `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, type, title, content, created_at)
         VALUES ($1, $2, 'provider', $3, 'quota_result', '额度申请被拒绝', $4, NOW())`,
        [notifId, quotaRequest.requester_id, reviewerId, `您的额度申请已被拒绝${note ? '：' + note : ''}。请重新申请。`]
      );

      return NextResponse.json({
        success: true,
        message: '已拒绝申请',
      });
    }

    // 通过申请：发放额度（使用申请时请求的金额）
    const finalAmount = parseFloat(quotaRequest.requested_amount);

    // 1. 更新申请状态
    await query(
      `UPDATE quota_requests SET status = 'approved', approved_amount = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [finalAmount, reviewerId, requestId]
    );

    // 2. 在 quota_allocations 表创建分配记录
    const allocationId = crypto.randomUUID();
    await query(
      `INSERT INTO quota_allocations (id, branch_id, provider_id, template_id, quota_amount, used_amount, status, created_at, updated_at)
       VALUES ($1, $2, $3, NULL, $4, 0, 'active', NOW(), NOW())`,
      [allocationId, quotaRequest.parent_id, quotaRequest.requester_id, finalAmount]
    );

    // 3. 减少服务网点的额度（从 quota_accounts 表扣除）
    await query(
      `UPDATE quota_accounts SET 
        balance = balance - $1, 
        total_out = total_out + $1,
        updated_at = NOW()
       WHERE user_id = $2`,
      [finalAmount, quotaRequest.parent_id]
    );

    // 4. 增加服务商的额度
    await query(
      `UPDATE providers SET quota = quota + $1, updated_at = NOW() WHERE user_id = $2`,
      [finalAmount, quotaRequest.requester_id]
    );

    // 5. 发送通知给服务商
    const notifId = crypto.randomUUID();
    await query(
      `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, type, title, content, amount, related_id, created_at)
       VALUES ($1, $2, 'provider', $3, 'quota_result', '额度已发放', $4, $5, $6, NOW())`,
      [notifId, quotaRequest.requester_id, reviewerId, `恭喜！已发放额度 ${finalAmount.toLocaleString()} 元，请前往生成产品。`, finalAmount, requestId]
    );

    // 获取服务商当前额度
    const provider = await queryOne<any>(
      `SELECT quota, used_quota FROM providers WHERE user_id = $1`,
      [quotaRequest.requester_id]
    );

    return NextResponse.json({
      success: true,
      message: `已发放额度 ${finalAmount.toLocaleString()} 元`,
      data: {
        approved_amount: finalAmount,
        total_quota: provider ? parseFloat(provider.quota) : 0,
        used_quota: provider ? parseFloat(provider.used_quota) : 0,
      },
    });
  } catch (error) {
    console.error('额度审批失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '审批失败' },
      { status: 500 }
    );
  }
}

/**
 * 获取服务网点的额度申请列表
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    const status = searchParams.get('status');

    if (!branchId) {
      return NextResponse.json(
        { error: '服务网点ID不能为空' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT qr.*, u.username as requester_name, u.phone as requester_phone
      FROM quota_requests qr
      JOIN users u ON qr.requester_id = u.id
      WHERE qr.parent_id = $1 AND qr.requester_type = 'provider'
    `;
    const params: any[] = [branchId];

    if (status) {
      sql += ` AND qr.status = $2`;
      params.push(status);
    }

    sql += ` ORDER BY qr.created_at DESC`;

    const requests = await query(sql, params);

    return NextResponse.json({
      success: true,
      data: requests || [],
    });
  } catch (error) {
    console.error('获取额度申请列表失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取申请列表失败' },
      { status: 500 }
    );
  }
}
