import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

/**
 * 会员申请成为服务商
 * 
 * 新逻辑：
 * - 申请类型自动判断：有provider_id→第二代，无provider_id→第一代
 * - 前置条件：必须推荐3个以上有效会员
 * - 无需缴纳保证金
 * - 审核流程：
 *   第一代：pending → approved（服务网点直接审核）
 *   第二代：pending → provider_approved（上级服务商审核拆分额度）→ approved（服务网点审核正式变身份）
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      userId,           // 申请人ID
      parent_provider_id, // 上级服务商ID（二代申请时为当前所属服务商）
      branch_id,        // 申请加入的服务网点ID（一代申请必填）
      real_name,        // 真实姓名
      phone,            // 手机号
      quota_request,    // 申请额度
      note              // 备注
    } = body;

    // 参数验证
    if (!userId) {
      return NextResponse.json(
        { error: '用户ID不能为空' },
        { status: 400 }
      );
    }

    // 验证申请人是否存在且是会员
    const applicant = await queryOne<any>(
      `SELECT id, username, role, provider_id, branch_id, energy_value, balance FROM users WHERE id = $1`,
      [userId]
    );

    if (!applicant) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      );
    }

    if (applicant.role !== 'member') {
      return NextResponse.json(
        { error: '只有会员才能申请成为服务商' },
        { status: 400 }
      );
    }

    // 自动判断申请类型
    let apply_type: string;
    let targetBranchId = branch_id;
    let targetParentProviderId = parent_provider_id;

    if (applicant.provider_id) {
      // 有上级服务商 → 第二代申请
      apply_type = 'second_gen';
      targetParentProviderId = applicant.provider_id;
      
      // 获取上级服务商的服务网点ID
      const parentProvider = await queryOne<any>(
        `SELECT id, role, branch_id FROM users WHERE id = $1`,
        [applicant.provider_id]
      );

      if (!parentProvider) {
        return NextResponse.json(
          { error: '上级服务商不存在' },
          { status: 404 }
        );
      }

      targetBranchId = parentProvider.branch_id;
    } else {
      // 无上级服务商 → 第一代申请
      apply_type = 'first_gen';
      
      if (!branch_id) {
        return NextResponse.json(
          { error: '请选择要加入的服务网点' },
          { status: 400 }
        );
      }

      // 验证服务网点是否存在
      const branch = await queryOne<any>(
        `SELECT id FROM users WHERE id = $1 AND role = 'branch'`,
        [branch_id]
      );

      if (!branch) {
        return NextResponse.json(
          { error: '服务网点不存在' },
          { status: 404 }
        );
      }
    }

    // 前置条件：必须推荐3个以上有效会员
    const referralCount = await queryOne<any>(
      `SELECT COUNT(*) as count FROM users WHERE inviter_id = $1 AND is_active = true`,
      [userId]
    );
    const effectiveMembers = parseInt(referralCount?.count || '0');

    if (effectiveMembers < 3) {
      return NextResponse.json({
        success: false,
        error: `需推荐3个以上有效会员才能申请，当前已推荐 ${effectiveMembers} 个`,
        data: {
          required: 3,
          current: effectiveMembers,
        },
      }, { status: 400 });
    }

    // 检查是否有待处理的申请
    const existingApplication = await queryOne<any>(
      `SELECT id FROM provider_applications WHERE user_id = $1 AND status IN ('pending', 'provider_approved')`,
      [userId]
    );

    if (existingApplication) {
      return NextResponse.json(
        { error: '您已有待处理的申请，请等待审批' },
        { status: 400 }
      );
    }

    // 创建申请记录（无保证金）
    const applicationId = crypto.randomUUID();
    await query(
      `INSERT INTO provider_applications (id, user_id, applicant_name, phone, apply_type, parent_provider_id, branch_id, quota_request, quota_approved, deposit_amount, deposit_paid, status, note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, false, 'pending', $9, NOW())`,
      [applicationId, userId, real_name || applicant.username, phone, apply_type, targetParentProviderId, targetBranchId, quota_request || 0, note]
    );

    // 发送通知给审核方
    const reviewerId = apply_type === 'first_gen' ? targetBranchId : targetParentProviderId;
    const reviewerType = apply_type === 'first_gen' ? 'branch' : 'provider';
    const notifId = crypto.randomUUID();
    await query(
      `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, sender_name, type, title, content, amount, related_id, created_at)
       VALUES ($1, $2, $3, $4, $5, 'provider_apply', '服务商申请', $6, 0, $7, NOW())`,
      [notifId, reviewerId, reviewerType, userId, applicant.username, 
       `${applicant.username} 申请成为服务商（${apply_type === 'first_gen' ? '第一代' : '第二代'}），请及时审核`, 
       applicationId]
    );

    return NextResponse.json({
      success: true,
      data: {
        application_id: applicationId,
        apply_type,
        status: 'pending',
        message: apply_type === 'first_gen' 
          ? '申请已提交，请等待服务网点审批' 
          : '申请已提交，请等待上级服务商审批后，再由服务网点最终审核',
      },
    });
  } catch (error) {
    console.error('服务商申请失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '申请失败' },
      { status: 500 }
    );
  }
}

/**
 * 获取会员的申请记录
 * 也可用于检查推荐人数（checkEligibility参数）
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const checkEligibility = searchParams.get('checkEligibility');

    if (!userId) {
      return NextResponse.json(
        { error: '用户ID不能为空' },
        { status: 400 }
      );
    }

    // 检查申请资格
    if (checkEligibility === 'true') {
      const referralCount = await queryOne<any>(
        `SELECT COUNT(*) as count FROM users WHERE inviter_id = $1 AND is_active = true`,
        [userId]
      );
      const effectiveMembers = parseInt(referralCount?.count || '0');

      const applicant = await queryOne<any>(
        `SELECT id, role, provider_id FROM users WHERE id = $1`,
        [userId]
      );

      return NextResponse.json({
        success: true,
        data: {
          canApply: effectiveMembers >= 3 && applicant?.role === 'member',
          effectiveMembers,
          requiredMembers: 3,
          applyType: applicant?.provider_id ? 'second_gen' : 'first_gen',
          hasPendingApplication: false,
        },
      });
    }

    // 获取申请记录
    const applications = await query<any>(
      `SELECT * FROM provider_applications WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );

    return NextResponse.json({
      success: true,
      data: applications || [],
    });
  } catch (error) {
    console.error('获取申请记录失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取申请记录失败' },
      { status: 500 }
    );
  }
}
