import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取分公司提现申请列表（总公司审核用）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'all';

    // 获取分公司提现申请
    let sql = `
      SELECT qr.*, u.username as requester_name, u.phone as requester_phone
      FROM quota_requests qr
      JOIN users u ON qr.requester_id = u.id
      WHERE qr.requester_type = 'branch'
    `;
    const params: any[] = [];

    if (status !== 'all') {
      sql += ' AND qr.status = $1';
      params.push(status);
    }

    sql += ' ORDER BY qr.created_at DESC';

    const records = await query(sql, params);

    // 获取5%手续费沉淀记录
    const depositRecords = await query(
      `SELECT * FROM transactions 
       WHERE type = 'deposit' OR description LIKE '%沉淀%'
       ORDER BY created_at DESC LIMIT 100`
    );

    const totalDeposit = depositRecords.reduce((sum: number, r: any) => sum + parseFloat(r.amount || 0), 0);

    return NextResponse.json({
      success: true,
      data: {
        records: records || [],
        stats: {
          total: records?.length || 0,
          pending: records?.filter((r: any) => r.status === 'pending').length || 0,
          totalDeposit,
        },
      },
    });
  } catch (error: any) {
    console.error('获取提现申请失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
