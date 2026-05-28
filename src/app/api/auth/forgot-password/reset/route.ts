import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/pg-client';
import { hashPassword } from '@/lib/password';
import { getVerifyCode, deleteVerifyCode } from '@/lib/verify-code';
import { checkSmsVerifyCode, isAliyunSmsConfigured } from '@/lib/aliyun-sms';

/**
 * 找回密码 - 重置密码
 * 验证手机号 + 验证码，通过后更新密码
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone, verifyCode, newPassword, confirmPassword } = body;

    // 参数校验
    if (!phone) {
      return NextResponse.json({ error: '手机号不能为空' }, { status: 400 });
    }

    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return NextResponse.json({ error: '请输入正确的手机号' }, { status: 400 });
    }

    if (!verifyCode) {
      return NextResponse.json({ error: '请输入验证码' }, { status: 400 });
    }

    if (!newPassword) {
      return NextResponse.json({ error: '请输入新密码' }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: '密码长度不能少于6个字符' }, { status: 400 });
    }

    if (!confirmPassword) {
      return NextResponse.json({ error: '请确认新密码' }, { status: 400 });
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json({ error: '两次密码不一致' }, { status: 400 });
    }

    // 验证验证码：优先使用本地存储的验证码校验（发送时已存储）
    // 阿里云 CheckSmsVerifyCode 二次校验不稳定，本地比对更可靠
    const storedCode = await getVerifyCode(`reset_${phone}`);
    if (storedCode && storedCode.code === verifyCode) {
      if (storedCode.expiresAt < Date.now()) {
        await deleteVerifyCode(`reset_${phone}`);
        return NextResponse.json({ error: '验证码已过期，请重新获取' }, { status: 400 });
      }
      // 验证通过
    } else if (isAliyunSmsConfigured()) {
      const checkResult = await checkSmsVerifyCode(phone, verifyCode);
      if (!checkResult.success) {
        return NextResponse.json({ error: '验证码错误，请重新获取' }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: '验证码错误，请重新获取' }, { status: 400 });
    }

    // 检查用户是否存在
    const user = await queryOne('SELECT id, username FROM users WHERE phone = $1', [phone]);
    if (!user) {
      return NextResponse.json({ error: '该手机号未注册' }, { status: 400 });
    }

    // 哈希新密码
    const hashedPassword = await hashPassword(newPassword);

    // 更新密码
    await execute('UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2', [
      hashedPassword,
      user.id,
    ]);

    // 删除已使用的验证码
    await deleteVerifyCode(`reset_${phone}`);

    return NextResponse.json({
      success: true,
      message: '密码重置成功，请使用新密码登录',
    });
  } catch (error) {
    console.error('重置密码失败:', error);
    return NextResponse.json(
      { error: '重置密码失败，请稍后重试' },
      { status: 500 }
    );
  }
}
