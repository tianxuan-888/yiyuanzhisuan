import { NextRequest, NextResponse } from 'next/server';
import { query, execute } from '@/lib/pg-client';

// 智算中心创建服务网点
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      username,         // 服务网点账号
      password,         // 密码
      phone,            // 手机号
      name,             // 服务网点名称
      code,             // 服务网点代码
      region,           // 所属区域
      creator_id        // 创建人ID（智算中心管理员）
    } = body;

    // 参数验证
    if (!username || !password) {
      return NextResponse.json(
        { error: '账号和密码不能为空' },
        { status: 400 }
      );
    }

    if (username.length < 3 || username.length > 50) {
      return NextResponse.json(
        { error: '账号长度必须在 3-50 个字符之间' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: '密码长度不能少于 6 个字符' },
        { status: 400 }
      );
    }

    if (!name) {
      return NextResponse.json(
        { error: '服务网点名称不能为空' },
        { status: 400 }
      );
    }

    if (!code) {
      return NextResponse.json(
        { error: '服务网点代码不能为空' },
        { status: 400 }
      );
    }

    // 检查账号是否已存在
    const existingUsers = await query<{ id: string }>(
      `SELECT id FROM users WHERE username = $1`,
      [username]
    );

    if (existingUsers.length > 0) {
      return NextResponse.json(
        { error: '账号已存在' },
        { status: 400 }
      );
    }

    // 检查服务网点代码是否已存在
    const existingBranches = await query<{ id: string }>(
      `SELECT id FROM branches WHERE code = $1`,
      [code]
    );

    if (existingBranches.length > 0) {
      return NextResponse.json(
        { error: '服务网点代码已存在' },
        { status: 400 }
      );
    }

    // 创建 users 表记录
    const newUserResult = await query<{ id: string }>(
      `INSERT INTO users (username, password, role, phone, balance, is_active, created_at, updated_at)
       VALUES ($1, $2, 'branch', $3, 0, true, NOW(), NOW())
       RETURNING id`,
      [username, password, phone || null]
    );

    const newUserId = newUserResult[0]?.id;

    if (!newUserId) {
      throw new Error('创建用户失败');
    }

    return NextResponse.json({
      success: true,
      message: '服务网点创建成功',
      data: {
        userId: newUserId,
        username,
        name,
        code,
        role: 'branch'
      }
    });
  } catch (error: any) {
    console.error('创建服务网点失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
