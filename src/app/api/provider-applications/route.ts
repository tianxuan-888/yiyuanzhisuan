import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取服务商申请列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const branchId = searchParams.get('branchId');
    const providerId = searchParams.get('providerId');
    const userId = searchParams.get('userId');

    const conditions: string[] = [];
    const params: any[] = [];

    if (status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }
    if (branchId) {
      conditions.push(`branch_id = $${params.length + 1}`);
      params.push(branchId);
    }
    if (providerId) {
      conditions.push(`parent_provider_id = $${params.length + 1}`);
      params.push(providerId);
    }
    if (userId) {
      conditions.push(`user_id = $${params.length + 1}`);
      params.push(userId);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const applications = await query(
      `SELECT * FROM provider_applications 
       ${whereClause}
       ORDER BY created_at DESC`,
      params
    );

    return NextResponse.json({
      success: true,
      data: applications,
    });
  } catch (error) {
    console.error('获取申请列表失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取申请列表失败' },
      { status: 500 }
    );
  }
}

// 提交服务商申请
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, applicantName, phone, alipayAccount, applyType, parentProviderId, branchId, quotaRequest } = body;

    // 参数验证
    if (!userId || !applyType) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 验证申请类型
    if (!['first_gen', 'second_gen'].includes(applyType)) {
      return NextResponse.json(
        { error: '无效的申请类型' },
        { status: 400 }
      );
    }

    // 第二代申请必须指定上级服务商
    if (applyType === 'second_gen' && !parentProviderId) {
      return NextResponse.json(
        { error: '第二代服务商申请必须指定上级服务商' },
        { status: 400 }
      );
    }

    // 获取用户的服务网点信息（用于自动填充）
    let branchIdValue = branchId;
    if (!branchIdValue && parentProviderId) {
      const providerInfo = await query(
        'SELECT branch_id FROM providers WHERE user_id = $1',
        [parentProviderId]
      );
      if (providerInfo.length > 0) {
        branchIdValue = providerInfo[0].branch_id;
      }
    }

    // 第一代申请必须指定服务网点
    if (applyType === 'first_gen' && !branchIdValue) {
      return NextResponse.json(
        { error: '第一代服务商申请必须指定所属服务网点' },
        { status: 400 }
      );
    }

    // 检查用户是否已经是服务商
    const users = await query(
      'SELECT id, role FROM users WHERE id = $1',
      [userId]
    );

    if (users.length === 0) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 400 }
      );
    }

    const user = users[0];

    if (user.role === 'provider') {
      return NextResponse.json(
        { error: '您已经是服务商，无需重复申请' },
        { status: 400 }
      );
    }

    // 检查是否已有待审核的申请
    const existingApps = await query(
      'SELECT id FROM provider_applications WHERE user_id = $1 AND status = $2',
      [userId, 'pending']
    );

    if (existingApps.length > 0) {
      return NextResponse.json(
        { error: '您已有待审核的申请，请等待审核结果' },
        { status: 400 }
      );
    }

    // 创建申请
    const result = await query(
      `INSERT INTO provider_applications 
       (user_id, applicant_name, phone, apply_type, parent_provider_id, branch_id, quota_request, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [userId, applicantName, phone, applyType, parentProviderId || null, branchIdValue || '00000000-0000-0000-0000-000000000011', quotaRequest || 0, 'pending']
    );

    return NextResponse.json({
      success: true,
      data: result[0],
      message: '申请已提交，请等待审核',
    });
  } catch (error) {
    console.error('提交申请失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '提交申请失败' },
      { status: 500 }
    );
  }
}
