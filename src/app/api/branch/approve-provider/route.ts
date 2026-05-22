import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

/**
 * 服务网点审核服务商申请
 * 
 * 新逻辑（二级审核）：
 * - 第一代申请：status=pending → 直接审核通过/拒绝
 * - 第二代申请：status=provider_approved → 服务网点最终审核
 * 
 * 通过后执行：
 * 1. 更新用户角色为 provider
 * 2. 创建 providers 记录（继承拆分额度）
 * 3. 迁移该会员所有直推会员的 provider_id 到新服务商
 * 4. 无保证金逻辑
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      applicationId,    // 申请ID
      action,           // approve(通过) / reject(拒绝)
      reviewerId,       // 审核人ID（服务网点）
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

    // 验证审核人是服务网点
    const reviewer = await queryOne<any>(
      `SELECT id, role FROM users WHERE id = $1`,
      [reviewerId]
    );

    if (!reviewer || reviewer.role !== 'branch') {
      return NextResponse.json(
        { error: '只有服务网点才能审核服务商申请' },
        { status: 403 }
      );
    }

    // 验证审核人是否有权限审核该申请
    if (application.branch_id !== reviewerId) {
      return NextResponse.json(
        { error: '您没有权限审核该申请' },
        { status: 403 }
      );
    }

    // 根据申请类型和当前状态判断是否可审核
    if (application.apply_type === 'first_gen') {
      // 第一代：直接审核，只接受 pending 状态
      if (application.status !== 'pending') {
        return NextResponse.json(
          { error: '该申请已处理，无需重复操作' },
          { status: 400 }
        );
      }
    } else if (application.apply_type === 'second_gen') {
      // 第二代：需要上级服务商先审核（provider_approved），服务网点再终审
      if (application.status !== 'provider_approved') {
        if (application.status === 'pending') {
          return NextResponse.json(
            { error: '该申请尚未经上级服务商审核，请等待上级服务商先审核' },
            { status: 400 }
          );
        }
        return NextResponse.json(
          { error: '该申请已处理，无需重复操作' },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { error: '申请类型无效' },
        { status: 400 }
      );
    }

    if (action === 'reject') {
      // 拒绝申请
      // 如果是第二代且上级已拆分额度，需要退回额度给上级服务商
      if (application.apply_type === 'second_gen' && application.quota_approved > 0 && application.parent_provider_id) {
        const parentProvider = await queryOne<any>(
          `SELECT used_quota FROM providers WHERE user_id = $1`,
          [application.parent_provider_id]
        );
        if (parentProvider) {
          const newUsedQuota = parseFloat(parentProvider.used_quota || '0') - application.quota_approved;
          await query(
            `UPDATE providers SET used_quota = $1, updated_at = NOW() WHERE user_id = $2`,
            [Math.max(0, newUsedQuota), application.parent_provider_id]
          );
        }
      }

      // 更新申请状态
      await query(
        `UPDATE provider_applications SET status = 'rejected', reject_reason = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
        [note || '服务网点拒绝申请', reviewerId, applicationId]
      );

      // 通知申请人
      const notifId = crypto.randomUUID();
      await query(
        `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, type, title, content, created_at)
         VALUES ($1, $2, 'member', $3, 'provider_apply_result', '申请被拒绝', $4, NOW())`,
        [notifId, application.user_id, reviewerId, '您申请成为服务商的请求已被服务网点拒绝']
      );

      return NextResponse.json({
        success: true,
        message: '已拒绝申请',
      });
    }

    // === 通过申请 ===
    
    // 1. 更新用户角色为 provider
    await query(
      `UPDATE users SET role = 'provider', updated_at = NOW() WHERE id = $1`,
      [application.user_id]
    );

    // 2. 创建 providers 记录
    const providerId = crypto.randomUUID();
    // 第二代申请：额度从上级拆分而来；第一代申请：初始额度为0，需另行分配
    const initialQuota = application.apply_type === 'second_gen' ? (application.quota_approved || 0) : 0;
    const parentProviderId = application.parent_provider_id || null;
    
    await query(
      `INSERT INTO providers (id, user_id, branch_id, quota, used_quota, total_sales, parent_provider_id, split_count, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 0, 0, $5, 0, true, NOW(), NOW())`,
      [providerId, application.user_id, application.branch_id, initialQuota, parentProviderId]
    );

    // 3. 迁移该会员所有直推会员的 provider_id 到新服务商
    // 使用递归 CTE 查找所有直推下级（仅直推，不含间推）
    const directReferrals = await query<any>(
      `SELECT id FROM users WHERE inviter_id = $1 AND role = 'member'`,
      [application.user_id]
    );

    let migratedCount = 0;
    if (directReferrals && directReferrals.length > 0) {
      for (const referral of directReferrals) {
        await query(
          `UPDATE users SET provider_id = $1, updated_at = NOW() WHERE id = $2 AND inviter_id = $3`,
          [application.user_id, referral.id, application.user_id]
        );
        migratedCount++;
      }
    }

    // 4. 更新申请状态为 approved
    await query(
      `UPDATE provider_applications SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [reviewerId, applicationId]
    );

    // 5. 发送通知给新服务商
    const notifId = crypto.randomUUID();
    await query(
      `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, type, title, content, created_at)
       VALUES ($1, $2, 'provider', $3, 'provider_apply_result', '申请已通过', $4, NOW())`,
      [notifId, application.user_id, reviewerId, 
       `恭喜！您已成为服务商。${initialQuota > 0 ? `初始额度：${initialQuota}。` : ''}${migratedCount > 0 ? `已迁移 ${migratedCount} 个直推会员到您的体系。` : ''}`]
    );

    return NextResponse.json({
      success: true,
      message: `已通过申请，用户已成为服务商。${migratedCount > 0 ? `已迁移 ${migratedCount} 个直推会员。` : ''}`,
      data: {
        providerId,
        initialQuota,
        migratedMembers: migratedCount,
      },
    });
  } catch (error) {
    console.error('服务网点审核服务商申请失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '审核失败' },
      { status: 500 }
    );
  }
}

/**
 * 获取服务网点的服务商申请列表
 * 支持 pending（一代待审）和 provider_approved（二代待终审）两种状态
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
      SELECT pa.*, u.username, u.phone as user_phone, u.real_name, 0 as energy_value,
             pp.username as parent_provider_name
      FROM provider_applications pa
      JOIN users u ON pa.user_id = u.id
      LEFT JOIN users pp ON pa.parent_provider_id = pp.id
      WHERE pa.branch_id = $1
    `;
    const params: any[] = [branchId];

    if (status) {
      sql += ` AND pa.status = $2`;
      params.push(status);
    } else {
      // 默认显示待审核的（pending + provider_approved）
      sql += ` AND pa.status IN ('pending', 'provider_approved')`;
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
