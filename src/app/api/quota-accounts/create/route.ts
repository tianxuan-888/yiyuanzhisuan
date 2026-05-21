import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 智算总台增加额度
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅管理员可操作
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['admin'])) {
      return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
    }

    const body = await request.json();
    const { amount, note } = body;

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json(
        { success: false, error: '金额必须大于0' },
        { status: 400 }
      );
    }

    // 智算总台管理员ID (正确的UUID)
    const ADMIN_ID = '00000000-0000-0000-0000-000000000001';

    // 增加智算总台余额
    await query(
      `INSERT INTO quota_accounts (user_id, balance, total_in, total_out, created_at, updated_at)
       VALUES ($1, $2, $3, 0, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         balance = quota_accounts.balance + $2,
         total_in = quota_accounts.total_in + $3,
         updated_at = NOW()`,
      [ADMIN_ID, amount, amount]
    );

    // 记录创建
    await query(
      `INSERT INTO quota_records (from_user_id, to_user_id, amount, type, note)
       VALUES (NULL, $1, $2, 'create', $3)`,
      [ADMIN_ID, amount, note || '智算总台创建额度']
    );

    return NextResponse.json({
      success: true,
      message: '额度创建成功',
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
