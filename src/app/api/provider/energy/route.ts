import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

/**
 * 获取服务商收益统计
 * GET /api/provider/energy
 */
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || user.role !== 'provider') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const providerId = user.userId;

    // 获取服务商收益余额
    const userResult = await query(
      'SELECT energy_value, balance FROM users WHERE id = $1',
      [providerId]
    );

    if (userResult.length === 0) {
      return NextResponse.json({ error: '服务商不存在' }, { status: 404 });
    }

    // 获取服务商额度
    const providerResult = await query(
      'SELECT quota, used_quota, total_sales FROM providers WHERE user_id = $1',
      [providerId]
    );

    // 获取收益交易记录
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type'); // recharge, transfer_in, transfer_out
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    let whereClause = 'WHERE (from_user_id = $1 OR to_user_id = $1)';
    const params: any[] = [providerId];

    if (type && type !== 'all') {
      if (type === 'recharge') {
        whereClause += ' AND type = $2';
      } else if (type === 'transfer') {
        whereClause += ' AND type IN ($2, $3)';
        params.push('transfer_in', 'transfer_out');
      }
    }

    // 获取记录总数
    const countResult = await query(
      `SELECT COUNT(*) as count FROM energy_transactions ${whereClause}`,
      params
    );
    const total = parseInt(countResult[0]?.count || '0');

    // 获取记录列表
    const offset = (page - 1) * pageSize;
    const records = await query(
      `SELECT 
        et.id, et.type, et.amount, et.note, et.created_at,
        fu.username as from_username,
        tu.username as to_username
       FROM energy_transactions et
       LEFT JOIN users fu ON et.from_user_id = fu.id
       LEFT JOIN users tu ON et.to_user_id = tu.id
       ${whereClause}
       ORDER BY et.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    // 获取收益统计
    const statsResult = await query(
      `SELECT 
        COALESCE(SUM(CASE WHEN type = 'recharge' THEN amount ELSE 0 END), 0) as total_recharge,
        COALESCE(SUM(CASE WHEN type = 'transfer_in' THEN amount ELSE 0 END), 0) as total_transfer_in,
        COALESCE(SUM(CASE WHEN type = 'transfer_out' THEN amount ELSE 0 END), 0) as total_transfer_out,
        COUNT(CASE WHEN type = 'recharge' THEN 1 END) as recharge_count,
        COUNT(CASE WHEN type = 'transfer_in' THEN 1 END) as transfer_in_count,
        COUNT(CASE WHEN type = 'transfer_out' THEN 1 END) as transfer_out_count
       FROM energy_transactions 
       WHERE to_user_id = $1 OR from_user_id = $1`,
      [providerId]
    );

    return NextResponse.json({
      success: true,
      data: {
        energyValue: userResult[0]?.energy_value || 0,
        balance: userResult[0]?.balance || 0,
        quota: providerResult[0]?.quota || 0,
        usedQuota: providerResult[0]?.used_quota || 0,
        totalSales: providerResult[0]?.total_sales || 0,
        stats: {
          totalRecharge: parseFloat(statsResult[0]?.total_recharge || '0'),
          totalTransferIn: parseFloat(statsResult[0]?.total_transfer_in || '0'),
          totalTransferOut: parseFloat(statsResult[0]?.total_transfer_out || '0'),
          rechargeCount: parseInt(statsResult[0]?.recharge_count || '0'),
          transferInCount: parseInt(statsResult[0]?.transfer_in_count || '0'),
          transferOutCount: parseInt(statsResult[0]?.transfer_out_count || '0'),
        },
        records,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        }
      }
    });
  } catch (error) {
    console.error('获取收益信息失败:', error);
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}
