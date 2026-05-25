import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, locked, operatorId } = body;

    if (!userId || typeof locked !== 'boolean') {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }

    // 查找用户
    const user = await queryOne('SELECT id, username, buy_locked, role FROM users WHERE id = $1', [userId]);
    if (!user) {
      return NextResponse.json({ success: false, message: '用户不存在' }, { status: 404 });
    }

    if (user.role !== 'member') {
      return NextResponse.json({ success: false, message: '只能锁定会员账号' }, { status: 400 });
    }

    // 更新锁定状态
    await execute(
      'UPDATE users SET buy_locked = $1, updated_at = NOW() WHERE id = $2',
      [locked, userId]
    );

    return NextResponse.json({
      success: true,
      message: locked ? '账号已锁定，该会员无法购买产品' : '账号已解锁，可以正常购买产品',
      data: { userId, buy_locked: locked }
    });
  } catch (error) {
    console.error('[buy-lock] error:', error);
    return NextResponse.json({ success: false, message: '操作失败，请稍后重试' }, { status: 500 });
  }
}
