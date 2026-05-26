import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/pg-client';

/**
 * 资金流水统计API
 * GET /api/capital-flow
 * 
 * 查询参数：
 * - userId: 用户ID（可选，不传则查全局）
 * - flowType: 流水类型过滤（可选）：transfer_out, transfer_in, energy_to_points, withdraw, recharge, sell_profit
 * - page: 页码（默认1）
 * - pageSize: 每页数量（默认20）
 * - startDate: 开始日期（可选）
 * - endDate: 结束日期（可选）
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || '';
    const flowType = searchParams.get('flowType') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';
    const summary = searchParams.get('summary') || ''; // summary=1 只返回统计

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (userId) {
      conditions.push(`cfr.user_id = $${paramIndex}`);
      params.push(userId);
      paramIndex++;
    }

    if (flowType && flowType !== 'all') {
      const types = flowType.split(',');
      const placeholders = types.map((_, i) => `$${paramIndex + i}`).join(', ');
      conditions.push(`cfr.flow_type IN (${placeholders})`);
      types.forEach(t => params.push(t));
      paramIndex += types.length;
    }

    if (startDate) {
      conditions.push(`cfr.created_at >= $${paramIndex}`);
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      conditions.push(`cfr.created_at <= $${paramIndex}`);
      params.push(endDate + ' 23:59:59');
      paramIndex++;
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    // 统计汇总
    const statsSql = `
      SELECT 
        COUNT(*) as total_count,
        COALESCE(SUM(CASE WHEN flow_type = 'transfer_out' THEN amount ELSE 0 END), 0) as total_transfer_out,
        COALESCE(SUM(CASE WHEN flow_type = 'transfer_out' THEN fee_amount ELSE 0 END), 0) as total_transfer_fee,
        COALESCE(SUM(CASE WHEN flow_type = 'transfer_in' THEN actual_amount ELSE 0 END), 0) as total_transfer_in,
        COALESCE(SUM(CASE WHEN flow_type = 'energy_to_points' THEN amount ELSE 0 END), 0) as total_to_points,
        COALESCE(SUM(CASE WHEN flow_type = 'withdraw' THEN amount ELSE 0 END), 0) as total_withdraw,
        COALESCE(SUM(CASE WHEN flow_type = 'withdraw' THEN fee_amount ELSE 0 END), 0) as total_withdraw_fee,
        COALESCE(SUM(CASE WHEN flow_type = 'recharge' THEN amount ELSE 0 END), 0) as total_recharge
      FROM capital_flow_records cfr
      ${whereClause}
    `;

    const statsResult: any = await queryOne(statsSql, params);

    // 按类型分组统计
    const typeStatsSql = `
      SELECT 
        flow_type,
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as total_amount,
        COALESCE(SUM(fee_amount), 0) as total_fee,
        COALESCE(SUM(actual_amount), 0) as total_actual
      FROM capital_flow_records cfr
      ${whereClause}
      GROUP BY flow_type
      ORDER BY total_amount DESC
    `;

    const typeStats: any = await query(typeStatsSql, params);

    if (summary === '1') {
      return NextResponse.json({
        success: true,
        data: {
          stats: statsResult,
          typeStats: typeStats || [],
        },
      });
    }

    // 查询明细列表
    const offset = (page - 1) * pageSize;
    const listSql = `
      SELECT 
        cfr.id,
        cfr.user_id,
        cfr.flow_type,
        cfr.amount,
        cfr.fee_amount,
        cfr.actual_amount,
        cfr.related_user_id,
        cfr.note,
        cfr.status,
        cfr.created_at,
        u1.username as user_name,
        u1.phone as user_phone,
        u1.unique_id as user_unique_id,
        u2.username as related_user_name,
        u2.phone as related_user_phone
      FROM capital_flow_records cfr
      LEFT JOIN users u1 ON u1.id::text = cfr.user_id
      LEFT JOIN users u2 ON u2.id::text = cfr.related_user_id
      ${whereClause}
      ORDER BY cfr.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const records: any = await query(listSql, params);

    // 总数
    const countSql = `SELECT COUNT(*) as total FROM capital_flow_records cfr ${whereClause}`;
    const countResult: any = await queryOne(countSql, params);
    const total = parseInt(String(countResult?.total)) || 0;

    const flowTypeLabels: Record<string, string> = {
      transfer_out: '智算金转出',
      transfer_in: '智算金转入',
      energy_to_points: '转积分',
      withdraw: '提现',
      recharge: '充值',
    };

    return NextResponse.json({
      success: true,
      data: {
        stats: statsResult,
        typeStats: typeStats || [],
        records: (records || []).map((r: any) => ({
          id: r.id,
          userId: r.user_id,
          userName: r.user_name,
          userPhone: r.user_phone,
          userUniqueId: r.user_unique_id,
          flowType: r.flow_type,
          flowTypeLabel: flowTypeLabels[r.flow_type] || r.flow_type,
          amount: parseFloat(String(r.amount)) || 0,
          feeAmount: parseFloat(String(r.fee_amount)) || 0,
          actualAmount: parseFloat(String(r.actual_amount)) || 0,
          relatedUserId: r.related_user_id,
          relatedUserName: r.related_user_name,
          relatedUserPhone: r.related_user_phone,
          note: r.note,
          status: r.status,
          createdAt: r.created_at,
        })),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      },
    });
  } catch (error) {
    console.error('资金流水查询失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '查询失败' },
      { status: 500 }
    );
  }
}
