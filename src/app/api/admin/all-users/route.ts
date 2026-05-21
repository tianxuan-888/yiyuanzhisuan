import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 获取所有用户列表（管理员专用）
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ success: false, error: '未登录，请先登录' }, { status: 401 });
    }

    // 验证是否是管理员
    if (authUser.role !== 'admin') {
      return NextResponse.json({ success: false, error: '无权限，只有管理员可以查看所有用户' }, { status: 403 });
    }

    // 获取所有用户
    const result = await query(`
      SELECT 
        u.id,
        u.username,
        u.phone,
        u.role,
        u.energy_value,
        u.balance,
        u.is_active,
        u.created_at,
        u.provider_id,
        u.inviter_id,
        u.branch_id,
        br.username as branch_name,
        pr.username as provider_name
      FROM users u
      LEFT JOIN users br ON u.branch_id = br.id
      LEFT JOIN users pr ON u.provider_id = pr.id
      ORDER BY 
        CASE u.role 
          WHEN 'admin' THEN 1 
          WHEN 'branch' THEN 2 
          WHEN 'provider' THEN 3 
          WHEN 'member' THEN 4 
        END,
        u.created_at DESC
    `);

    const users = result.map((u: any) => ({
      id: u.id,
      username: u.username,
      phone: u.phone,
      role: u.role,
      roleName: getRoleName(u.role),
      energyValue: u.energy_value,
      balance: u.balance,
      isActive: u.is_active,
      createdAt: u.created_at,
      branchName: u.branch_name || '-',
      providerName: u.provider_name || '-'
    }));

    return NextResponse.json({
      success: true,
      data: users
    });

  } catch (error) {
    console.error('获取用户列表失败:', error);
    return NextResponse.json({ success: false, error: '获取用户列表失败' }, { status: 500 });
  }
}

function getRoleName(role: string): string {
  const roleMap: Record<string, string> = {
    admin: '智算总台',
    branch: '服务网点',
    provider: '服务商',
    member: '会员'
  };
  return roleMap[role] || role;
}
