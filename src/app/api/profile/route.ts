import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';
import { getInviteCodeType, generateInviteCode } from '@/lib/invite-code';

/**
 * 获取当前用户资料
 * GET /api/profile
 */
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    // 查询用户完整信息
    const users = await query(
      `SELECT 
        id, username, phone, role, real_name, 
        birth_date, wechat_account, alipay_account, 
        avatar_url, gender, address, invite_code, unique_id,
        energy_value, balance, provider_id, branch_id, inviter_id,
        created_at
      FROM users WHERE id = $1`,
      [user.userId]
    );

    if (users.length === 0) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    const userData = users[0];

    // 获取邀请人信息
    let inviterInfo = null;
    if (userData.inviter_id) {
      const inviters = await query(
        'SELECT id, username, phone, role FROM users WHERE id = $1',
        [userData.inviter_id]
      );
      if (inviters.length > 0) {
        inviterInfo = inviters[0];
      }
    }

    // 获取服务商信息
    let providerInfo = null;
    if (userData.provider_id) {
      const providers = await query(
        'SELECT id, username, phone FROM users WHERE id = $1',
        [userData.provider_id]
      );
      if (providers.length > 0) {
        providerInfo = providers[0];
      }
    }

    // 获取分公司信息
    let branchInfo = null;
    if (userData.branch_id) {
      const branches = await query(
        'SELECT id, username, phone FROM users WHERE id = $1',
        [userData.branch_id]
      );
      if (branches.length > 0) {
        branchInfo = branches[0];
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        ...userData,
        inviter: inviterInfo,
        provider: providerInfo,
        branch: branchInfo,
        // 生成或更新邀请码
        invite_code: userData.invite_code || null,
        invite_code_type: userData.invite_code ? getInviteCodeType(userData.invite_code) : null
      }
    });
  } catch (error) {
    console.error('获取用户资料失败:', error);
    return NextResponse.json(
      { error: '获取用户资料失败' },
      { status: 500 }
    );
  }
}

/**
 * 更新当前用户资料
 * PUT /api/profile
 */
export async function PUT(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const body = await request.json();
    const {
      username,
      real_name,
      birth_date,
      wechat_account,
      alipay_account,
      gender,
      address,
      avatar_url
    } = body;

    // 构建更新字段
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (username !== undefined) {
      // 检查用户名是否已被占用
      const existing = await query(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [username, user.userId]
      );
      if (existing.length > 0) {
        return NextResponse.json(
          { error: '用户名已被占用' },
          { status: 400 }
        );
      }
      updates.push(`username = $${paramIndex++}`);
      values.push(username);
    }

    if (real_name !== undefined) {
      updates.push(`real_name = $${paramIndex++}`);
      values.push(real_name || null);
    }

    if (birth_date !== undefined) {
      updates.push(`birth_date = $${paramIndex++}`);
      values.push(birth_date || null);
    }

    if (wechat_account !== undefined) {
      updates.push(`wechat_account = $${paramIndex++}`);
      values.push(wechat_account || null);
    }

    if (alipay_account !== undefined) {
      updates.push(`alipay_account = $${paramIndex++}`);
      values.push(alipay_account || null);
    }

    if (gender !== undefined) {
      updates.push(`gender = $${paramIndex++}`);
      values.push(gender || null);
    }

    if (address !== undefined) {
      updates.push(`address = $${paramIndex++}`);
      values.push(address || null);
    }

    if (avatar_url !== undefined) {
      updates.push(`avatar_url = $${paramIndex++}`);
      values.push(avatar_url || null);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: '没有需要更新的字段' },
        { status: 400 }
      );
    }

    // 添加更新时间
    updates.push(`updated_at = NOW()`);

    // 执行更新
    values.push(user.userId);
    const result = await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING 
        id, username, phone, role, real_name, birth_date, wechat_account, 
        alipay_account, gender, address, avatar_url`,
      values
    );

    return NextResponse.json({
      success: true,
      message: '资料更新成功',
      data: result[0]
    });
  } catch (error) {
    console.error('更新用户资料失败:', error);
    return NextResponse.json(
      { error: '更新用户资料失败' },
      { status: 500 }
    );
  }
}
