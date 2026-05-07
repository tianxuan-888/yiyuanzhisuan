import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';
import { getInviteCodeType } from '@/lib/invite-code';

/**
 * 为用户生成/获取邀请码
 * POST /api/invite-codes/generate
 * 需要登录
 * 支持角色：admin(ADMIN), branch(BRAN), provider(PROV), member(MEMB)
 */
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    // 查询用户当前邀请码
    const existingUsers = await query(
      'SELECT invite_code FROM users WHERE id = $1',
      [user.userId]
    );

    if (existingUsers.length === 0) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    const currentCode = existingUsers[0].invite_code;

    // 如果已有邀请码，直接返回
    if (currentCode && getInviteCodeType(currentCode) !== 'invalid') {
      return NextResponse.json({
        success: true,
        data: {
          invite_code: currentCode,
          message: '您已有邀请码'
        }
      });
    }

    // 根据角色确定前缀
    const prefixMap: Record<string, string> = {
      admin: 'ADMIN',
      branch: 'BRAN',
      provider: 'PROV',
      member: 'MEMB',
    };
    const prefix = prefixMap[user.role] || 'MEMB';

    // 生成唯一码
    const generateCode = (): string => {
      const randomNum = Math.floor(Math.random() * 1000000);
      return `${prefix}${String(randomNum).padStart(6, '0')}`;
    };

    // 确保唯一
    let attempts = 0;
    let code = generateCode();
    while (attempts < 10) {
      const existing = await query(
        'SELECT id FROM users WHERE invite_code = $1',
        [code]
      );
      if (existing.length === 0) break;
      code = generateCode();
      attempts++;
    }

    // 更新数据库
    await query(
      'UPDATE users SET invite_code = $1 WHERE id = $2',
      [code, user.userId]
    );

    return NextResponse.json({
      success: true,
      data: {
        invite_code: code,
        message: '邀请码生成成功'
      }
    });
  } catch (error) {
    console.error('生成邀请码失败:', error);
    return NextResponse.json(
      { error: '生成邀请码失败' },
      { status: 500 }
    );
  }
}
