import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';

/**
 * 一次性迁移：更新现有用户的 unique_id 和 invite_code 为新格式
 * 新格式：2字母角色前缀 + 5位数字（如 AD00001, BR00001, PV00001, MB00001）
 * 邀请码 = 唯一ID
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { secret } = body;
    
    // 简单的安全验证
    if (secret !== 'migrate-unique-id-2025') {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const rolePrefixMap: Record<string, string> = {
      admin: 'AD',
      branch: 'BR',
      provider: 'PV',
      member: 'MB',
    };

    const results: { id: string; username: string; old_unique_id: string; new_unique_id: string; old_invite_code: string; new_invite_code: string }[] = [];

    // 按角色分组处理
    for (const [role, prefix] of Object.entries(rolePrefixMap)) {
      const users = await query(
        'SELECT id, username, unique_id, invite_code FROM users WHERE role = $1 ORDER BY created_at ASC',
        [role]
      );

      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const newUniqueId = `${prefix}${String(i + 1).padStart(5, '0')}`;
        const newInviteCode = newUniqueId; // 邀请码 = 唯一ID

        // 检查是否已经是新格式
        if (user.unique_id === newUniqueId && user.invite_code === newInviteCode) {
          continue;
        }

        // 更新
        await query(
          'UPDATE users SET unique_id = $1, invite_code = $2 WHERE id = $3',
          [newUniqueId, newInviteCode, user.id]
        );

        results.push({
          id: user.id,
          username: user.username,
          old_unique_id: user.unique_id || '',
          new_unique_id: newUniqueId,
          old_invite_code: user.invite_code || '',
          new_invite_code: newInviteCode,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `迁移完成，更新了 ${results.length} 条记录`,
      data: results,
    });
  } catch (error) {
    console.error('迁移失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '迁移失败' },
      { status: 500 }
    );
  }
}
