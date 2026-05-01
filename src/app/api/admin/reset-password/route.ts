import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 重置用户密码（总公司管理员专用）
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ success: false, error: '未登录，请先登录' }, { status: 401 });
    }

    // 验证是否是管理员
    if (authUser.role !== 'admin') {
      return NextResponse.json({ success: false, error: '无权限，只有管理员可以重置密码' }, { status: 403 });
    }

    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ success: false, error: '请指定要重置密码的用户ID' }, { status: 400 });
    }

    // 不能重置自己的密码
    if (userId === authUser.userId) {
      return NextResponse.json({ success: false, error: '不能重置自己的密码' }, { status: 400 });
    }

    // 重置密码为 123456
    // 注意：实际应该先检查用户是否存在
    const result = await query(
      'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username',
      ['$2a$10$N9qo8uLOickgx2ZMRZoMy.MqrqQe.FNKqBqN5Ym6z7xMQ6fQ3F.Xi', userId]
    );

    if (result.length === 0) {
      return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: `用户 ${result[0].username} 的密码已重置为 123456`,
      data: {
        userId: result[0].id,
        username: result[0].username,
        newPassword: '123456'
      }
    });

  } catch (error) {
    console.error('重置密码失败:', error);
    return NextResponse.json({ success: false, error: '重置密码失败' }, { status: 500 });
  }
}
