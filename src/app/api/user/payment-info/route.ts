import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest } from '@/lib/auth';

// 允许更新的字段白名单
const ALLOWED_PAYMENT_FIELDS = new Set(['wechat_account', 'alipay_account']);

// 更新用户收款账号
export async function PUT(request: NextRequest) {
  try {
    // 鉴权：需要登录
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, wechatAccount, alipayAccount } = body;

    if (!userId) {
      return NextResponse.json({ error: '缺少用户ID' }, { status: 400 });
    }

    // 验证操作者权限：管理员或本人
    if (user.role !== 'admin' && user.userId !== userId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    // 白名单过滤
    const updateData: Record<string, unknown> = {};
    if (wechatAccount !== undefined) updateData.wechat_account = wechatAccount;
    if (alipayAccount !== undefined) updateData.alipay_account = alipayAccount;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: '没有需要更新的字段' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { error } = await client.from('users').update(updateData).eq('id', userId);

    if (error) {
      throw new Error(`更新收款账号失败: ${error.message}`);
    }

    return NextResponse.json({ success: true, message: '收款账号更新成功' });
  } catch (error) {
    console.error('更新收款账号失败:', error);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}

// 获取用户收款账号
export async function GET(request: NextRequest) {
  try {
    // 鉴权：需要登录
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: '缺少用户ID' }, { status: 400 });
    }

    // 验证操作者权限
    if (user.role !== 'admin' && user.userId !== userId) {
      return NextResponse.json({ error: '无权查看' }, { status: 403 });
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('users')
      .select('id, username, wechat_account, alipay_account')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`查询用户信息失败: ${error.message}`);
    }

    if (!data) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('获取收款账号失败:', error);
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}
