import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

// 保证金金额
const PROVIDER_DEPOSIT = 2800;

/**
 * 会员申请成为服务商
 * 流程：申请 → 缴纳2800保证金 → 分公司审核 → 通过后成为服务商
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      userId,           // 申请人ID
      apply_type,       // 申请类型: first_gen(第一代) / second_gen(第二代)
      parent_provider_id, // 上级服务商ID（二代申请必填）
      branch_id,        // 申请加入的分公司ID
      real_name,        // 真实姓名
      phone,            // 手机号
      note              // 备注
    } = body;

    // 参数验证
    if (!userId) {
      return NextResponse.json(
        { error: '用户ID不能为空' },
        { status: 400 }
      );
    }

    if (!apply_type || !['first_gen', 'second_gen'].includes(apply_type)) {
      return NextResponse.json(
        { error: '申请类型无效，请选择：第一代 或 第二代' },
        { status: 400 }
      );
    }

      // 验证申请人是否存在且是会员
    console.log('查询用户:', userId);
    const applicant = await queryOne<any>(
      `SELECT id, username, role, branch_id, energy_value, balance FROM users WHERE id = $1`,
      [userId]
    );
    console.log('申请人结果:', applicant);

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

    // 检查用户是否已经是服务商
    if (applicant.role === 'provider') {
      return NextResponse.json(
        { error: '您已经是服务商，无需重复申请' },
        { status: 400 }
      );
    }

    // 如果是第一代申请，需要验证分公司
    let targetBranchId = branch_id;
    if (apply_type === 'first_gen') {
      if (!branch_id) {
        return NextResponse.json(
          { error: '请选择要加入的分公司' },
          { status: 400 }
        );
      }
      
      // 验证分公司是否存在（从 users 表查询 role='branch'）
      const branch = await queryOne<any>(
        `SELECT id FROM users WHERE id = $1 AND role = 'branch'`,
        [branch_id]
      );
      
      console.log('验证分公司:', branch_id, branch);

      if (!branch) {
        return NextResponse.json(
          { error: '分公司不存在' },
          { status: 404 }
        );
      }
    } else {
      // 第二代申请，需要验证上级服务商
      if (!parent_provider_id) {
        return NextResponse.json(
          { error: '请选择上级服务商' },
          { status: 400 }
        );
      }

      // 验证上级服务商是否存在
      const parentProvider = await queryOne<any>(
        `SELECT id, role, branch_id FROM users WHERE id = $1`,
        [parent_provider_id]
      );

      if (!parentProvider || parentProvider.role !== 'provider') {
        return NextResponse.json(
          { error: '上级服务商不存在' },
          { status: 404 }
        );
      }

      // 二代服务商继承上级服务商的分公司
      targetBranchId = parentProvider.branch_id;
    }

    // 检查是否有待处理的申请
    const existingApplication = await queryOne<any>(
      `SELECT id FROM provider_applications WHERE user_id = $1 AND status = 'pending'`,
      [userId]
    );

    if (existingApplication) {
      return NextResponse.json(
        { error: '您已有待处理的申请，请等待审批' },
        { status: 400 }
      );
    }

    // 检查用户余额是否足够缴纳保证金
    const userBalance = parseFloat(applicant.balance || '0');
    if (userBalance < PROVIDER_DEPOSIT) {
      return NextResponse.json({
        success: false,
        error: `保证金不足，需要缴纳 ${PROVIDER_DEPOSIT} 元`,
        data: {
          required: PROVIDER_DEPOSIT,
          current: userBalance,
          short: PROVIDER_DEPOSIT - userBalance,
        },
      }, { status: 400 });
    }

    // 扣除保证金
    const newBalance = userBalance - PROVIDER_DEPOSIT;
    await query(
      `UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`,
      [newBalance, userId]
    );

    // 记录交易
    await query(
      `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, created_at)
       VALUES ($1, 'deposit', $2, $3, $4, $5, NOW())`,
      [userId, -PROVIDER_DEPOSIT, userBalance, newBalance, '缴纳服务商保证金']
    );

    // 创建申请记录
    const applicationId = crypto.randomUUID();
    await query(
      `INSERT INTO provider_applications (id, user_id, applicant_name, phone, apply_type, parent_provider_id, branch_id, quota_request, quota_approved, deposit_amount, deposit_paid, status, note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, $8, true, 'pending', $9, NOW())`,
      [applicationId, userId, real_name || applicant.username, phone, apply_type, parent_provider_id, targetBranchId, PROVIDER_DEPOSIT, note]
    );

    // 发送通知给分公司
    const notifId = crypto.randomUUID();
    await query(
      `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, sender_name, type, title, content, amount, related_id, created_at)
       VALUES ($1, $2, 'branch', $3, $4, 'provider_apply', '服务商申请', $5, $6, $7, NOW())`,
      [notifId, targetBranchId, userId, applicant.username, `${applicant.username} 申请成为服务商，已缴纳保证金 ${PROVIDER_DEPOSIT} 元`, PROVIDER_DEPOSIT, applicationId]
    );

    return NextResponse.json({
      success: true,
      data: {
        application_id: applicationId,
        deposit_amount: PROVIDER_DEPOSIT,
        remaining_balance: newBalance,
        status: 'pending',
        message: `已缴纳保证金 ${PROVIDER_DEPOSIT} 元，申请已提交，请等待分公司审批`,
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
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: '用户ID不能为空' },
        { status: 400 }
      );
    }

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
