import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

// 获取服务网点下的会员列表
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const branchId = searchParams.get('branchId');
    const providerId = searchParams.get('providerId'); // 可选：按服务商筛选
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    if (!branchId) {
      return NextResponse.json(
        { error: '缺少服务网点ID参数' },
        { status: 400 }
      );
    }

    // 获取该服务网点下的所有服务商ID - 优先从 providers 表获取
    const providers = await query<{ user_id: string }>(
      `SELECT user_id FROM providers WHERE branch_id = $1 AND is_active = true`,
      [branchId]
    );

    const providerIds = providers.map(p => p.user_id);
    console.log('[branch/members] 服务网点ID:', branchId, '找到服务商:', providerIds);

    // 构建会员查询条件
    let members: any[] = [];
    let totalCount = 0;

    if (providerIds.length > 0 || providerId) {
      // 获取会员总数
      let countQuery = `SELECT COUNT(*) as count FROM users WHERE role = 'member'`;
      let membersQuery = `SELECT * FROM users WHERE role = 'member'`;
      const params: any[] = [];
      let paramIndex = 1;

      if (providerId) {
        countQuery += ` AND provider_id = $${paramIndex}`;
        membersQuery += ` AND provider_id = $${paramIndex}`;
        params.push(providerId);
        paramIndex++;
      } else {
        countQuery += ` AND provider_id = ANY($${paramIndex})`;
        membersQuery += ` AND provider_id = ANY($${paramIndex})`;
        params.push(providerIds);
        paramIndex++;
      }

      // 获取总数
      const countResult = await queryOne<{ count: string }>(countQuery, providerId ? [providerId] : [providerIds]);
      totalCount = countResult ? parseInt(countResult.count) : 0;

      // 获取会员列表（分页）
      membersQuery += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(pageSize, (page - 1) * pageSize);
      members = await query(membersQuery, params);
    }

    // 获取会员的投资统计
    const memberIds = members.map(m => m.id);
    let memberStats: Record<string, { totalInvestment: number; productCount: number }> = {};

    if (memberIds.length > 0) {
      // 获取会员购买的产品
      const userProducts = await query<{ user_id: string; purchase_price: string; status: string }>(
        `SELECT user_id, purchase_price, status FROM user_products WHERE user_id = ANY($1)`,
        [memberIds]
      );

      // 计算每个会员的投资金额
      userProducts.forEach(up => {
        if (!memberStats[up.user_id]) {
          memberStats[up.user_id] = { totalInvestment: 0, productCount: 0 };
        }
        memberStats[up.user_id].totalInvestment += parseFloat(up.purchase_price) || 0;
        if (up.status === 'holding') {
          memberStats[up.user_id].productCount += 1;
        }
      });
    }

    // 获取服务商名称映射
    const providerNames: Record<string, string> = {};
    if (providerIds.length > 0) {
      const providers = await query<{ id: string; username: string; real_name: string }>(
        `SELECT id, username, real_name FROM users WHERE id = ANY($1)`,
        [providerIds]
      );
      
      providers.forEach(p => {
        providerNames[p.id] = p.real_name || p.username;
      });
    }

    // 处理会员数据
    const processedMembers = members.map(m => ({
      id: m.id,
      username: m.username,
      realName: m.real_name || '',
      phone: m.phone || '',
      uniqueId: m.unique_id || '',
      
      balance: parseFloat(m.balance || '0'),
      buyLocked: m.buy_locked || false,
      providerId: m.provider_id,
      providerName: providerNames[m.provider_id] || '未知',
      inviterId: m.inviter_id,
      createdAt: m.created_at,
      totalInvestment: memberStats[m.id]?.totalInvestment || 0,
      holdingProducts: memberStats[m.id]?.productCount || 0,
    }));

    return NextResponse.json({
      success: true,
      data: {
        members: processedMembers,
        stats: {
          totalMembers: totalCount,
          activeMembers: processedMembers.length,
        },
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        },
      },
    });
  } catch (error) {
    console.error('获取会员列表失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取会员列表失败' },
      { status: 500 }
    );
  }
}
