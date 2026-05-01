import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';

/**
 * 获取可用邀请码列表（供注册页面使用，无需登录）
 * GET /api/invite-codes/available
 */
export async function GET(request: NextRequest) {
  try {
    // 查询有邀请码的服务商和会员
    const result = await query(
      `SELECT 
        u.id,
        u.username,
        u.invite_code,
        u.role,
        u.phone
      FROM users u
      WHERE u.invite_code IS NOT NULL 
        AND u.invite_code != ''
        AND u.is_active = true
      ORDER BY 
        CASE u.role 
          WHEN 'provider' THEN 1 
          WHEN 'member' THEN 2 
          ELSE 3 
        END,
        u.created_at DESC`
    );

    // 按角色分组
    const providers = result.filter((u: any) => u.role === 'provider');
    const members = result.filter((u: any) => u.role === 'member');

    return NextResponse.json({
      success: true,
      data: {
        all: result,
        providers: providers,
        members: members,
        total: result.length
      }
    });
  } catch (error) {
    console.error('获取邀请码列表失败:', error);
    return NextResponse.json(
      { error: '获取邀请码列表失败' },
      { status: 500 }
    );
  }
}
