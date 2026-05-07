import { NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 迁移现有用户的 unique_id 和 invite_code
export async function POST() {
  try {
    // 获取所有没有 unique_id 或使用旧 HM 格式的用户
    const users = await query(
      "SELECT id, role, phone, unique_id, invite_code FROM users WHERE unique_id IS NULL OR unique_id LIKE 'HM%' OR unique_id = ''"
    );

    if (users.length === 0) {
      return NextResponse.json({ success: true, message: '无需迁移', migrated: 0 });
    }

    const rolePrefixMap: Record<string, string> = {
      admin: 'A',
      branch: 'B',
      provider: 'P',
      member: 'M',
    };

    const invitePrefixMap: Record<string, string> = {
      admin: 'ADMIN',
      branch: 'BRAN',
      provider: 'PROV',
      member: 'MEMB',
    };

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const generateUniqueId = (role: string): string => {
      const prefix = rolePrefixMap[role] || 'M';
      let code = prefix;
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return code;
    };

    const generateInviteCode = (role: string): string => {
      const prefix = invitePrefixMap[role] || 'MEMB';
      return `${prefix}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
    };

    let migrated = 0;

    for (const user of users) {
      let newUniqueId = generateUniqueId(user.role);
      
      // 确保唯一性
      for (let i = 0; i < 10; i++) {
        const existing = await query('SELECT id FROM users WHERE unique_id = $1 AND id != $2', [newUniqueId, user.id]);
        if (existing.length === 0) break;
        newUniqueId = generateUniqueId(user.role);
      }

      // 如果没有邀请码，也生成一个
      const newInviteCode = user.invite_code || generateInviteCode(user.role);

      await query(
        'UPDATE users SET unique_id = $1, invite_code = $2 WHERE id = $3',
        [newUniqueId, newInviteCode, user.id]
      );

      migrated++;
    }

    return NextResponse.json({
      success: true,
      message: `成功迁移 ${migrated} 个用户`,
      migrated,
    });
  } catch (error) {
    console.error('迁移失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '迁移失败' },
      { status: 500 }
    );
  }
}
