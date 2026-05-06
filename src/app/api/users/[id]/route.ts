import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取单个用户信息
// 统一使用 PostgreSQL 直连
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const users = await query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );

    if (users.length === 0) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      );
    }

    // 返回用户信息（不包含密码）
    const { password: _, ...userWithoutPassword } = users[0];

    return NextResponse.json({
      success: true,
      data: userWithoutPassword,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    console.error('获取用户信息失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取用户信息失败' },
      { status: 500 }
    );
  }
}
