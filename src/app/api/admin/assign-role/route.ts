import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

/**
 * 总公司账号赋权接口
 * POST /api/admin/assign-role
 * 
 * 功能：指定账号（通过用户ID或手机号查找），赋予任意角色
 * 支持角色：admin, branch, provider, member
 */
export async function POST(request: NextRequest) {
  try {
    // 验证管理员身份
    const adminUser = authenticateRequest(request);
    if (!adminUser || adminUser.role !== 'admin') {
      return NextResponse.json({ success: false, error: '仅总公司管理员可执行此操作' }, { status: 403 });
    }

    const body = await request.json();
    const { userId, phone, targetRole, branchId, providerId } = body;

    // 目标角色验证
    const validRoles = ['admin', 'branch', 'provider', 'member'];
    if (!targetRole || !validRoles.includes(targetRole)) {
      return NextResponse.json({ success: false, error: '目标角色无效，支持: admin, branch, provider, member' }, { status: 400 });
    }

    // 通过 userId 或 phone 查找用户
    let targetUser: any = null;

    if (userId) {
      const users = await query('SELECT id, username, phone, role, invite_code FROM users WHERE id = $1', [userId]);
      if (users.length > 0) targetUser = users[0];
    } else if (phone) {
      const users = await query('SELECT id, username, phone, role, invite_code FROM users WHERE phone = $1', [phone]);
      if (users.length > 0) targetUser = users[0];
    } else {
      return NextResponse.json({ success: false, error: '请提供 userId 或 phone 来指定账号' }, { status: 400 });
    }

    if (!targetUser) {
      return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
    }

    // 不能修改自己的角色
    if (targetUser.id === adminUser.userId) {
      return NextResponse.json({ success: false, error: '不能修改自己的角色' }, { status: 400 });
    }

    if (targetUser.role === targetRole) {
      const roleLabels: Record<string, string> = { admin: '总公司', branch: '分公司', provider: '服务商', member: '会员' };
      return NextResponse.json({ success: false, error: `该用户已是${roleLabels[targetRole]}` }, { status: 400 });
    }

    // 构建更新字段
    const updates: string[] = ['role = $1'];
    const values: any[] = [targetRole];
    let paramIdx = 2;

    // 根据目标角色设置关联字段
    if (targetRole === 'admin') {
      // 升为总公司：清除 branch_id 和 provider_id
      updates.push(`branch_id = NULL`);
      updates.push(`provider_id = NULL`);
    } else if (targetRole === 'branch') {
      // 升为分公司：设置 branch_id 为自身ID（分公司自己就是 branch），清除 provider_id
      updates.push(`provider_id = NULL`);
      // 如果指定了 branchId 就用指定的，否则设为自身
      if (branchId) {
        updates.push(`branch_id = $${paramIdx}`);
        values.push(branchId);
        paramIdx++;
      } else {
        updates.push(`branch_id = $${paramIdx}`);
        values.push(targetUser.id);
        paramIdx++;
      }
    } else if (targetRole === 'provider') {
      // 升为服务商：需要指定所属分公司
      if (branchId) {
        updates.push(`branch_id = $${paramIdx}`);
        values.push(branchId);
        paramIdx++;
      }
      if (providerId) {
        // 上级服务商
      } else {
        updates.push(`provider_id = NULL`);
      }
    } else if (targetRole === 'member') {
      // 降为会员：保留现有的 provider_id 和 branch_id
      // 如果指定了新的 provider/branch 则覆盖
      if (providerId) {
        updates.push(`provider_id = $${paramIdx}`);
        values.push(providerId);
        paramIdx++;
      }
      if (branchId) {
        updates.push(`branch_id = $${paramIdx}`);
        values.push(branchId);
        paramIdx++;
      }
    }

    // 执行更新
    values.push(targetUser.id);
    await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
      values
    );

    // 如果升级为服务商，在 providers 表中创建记录
    if (targetRole === 'provider') {
      const existingProvider = await query(
        'SELECT id FROM providers WHERE user_id = $1',
        [targetUser.id]
      );
      if (existingProvider.length === 0) {
        const targetBranchId = branchId || targetUser.id;
        await query(
          `INSERT INTO providers (user_id, quota, used_quota, total_sales, branch_id) VALUES ($1, 0, 0, 0, $2)`,
          [targetUser.id, targetBranchId]
        );
      }
    }

    // 如果升级为分公司，确保 branch_id 指向自己
    if (targetRole === 'branch') {
      // 再次确保 branch_id 设置正确
      const targetBranchId = branchId || targetUser.id;
      await query(
        `UPDATE users SET branch_id = $1 WHERE id = $2`,
        [targetBranchId, targetUser.id]
      );
    }

    const roleLabels: Record<string, string> = { admin: '总公司', branch: '分公司', provider: '服务商', member: '会员' };

    return NextResponse.json({
      success: true,
      message: `已将用户 ${targetUser.username} 角色变更为${roleLabels[targetRole]}`,
      data: {
        userId: targetUser.id,
        username: targetUser.username,
        phone: targetUser.phone,
        oldRole: targetUser.role,
        newRole: targetRole,
      }
    });

  } catch (error) {
    console.error('赋权失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '赋权失败' },
      { status: 500 }
    );
  }
}

/**
 * 搜索用户（通过用户名/手机号/专属ID模糊搜索）
 * GET /api/admin/assign-role?keyword=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const adminUser = authenticateRequest(request);
    if (!adminUser || adminUser.role !== 'admin') {
      return NextResponse.json({ success: false, error: '仅总公司管理员可执行此操作' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get('keyword') || '';

    if (!keyword || keyword.length < 2) {
      return NextResponse.json({ success: true, data: [] });
    }

    const result = await query(
      `SELECT id, username, phone, role, unique_id, real_name, energy_value, balance, invite_code,
              branch_id, provider_id,
              (SELECT username FROM users WHERE id = users.provider_id) as provider_name,
              (SELECT username FROM users WHERE id = users.branch_id) as branch_name
       FROM users 
       WHERE (username ILIKE $1 OR phone ILIKE $1 OR unique_id ILIKE $1)
         AND id != $2
       ORDER BY 
         CASE role 
           WHEN 'admin' THEN 1 
           WHEN 'branch' THEN 2 
           WHEN 'provider' THEN 3 
           WHEN 'member' THEN 4 
         END,
         created_at DESC
       LIMIT 20`,
      [`%${keyword}%`, adminUser.userId]
    );

    const roleLabels: Record<string, string> = { admin: '总公司', branch: '分公司', provider: '服务商', member: '会员' };

    const data = result.map((u: any) => ({
      ...u,
      roleLabel: roleLabels[u.role] || u.role,
    }));

    return NextResponse.json({ success: true, data });

  } catch (error) {
    console.error('搜索用户失败:', error);
    return NextResponse.json(
      { success: false, error: '搜索失败' },
      { status: 500 }
    );
  }
}
