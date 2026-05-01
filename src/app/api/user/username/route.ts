import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 更新用户名
export async function PUT(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ success: false, error: '未登录，请先登录' }, { status: 401 });
    }

    const body = await request.json();
    const { username } = body;

    if (!username || username.trim().length < 2 || username.trim().length > 20) {
      return NextResponse.json(
        { success: false, error: '用户名长度需在2-20个字符之间' },
        { status: 400 }
      );
    }

    // 检查用户名是否已被占用
    const existingUser = await query(
      'SELECT id FROM users WHERE username = $1 AND id != $2',
      [username.trim(), authUser.userId]
    );

    if (existingUser.length > 0) {
      return NextResponse.json(
        { success: false, error: '用户名已被占用' },
        { status: 400 }
      );
    }

    // 更新用户名
    await query(
      'UPDATE users SET username = $1, updated_at = NOW() WHERE id = $2',
      [username.trim(), authUser.userId]
    );

    return NextResponse.json({
      success: true,
      message: '用户名修改成功',
      data: { username: username.trim() }
    });

  } catch (error) {
    console.error('更新用户名失败:', error);
    return NextResponse.json(
      { success: false, error: '更新失败，请稍后重试' },
      { status: 500 }
    );
  }
}
