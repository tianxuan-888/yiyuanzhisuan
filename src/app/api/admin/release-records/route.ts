import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 智算中心查询释放收益记录
// 包含：释放总览统计 + 按服务网点/服务商/会员的明细
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    if (!authorizeRole(authUser, ['admin'])) {
      return NextResponse.json({ error: '只有智算中心管理员可以查看' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const branchId = searchParams.get('branchId');
    const providerId = searchParams.get('providerId');
    const memberId = searchParams.get('memberId');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    // 构建查询条件
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (startDate) {
      whereClause += ` AND r.created_at >= $${paramIndex++}`;
      params.push(startDate + 'T00:00:00Z');
    }
    if (endDate) {
      whereClause += ` AND r.created_at <= $${paramIndex++}`;
      params.push(endDate + 'T23:59:59Z');
    }
    if (branchId) {
      whereClause += ` AND r.branch_id = $${paramIndex++}`;
      params.push(branchId);
    }
    if (providerId) {
      whereClause += ` AND r.provider_id = $${paramIndex++}`;
      params.push(providerId);
    }
    if (memberId) {
      whereClause += ` AND r.member_id = $${paramIndex++}`;
      params.push(memberId);
    }

    // 1. 释放收益统计
    const statsSql = `
      SELECT 
        COUNT(*) as total_count,
        COALESCE(SUM(release_amount), 0) as total_release,
        COALESCE(SUM(member_share), 0) as total_member_share,
        COALESCE(SUM(direct_referral_share), 0) as total_direct_share,
        COALESCE(SUM(provider_share), 0) as total_provider_share,
        COALESCE(SUM(parent_provider_share), 0) as total_parent_provider_share,
        COALESCE(SUM(senior_provider_share), 0) as total_senior_provider_share,
        COALESCE(SUM(branch_share), 0) as total_branch_share,
        COALESCE(SUM(company_share), 0) as total_company_share
      FROM release_records r ${whereClause}
    `;
    const stats = await query<any>(statsSql, params);

    // 2. 释放记录列表（分页）
    const listParams = [...params];
    const listSql = `
      SELECT r.*,
        m.username as member_username, m.phone as member_phone,
        p.username as provider_username, p.phone as provider_phone,
        b.username as branch_username
      FROM release_records r
      LEFT JOIN users m ON r.member_id = m.id
      LEFT JOIN users p ON r.provider_id = p.id
      LEFT JOIN users b ON r.branch_id = b.id
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    listParams.push(pageSize, (page - 1) * pageSize);
    const records = await query<any>(listSql, listParams);

    // 3. 按服务网点分组统计
    const branchStatsSql = `
      SELECT r.branch_id, b.username as branch_name,
        COUNT(*) as count,
        COALESCE(SUM(r.release_amount), 0) as total_release,
        COALESCE(SUM(r.branch_share), 0) as total_branch_share
      FROM release_records r
      LEFT JOIN users b ON r.branch_id = b.id
      ${whereClause}
      GROUP BY r.branch_id, b.username
      ORDER BY total_release DESC
    `;
    const branchStats = await query<any>(branchStatsSql, params);

    // 4. 总记录数
    const countSql = `SELECT COUNT(*) as total FROM release_records r ${whereClause}`;
    const countResult = await query<any>(countSql, params);
    const total = countResult?.[0]?.total || 0;

    return NextResponse.json({
      success: true,
      data: {
        stats: stats?.[0] || {},
        records,
        branchStats,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      },
    });
  } catch (error) {
    console.error('获取释放收益记录失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取释放收益记录失败' },
      { status: 500 }
    );
  }
}
