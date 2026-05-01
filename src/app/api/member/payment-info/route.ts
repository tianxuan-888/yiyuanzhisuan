import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest } from '@/lib/auth';

// 允许更新的收款字段白名单
const ALLOWED_PAYMENT_FIELDS = new Set(['wechat_account', 'alipay_account']);

// 更新用户收款账号
export async function PUT(request: NextRequest) {
  try {
    // 鉴权
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    // 强制使用 JWT 中的 userId
    const userId = authUser.userId;

    const body = await request.json();
    const { wechatAccount, alipayAccount, paymentQRCode } = body;

    const client = getSupabaseClient();

    const updateData: any = {};
    if (wechatAccount !== undefined) {
      updateData.wechat_account = wechatAccount;
    }
    if (alipayAccount !== undefined) {
      updateData.alipay_account = alipayAccount;
    }
    if (paymentQRCode !== undefined) {
      updateData.payment_qr_code = paymentQRCode;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: '没有需要更新的字段' },
        { status: 400 }
      );
    }

    const { error } = await client
      .from('users')
      .update(updateData)
      .eq('id', userId);

    if (error) {
      throw new Error(`更新收款账号失败: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      message: '收款账号更新成功',
    });
  } catch (error) {
    console.error('更新收款账号失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '更新失败' },
      { status: 500 }
    );
  }
}

// 获取用户收款账号
export async function GET(request: NextRequest) {
  try {
    // 鉴权
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    // 强制使用 JWT 中的 userId
    const userId = authUser.userId;

    const client = getSupabaseClient();

    const { data, error } = await client
      .from('users')
      .select('id, username, wechat_account, alipay_account, payment_qr_code')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`查询用户信息失败: ${error.message}`);
    }

    if (!data) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: data.id,
        username: data.username,
        wechatAccount: data.wechat_account,
        alipayAccount: data.alipay_account,
        paymentQRCode: data.payment_qr_code,
      },
    });
  } catch (error) {
    console.error('获取收款账号失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    );
  }
}
