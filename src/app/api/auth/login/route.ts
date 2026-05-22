import { NextRequest, NextResponse } from 'next/server';
import { signToken } from '@/lib/auth';
import bcrypt from 'bcryptjs';
import { queryOne } from '@/lib/pg-client';

// 辅助函数：将PostgreSQL numeric格式转换为数字
function parseNumeric(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const match = val.match(/\{(\d+)\s+(-?\d+)/);
    if (match) {
      const num = parseFloat(match[1]);
      const exp = parseInt(match[2]);
      return num * Math.pow(10, exp);
    }
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

export async function POST(request: NextRequest) {
  try {
    const { loginKey, password } = await request.json();

    if (!loginKey || !password) {
      return NextResponse.json(
        { error: '账号和密码不能为空' },
        { status: 400 }
      );
    }

    try {
      let sql = '';
      let params: any[];

      if (/^1[3-9]\d{9}$/.test(loginKey)) {
        sql = 'SELECT * FROM users WHERE phone = $1';
        params = [loginKey];
      } else {
        sql = 'SELECT * FROM users WHERE username = $1';
        params = [loginKey];
      }

      const user = await queryOne(sql, params);

      if (!user) {
        return NextResponse.json(
          { error: '账号或密码错误' },
          { status: 401 }
        );
      }

      const passwordValid = bcrypt.compareSync(password, user.password);
      if (!passwordValid) {
        return NextResponse.json(
          { error: '账号或密码错误' },
          { status: 401 }
        );
      }

      if (!user.is_active) {
        return NextResponse.json(
          { error: '账户已被禁用' },
          { status: 403 }
        );
      }

      const token = signToken({
        userId: String(user.id),
        username: user.username,
        role: user.role,
      });

      let branch_name = null;
      if (user.branch_id) {
        const branchUser = await queryOne(
          'SELECT username FROM users WHERE id = $1',
          [user.branch_id]
        );
        if (branchUser) {
          branch_name = branchUser.username;
        }
      }

      const { password: _, ...userWithoutPassword } = user;

      return NextResponse.json({
        success: true,
        data: {
          ...userWithoutPassword,
          id: String(user.id),
          branch_name,
          balance: parseNumeric(user.balance),
          points: parseNumeric(user.points || 0),
          token,
        },
      });
    } catch (error) {
      console.error('登录失败:', error);
      throw error;
    }
  } catch (error) {
    console.error('登录失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '登录失败' },
      { status: 500 }
    );
  }
}
