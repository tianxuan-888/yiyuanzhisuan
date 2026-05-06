import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/pg-client';
import { setVerifyCode, getVerifyCode, cleanExpiredCodes } from '@/lib/verify-code';
import { sendSmsVerifyCode, isAliyunSmsConfigured } from '@/lib/aliyun-sms';

/**
 * 找回密码 - 发送验证码
 * 与注册验证码不同：此处要求手机号必须已注册
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone } = body;

    if (!phone) {
      return NextResponse.json(
        { error: '手机号不能为空' },
        { status: 400 }
      );
    }

    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return NextResponse.json(
        { error: '请输入正确的手机号' },
        { status: 400 }
      );
    }

    // 检查手机号是否已注册（必须存在才能找回密码）
    const user = await queryOne('SELECT id, username FROM users WHERE phone = $1', [phone]);

    if (!user) {
      return NextResponse.json(
        { error: '该手机号未注册' },
        { status: 400 }
      );
    }

    // 清理过期验证码
    await cleanExpiredCodes();

    // 检查60秒内是否重复发送
    const existingCode = await getVerifyCode(`reset_${phone}`);
    if (existingCode && existingCode.expiresAt > Date.now() + 240000) {
      return NextResponse.json(
        { error: '请稍后再试发送验证码' },
        { status: 400 }
      );
    }

    // 生成6位验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // 使用 reset_ 前缀区分注册验证码，5分钟有效期
    await setVerifyCode(`reset_${phone}`, code);

    // 发送短信验证码
    const smsResult = await sendSmsVerifyCode(phone, code);

    if (!smsResult.success) {
      return NextResponse.json(
        { error: smsResult.message },
        { status: 500 }
      );
    }

    const isDev = !isAliyunSmsConfigured();

    return NextResponse.json({
      success: true,
      message: isDev ? '验证码已发送（开发模式）' : '验证码已发送',
      ...(isDev ? { devCode: code } : {}),  // 仅开发环境返回验证码
    });
  } catch (error) {
    console.error('找回密码发送验证码失败:', error);
    return NextResponse.json(
      { error: '发送验证码失败，请稍后重试' },
      { status: 500 }
    );
  }
}
