import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { setVerifyCode, getVerifyCode, cleanExpiredCodes } from '@/lib/verify-code';

// 发送验证码
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone } = body;

    // 参数验证
    if (!phone) {
      return NextResponse.json(
        { error: '手机号不能为空' },
        { status: 400 }
      );
    }

    // 验证手机号格式
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return NextResponse.json(
        { error: '请输入正确的手机号' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient();

    // 检查手机号是否已被注册
    const { data: existingUser, error: checkError } = await client
      .from('users')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (checkError) {
      console.error('检查手机号失败:', checkError.message);
    }

    if (existingUser) {
      return NextResponse.json(
        { error: '该手机号已被注册' },
        { status: 400 }
      );
    }

    // 清理过期验证码
    cleanExpiredCodes();

    // 检查是否在60秒内重复发送
    const existingCode = getVerifyCode(phone);
    if (existingCode && existingCode.expiresAt > Date.now() + 54000) {
      return NextResponse.json(
        { error: '请稍后再试发送验证码' },
        { status: 400 }
      );
    }

    // 生成6位验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // 存储验证码（5分钟有效期）
    setVerifyCode(phone, code);

    // TODO: 实际发送短信（这里模拟成功，返回验证码用于测试）
    console.log(`[验证码] 手机号: ${phone}, 验证码: ${code}`);

    return NextResponse.json({
      success: true,
      message: '验证码已发送',
      devCode: code  // 测试环境返回验证码
    });
  } catch (error) {
    console.error('发送验证码失败:', error);
    return NextResponse.json(
      { error: '发送验证码失败' },
      { status: 500 }
    );
  }
}
