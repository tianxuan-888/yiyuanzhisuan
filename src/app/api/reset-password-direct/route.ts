import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hashPassword } from '@/lib/password';

// 直接重置用户密码（无需认证，仅用于初始化）
export async function POST(request: NextRequest) {
  try {
    // 安全检查：仅在开发/测试环境可用
    const allowedOrigins = ['localhost', '127.0.0.1', '.dev.coze.site'];
    const host = request.headers.get('host') || '';
    const isLocal = allowedOrigins.some(o => host.includes(o));
    
    if (!isLocal && process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: '此接口仅在本地开发环境可用' }, { status: 403 });
    }

    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json({ error: '用户名和密码不能为空' }, { status: 400 });
    }

    // 哈希密码
    const hashedPassword = await hashPassword(password);
    
    const supabase = getSupabaseClient();

    // 更新密码
    const { data: result, error } = await supabase
      .from('users')
      .update({ password: hashedPassword, updated_at: new Date().toISOString() })
      .eq('username', username)
      .select('id, username')
      .single();

    if (error || !result) {
      return NextResponse.json({ error: '用户不存在或更新失败' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: `用户 ${result.username} 的密码已重置为 ${password}`
    });
  } catch (error) {
    console.error('重置密码失败:', error);
    return NextResponse.json({ error: '重置密码失败' }, { status: 500 });
  }
}
