import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

/**
 * 获取服务商产品列表
 * GET /api/provider/products
 */
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || user.role !== 'provider') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    // 优先使用查询参数中的 providerId，否则使用 token 中的 userId
    const searchParams = request.nextUrl.searchParams;
    const queryProviderId = searchParams.get('providerId');
    const providerId = queryProviderId || user.userId;
    const status = searchParams.get('status'); // available, sold, all

    // 构建查询
    let whereClause = 'WHERE provider_id = $1';
    const params: any[] = [providerId];

    if (status && status !== 'all') {
      whereClause += ' AND status = $2';
      params.push(status);
    }

    // 获取产品列表
    const products = await query(
      `SELECT 
        id, name, code, price, period, total_rate, market_rate, profit_rate,
        status, created_at, updated_at
       FROM products 
       ${whereClause}
       ORDER BY created_at DESC`,
      params
    );

    // 为已出售/待确认产品关联持有会员信息
    const soldProductIds = products
      .filter((p: any) => p.status === 'sold' || p.status === 'pending_sell' || p.status === 'pending_confirm' || p.status === 'pending_match')
      .map((p: any) => p.id);

    let holderMap: Record<string, { userId: string; username: string; phone: string; uniqueId: string; status: string }> = {};

    if (soldProductIds.length > 0) {
      const userProducts = await query(
        `SELECT up.product_id, up.user_id, up.status as holding_status, u.username, u.phone, u.unique_id
         FROM user_products up
         JOIN users u ON up.user_id = u.id
         WHERE up.product_id = ANY($1) AND up.status IN ('holding', 'pending_sell', 'pending_confirm', 'transferring')`,
        [soldProductIds]
      );

      for (const up of userProducts) {
        // 只取最新的持有人（holding 优先）
        if (!holderMap[up.product_id] || up.holding_status === 'holding') {
          holderMap[up.product_id] = {
            userId: up.user_id,
            username: up.username || '',
            phone: up.phone || '',
            uniqueId: up.unique_id || '',
            status: up.holding_status || '',
          };
        }
      }
    }

    // 将持有会员信息附加到产品数据
    const productsWithHolder = products.map((p: any) => ({
      ...p,
      holder: holderMap[p.id] || null,
    }));

    // 获取统计数据
    const statsResult = await query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
        SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold,
        SUM(CASE WHEN status IN ('unlisted', 'pending_sell') THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'available' THEN price ELSE 0 END) as available_amount,
        SUM(CASE WHEN status = 'sold' THEN price ELSE 0 END) as sold_amount,
        SUM(CASE WHEN status IN ('unlisted', 'pending_sell') THEN price ELSE 0 END) as pending_amount,
        SUM(price) as total_value
       FROM products WHERE provider_id = $1`,
      [providerId]
    );

    return NextResponse.json({
      success: true,
      data: {
        products: productsWithHolder,
        stats: {
          total: parseInt(statsResult[0]?.total || '0'),
          available: parseInt(statsResult[0]?.available || '0'),
          sold: parseInt(statsResult[0]?.sold || '0'),
          pending: parseInt(statsResult[0]?.pending || '0'),
          availableAmount: parseFloat(statsResult[0]?.available_amount || '0'),
          soldAmount: parseFloat(statsResult[0]?.sold_amount || '0'),
          pendingAmount: parseFloat(statsResult[0]?.pending_amount || '0'),
          totalValue: parseFloat(statsResult[0]?.total_value || '0')
        }
      }
    });
  } catch (error) {
    console.error('获取产品列表失败:', error);
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}

/**
 * 批量更新产品状态（一键上架/下架）
 * PUT /api/provider/products
 */
export async function PUT(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || user.role !== 'provider') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const providerId = user.userId;
    const { productIds, status } = await request.json();

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json({ error: '请选择产品' }, { status: 400 });
    }

    if (!['available', 'sold'].includes(status)) {
      return NextResponse.json({ error: '无效的状态' }, { status: 400 });
    }

    // 更新产品状态
    const result = await query(
      `UPDATE products SET status = $1, updated_at = NOW() 
       WHERE id = ANY($2) AND provider_id = $3
       RETURNING id`,
      [status, productIds, providerId]
    );

    return NextResponse.json({
      success: true,
      data: {
        updatedCount: result.length,
      }
    });
  } catch (error) {
    console.error('更新产品状态失败:', error);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}
