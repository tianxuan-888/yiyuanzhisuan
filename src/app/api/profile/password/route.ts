import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/password';

/**
 * 修改密码
 * POST /api/profile/password
 */
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const body = await request.json();
    const { old_password, new_password, confirm_password } = body;

    // 参数验证
    if (!old_password || !new_password || !confirm_password) {
      return NextResponse.json(
        { error: '请填写所有密码字段' },
        { status: 400 }
      );
    }

    if (new_password.length < 6) {
      return NextResponse.json(
        { error: '新密码长度不能少于6位' },
        { status: 400 }
      );
    }

    if (new_password !== confirm_password) {
      return NextResponse.json(
        { error: '两次输入的密码不一致' },
        { status: 400 }
      );
    }

    // 查询当前密码
    const users = await query(
      'SELECT password FROM users WHERE id = $1',
      [user.userId]
    );

    if (users.length === 0) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    // 验证旧密码
    const isValid = await verifyPassword(old_password, users[0].password);
    if (!isValid) {
      return NextResponse.json(
        { error: '原密码错误' },
        { status: 400 }
      );
    }

    // 哈希新密码并更新
    const hashedPassword = await hashPassword(new_password);
    await query(
      'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, user.userId]
    );

    return NextResponse.json({
      success: true,
      message: '密码修改成功'
    });
  } catch (error) {
    console.error('修改密码失败:', error);
    return NextResponse.json(
      { error: '修改密码失败' },
      { status: 500 }
    );
  }
}
