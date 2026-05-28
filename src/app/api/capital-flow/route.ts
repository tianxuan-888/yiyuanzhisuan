import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';

/**
 * 资金流水统计API
 * GET /api/capital-flow
 * 
 * 查询参数：
 * - userId: 用户ID（可选，不传则查全局）
 * - flowType: 流水类型过滤（可选）：transfer_out, transfer_in, energy_to_points, withdraw, withdraw_income
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
    const summary = searchParams.get('summary') || '';

    const supabase = getSupabase();

    // 构建查询条件 - 不使用外键join，改为分开查询
    let queryBuilder = supabase
      .from('capital_flow_records')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (userId) {
      queryBuilder = queryBuilder.eq('user_id', userId);
    }

    if (flowType && flowType !== 'all') {
      const types = flowType.split(',');
      if (types.length === 1) {
        queryBuilder = queryBuilder.eq('flow_type', types[0]);
      } else {
        queryBuilder = queryBuilder.in('flow_type', types);
      }
    }

    if (startDate) {
      queryBuilder = queryBuilder.gte('created_at', startDate);
    }

    if (endDate) {
      queryBuilder = queryBuilder.lte('created_at', endDate + ' 23:59:59');
    }

    // 分页
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    queryBuilder = queryBuilder.range(from, to);

    const { data: records, count, error } = await queryBuilder;

    if (error) {
      console.error('资金流水查询错误:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const total = count || 0;

    // 获取全部记录用于统计（不分页）
    let statsBuilder = supabase
      .from('capital_flow_records')
      .select('flow_type, amount, fee_amount, actual_amount');

    if (userId) {
      statsBuilder = statsBuilder.eq('user_id', userId);
    }

    if (flowType && flowType !== 'all') {
      const types = flowType.split(',');
      if (types.length === 1) {
        statsBuilder = statsBuilder.eq('flow_type', types[0]);
      } else {
        statsBuilder = statsBuilder.in('flow_type', types);
      }
    }

    if (startDate) {
      statsBuilder = statsBuilder.gte('created_at', startDate);
    }

    if (endDate) {
      statsBuilder = statsBuilder.lte('created_at', endDate + ' 23:59:59');
    }

    const { data: allRecords, error: statsError } = await statsBuilder;

    // 计算统计
    const stats = {
      total_count: allRecords?.length || 0,
      total_transfer_out: 0,
      total_transfer_fee: 0,
      total_transfer_in: 0,
      total_to_points: 0,
      total_withdraw: 0,
      total_withdraw_fee: 0,
      total_withdraw_income: 0,
      total_sell_profit: 0,
      total_recharge: 0,
    };

    (allRecords || []).forEach((r: any) => {
      const amount = parseFloat(String(r.amount)) || 0;
      const fee = parseFloat(String(r.fee_amount)) || 0;
      const actual = parseFloat(String(r.actual_amount)) || 0;

      if (r.flow_type === 'transfer_out') {
        stats.total_transfer_out += amount;
        stats.total_transfer_fee += fee;
      } else if (r.flow_type === 'transfer_in') {
        stats.total_transfer_in += actual;
      } else if (r.flow_type === 'energy_to_points') {
        stats.total_to_points += amount;
      } else if (r.flow_type === 'withdraw') {
        stats.total_withdraw += amount;
        stats.total_withdraw_fee += fee;
      } else if (r.flow_type === 'withdraw_income') {
        stats.total_withdraw_income += actual;
      } else if (r.flow_type === 'sell_profit') {
        stats.total_sell_profit += actual;
      } else if (r.flow_type === 'recharge') {
        stats.total_recharge += actual;
      }
    });

    // 按类型分组统计
    const typeStatsMap: Record<string, { count: number; total_amount: number; total_fee: number; total_actual: number }> = {};
    (allRecords || []).forEach((r: any) => {
      if (!typeStatsMap[r.flow_type]) {
        typeStatsMap[r.flow_type] = { count: 0, total_amount: 0, total_fee: 0, total_actual: 0 };
      }
      typeStatsMap[r.flow_type].count++;
      typeStatsMap[r.flow_type].total_amount += parseFloat(String(r.amount)) || 0;
      typeStatsMap[r.flow_type].total_fee += parseFloat(String(r.fee_amount)) || 0;
      typeStatsMap[r.flow_type].total_actual += parseFloat(String(r.actual_amount)) || 0;
    });

    const typeStats = Object.entries(typeStatsMap).map(([flow_type, data]) => ({
      flow_type,
      ...data,
    }));

    if (summary === '1') {
      return NextResponse.json({
        success: true,
        data: {
          stats,
          typeStats,
        },
      });
    }

    // 收集需要查询关联用户名的ID
    const relatedUserIds = new Set<string>();
    (records || []).forEach((r: any) => {
      if (r.related_user_id) relatedUserIds.add(r.related_user_id);
      if (r.user_id) relatedUserIds.add(r.user_id);
    });

    // 批量查询关联用户信息
    const userNameMap: Record<string, string> = {};
    if (relatedUserIds.size > 0) {
      const { data: relatedUsers } = await supabase
        .from('users')
        .select('id, username, phone, unique_id')
        .in('id', Array.from(relatedUserIds));
      (relatedUsers || []).forEach((u: any) => {
        userNameMap[u.id] = u.username || u.phone || '';
      });
    }

    const flowTypeLabels: Record<string, string> = {
      transfer_out: '智算金转出',
      transfer_in: '智算金转入',
      energy_to_points: '转积分',
      withdraw: '提现',
      withdraw_income: '提现收入',
      sell_profit: '收益',
      recharge: '充值',
    };

    return NextResponse.json({
      success: true,
      data: {
        stats,
        typeStats,
        records: (records || []).map((r: any) => ({
          id: r.id,
          userId: r.user_id,
          userName: userNameMap[r.user_id] || '',
          userPhone: '',
          userUniqueId: '',
          flowType: r.flow_type,
          flowTypeLabel: flowTypeLabels[r.flow_type] || r.flow_type,
          amount: parseFloat(String(r.amount)) || 0,
          feeAmount: parseFloat(String(r.fee_amount)) || 0,
          actualAmount: parseFloat(String(r.actual_amount)) || 0,
          relatedUserId: r.related_user_id,
          relatedUserName: userNameMap[r.related_user_id] || '',
          relatedUserPhone: '',
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
