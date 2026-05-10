import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

/**
 * 上级服务商审核第二代服务商申请
 * 
 * 审核逻辑：
 * - 同意：从自己空闲额度中拆分给新服务商，状态改为 provider_approved
 * - 拒绝：状态改为 rejected
 * - 拆分后需等待分公司二级审核才能正式变身份
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      applicationId,    // 申请ID
      action,           // approve(同意拆分额度) / reject(拒绝)
      reviewerId,       // 审核人ID（上级服务商的user_id）
      quotaAllocated,   // 拆分给新服务商的额度
      rejectReason      // 拒绝原因
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

    // 只有 pending 状态的申请可以被服务商审核
    if (application.status !== 'pending') {
      return NextResponse.json(
        { error: '该申请已处理，无需重复操作' },
        { status: 400 }
      );
    }

    // 只有第二代申请才由服务商审核
    if (application.apply_type !== 'second_gen') {
      return NextResponse.json(
        { error: '第一代服务商申请由分公司直接审核' },
        { status: 400 }
      );
    }

    // 验证审核人是上级服务商
    const reviewer = await queryOne<any>(
      `SELECT id, role FROM users WHERE id = $1`,
      [reviewerId]
    );

    if (!reviewer || reviewer.role !== 'provider') {
      return NextResponse.json(
        { error: '只有服务商才能审核此申请' },
        { status: 403 }
      );
    }

    // 验证审核人就是申请中的上级服务商
    if (application.parent_provider_id !== reviewerId) {
      return NextResponse.json(
        { error: '只有上级服务商才能审核此申请' },
        { status: 403 }
      );
    }

    if (action === 'reject') {
      // 拒绝申请
      await query(
        `UPDATE provider_applications SET status = 'rejected', reject_reason = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
        [rejectReason || '上级服务商拒绝', reviewerId, applicationId]
      );

      // 通知申请人
      const notifId = crypto.randomUUID();
      await query(
        `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, type, title, content, created_at)
         VALUES ($1, $2, 'member', $3, 'provider_apply_result', '申请被拒绝', $4, NOW())`,
        [notifId, application.user_id, reviewerId, '您申请成为服务商的请求已被上级服务商拒绝']
      );

      return NextResponse.json({
        success: true,
        message: '已拒绝申请',
      });
    }

    // 同意审核 → 拆分额度
    // 获取上级服务商的额度信息
    const parentProvider = await queryOne<any>(
      `SELECT id, user_id, quota, used_quota, (quota - used_quota) as available_quota FROM providers WHERE user_id = $1`,
      [reviewerId]
    );

    if (!parentProvider) {
      return NextResponse.json(
        { error: '上级服务商记录不存在' },
        { status: 404 }
      );
    }

    // 确定拆分额度
    const allocatedQuota = quotaAllocated || application.quota_request || 0;
    
    if (allocatedQuota <= 0) {
      return NextResponse.json(
        { error: '请指定要拆分给新服务商的额度' },
        { status: 400 }
      );
    }

    const availableQuota = parseFloat(parentProvider.available_quota || '0');
    if (allocatedQuota > availableQuota) {
      return NextResponse.json(
        { error: `额度不足，当前可拆分额度为 ${availableQuota}` },
        { status: 400 }
      );
    }

    // 扣减上级服务商额度
    const newUsedQuota = parseFloat(parentProvider.used_quota || '0') + allocatedQuota;
    await query(
      `UPDATE providers SET used_quota = $1, updated_at = NOW() WHERE user_id = $2`,
      [newUsedQuota, reviewerId]
    );

    // 更新申请状态为 provider_approved（待分公司二级审核）
    await query(
      `UPDATE provider_applications 
       SET status = 'provider_approved', quota_approved = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [allocatedQuota, reviewerId, applicationId]
    );

    // 通知分公司有新的待审核申请
    const notifId = crypto.randomUUID();
    await query(
      `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, sender_name, type, title, content, amount, related_id, created_at)
       VALUES ($1, $2, 'branch', $3, $4, 'provider_apply', '服务商申请待终审', $5, $6, $7, NOW())`,
      [notifId, application.branch_id, reviewerId, reviewer.username || '上级服务商',
       `上级服务商已同意拆分 ${allocatedQuota} 额度，请进行最终审核`, allocatedQuota, applicationId]
    );

    // 通知申请人
    const notifId2 = crypto.randomUUID();
    await query(
      `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, type, title, content, created_at)
       VALUES ($1, $2, 'member', $3, 'provider_apply_progress', '审核进度更新', $4, NOW())`,
      [notifId2, application.user_id, reviewerId, `上级服务商已同意拆分 ${allocatedQuota} 额度，正在等待分公司最终审核`]
    );

    return NextResponse.json({
      success: true,
      message: `已同意拆分 ${allocatedQuota} 额度，等待分公司最终审核`,
      data: {
        allocatedQuota,
        parentAvailableQuota: availableQuota - allocatedQuota,
      },
    });
  } catch (error) {
    console.error('服务商审核申请失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '审核失败' },
      { status: 500 }
    );
  }
}

/**
 * 获取服务商待审核的申请列表
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');
    const status = searchParams.get('status');

    if (!providerId) {
      return NextResponse.json(
        { error: '服务商ID不能为空' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT pa.*, u.username, u.phone as user_phone, u.real_name, u.energy_value
      FROM provider_applications pa
      JOIN users u ON pa.user_id = u.id
      WHERE pa.parent_provider_id = $1
    `;
    const params: any[] = [providerId];

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
