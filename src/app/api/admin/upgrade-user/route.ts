import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, targetRole, adminId } = body;

    if (!userId || !targetRole || !adminId) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 验证目标角色
    if (!['provider', 'branch'].includes(targetRole)) {
      return NextResponse.json(
        { success: false, error: '目标角色只能是 provider 或 branch' },
        { status: 400 }
      );
    }
    
    // 验证管理员身份
    const adminResult = await query(
      "SELECT id, role FROM users WHERE id = $1 AND role = 'admin'",
      [adminId]
    );
    
    if (adminResult.length === 0) {
      return NextResponse.json(
        { success: false, error: '无权限操作' },
        { status: 403 }
      );
    }

    // 获取用户信息
    const userResult = await query(
      'SELECT id, username, phone, role FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.length === 0) {
      return NextResponse.json(
        { success: false, error: '用户不存在' },
        { status: 404 }
      );
    }

    const user = userResult[0];

    // 检查用户当前角色
    if (user.role === 'admin') {
      return NextResponse.json(
        { success: false, error: '无法升级管理员账号' },
        { status: 400 }
      );
    }

    if (user.role === targetRole) {
      return NextResponse.json(
        { success: false, error: `用户已是${targetRole === 'provider' ? '服务商' : '分公司'}` },
        { status: 400 }
      );
    }

    // 升级用户角色
    const updateData: any = { role: targetRole };
    
    // 如果升级为服务商，设置默认额度
    if (targetRole === 'provider') {
      updateData.provider_id = null; // 服务商直属分公司（后续可调整）
      updateData.branch_id = null;
    }
    
    // 如果升级为分公司
    if (targetRole === 'branch') {
      updateData.branch_id = null;
      updateData.provider_id = null;
    }

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(updateData).forEach(([key, value]) => {
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    });

    values.push(userId);

    await query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      values
    );

    return NextResponse.json({
      success: true,
      message: `用户 ${user.username} 已升级为 ${targetRole === 'provider' ? '服务商' : '分公司'}`,
      data: {
        userId: user.id,
        username: user.username,
        oldRole: user.role,
        newRole: targetRole
      }
    });

  } catch (error) {
    console.error('升级用户失败:', error);
    return NextResponse.json(
      { success: false, error: '升级失败' },
      { status: 500 }
    );
  }
}

// 获取可升级的用户列表（当前是 member 角色的用户）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const adminId = searchParams.get('adminId');

    if (!adminId) {
      return NextResponse.json(
        { success: false, error: '缺少管理员ID' },
        { status: 400 }
      );
    }

    // 验证管理员身份
    const adminResult = await query(
      "SELECT id, role FROM users WHERE id = $1 AND role = 'admin'",
      [adminId]
    );

    if (adminResult.length === 0) {
      return NextResponse.json(
        { success: false, error: '无权限' },
        { status: 403 }
      );
    }

    // 获取所有会员用户
    const result = await query(`
      SELECT id, username, phone, role, 
             created_at,
             inviter_id,
             (SELECT username FROM users WHERE id = users.inviter_id) as inviter_name
      FROM users 
      WHERE role = 'member'
      ORDER BY created_at DESC
    `);

    return NextResponse.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('获取用户列表失败:', error);
    return NextResponse.json(
      { success: false, error: '获取失败' },
      { status: 500 }
    );
  }
}
