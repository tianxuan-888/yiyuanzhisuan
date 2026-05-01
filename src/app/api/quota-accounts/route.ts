import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const role = searchParams.get('role');

    let sql = `
      SELECT qa.*, u.username, u.role, u.phone
      FROM quota_accounts qa
      LEFT JOIN users u ON u.id = qa.user_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (userId) {
      sql += ` AND qa.user_id = $${params.length + 1}`;
      params.push(userId);
    }

    if (role) {
      sql += ` AND u.role = $${params.length + 1}`;
      params.push(role);
    }

    sql += ` ORDER BY qa.created_at DESC`;

    const accounts = await query(sql, params);

    return NextResponse.json({
      success: true,
      data: accounts,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, amount, note } = body;

    if (!userId || !amount) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 插入额度账户
    await query(
      `INSERT INTO quota_accounts (user_id, balance, total_in, total_out)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, 0, 0, 0]
    );

    return NextResponse.json({
      success: true,
      message: '额度账户创建成功',
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
