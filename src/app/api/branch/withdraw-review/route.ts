import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取分公司下的所有待审核提现申请（来自服务商）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    const status = searchParams.get('status');

    if (!branchId) {
      return NextResponse.json({ error: '分公司ID不能为空' }, { status: 400 });
    }

    // 查询服务商申请（通过 parent_id 关联分公司）
    let sql = `
      SELECT qr.*, u.username, u.phone
      FROM quota_requests qr
      JOIN users u ON qr.requester_id = u.id
      WHERE qr.requester_type = 'provider'
    `;
    const params: any[] = [];
    let idx = 1;

    if (status && status !== 'all') {
      sql += ` AND qr.status = $${idx++}`;
      params.push(status);
    }

    sql += ' ORDER BY qr.created_at DESC';

    const requests = await query(sql, params);

    // 过滤属于该分公司的申请
    const filteredRequests = requests.filter((r: any) => r.parent_id === branchId);

    if (!filteredRequests || filteredRequests.length === 0) {
      return NextResponse.json({
        success: true,
        data: { records: [], stats: { total: 0, pending: 0, totalAmount: 0, totalFee: 0 } }
      });
    }

    const total = filteredRequests.length;
    const pending = filteredRequests.filter((r: any) => r.status === 'pending').length;
    const totalAmount = filteredRequests.reduce((sum: number, r: any) => sum + parseFloat(r.requested_amount || 0), 0);
    const totalFee = filteredRequests.reduce((sum: number, r: any) => sum + parseFloat(r.fee_amount || 0), 0);

    return NextResponse.json({
      success: true,
      data: {
        records: filteredRequests,
        stats: { total, pending, totalAmount, totalFee }
      }
    });
  } catch (error: any) {
    console.error('获取提现申请失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
