import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/supabase-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get('keyword') || '';

    if (!keyword || keyword.length < 1) {
      return NextResponse.json({ success: true, data: [] });
    }

    // Search by username, phone, or unique_id - exclude admin users
    const sql = `
      SELECT id, username, phone, unique_id, role, balance, points, real_name
      FROM users
      WHERE role != 'admin'
        AND is_active = true
        AND (
          username ILIKE $1
          OR phone ILIKE $1
          OR unique_id ILIKE $1
        )
      ORDER BY
        CASE
          WHEN phone = $2 THEN 0
          WHEN unique_id = $2 THEN 0
          ELSE 1
        END,
        username ASC
      LIMIT 20
    `;

    const users = await query(sql, [`%${keyword}%`, keyword]);

    const roleLabels: Record<string, string> = {
      branch: '服务网点',
      provider: '服务商',
      member: '会员',
    };

    const result = users.map((u: any) => ({
      id: u.id,
      username: u.username,
      phone: u.phone,
      uniqueId: u.unique_id,
      role: u.role,
      roleLabel: roleLabels[u.role] || u.role,
      balance: u.balance || 0,
      points: u.points || 0,
      realName: u.real_name || '-',
    }));

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[users/search] error:', error);
    return NextResponse.json({ success: true, data: [] });
  }
}
