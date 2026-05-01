import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 获取服务商产品的销售记录（包含当前持有人）
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const status = searchParams.get('status'); // available, sold, all

    // 获取服务商ID
    const providerResult = await query(
      `SELECT id, user_id FROM providers WHERE user_id = $1 LIMIT 1`,
      [authUser.userId]
    );

    if (!providerResult || providerResult.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          records: [],
          stats: {
            total: 0,
            available: 0,
            sold: 0,
            totalAmount: 0
          }
        }
      });
    }

    const providerId = providerResult[0].id;

    // 构建查询条件
    let whereClause = 'WHERE p.provider_id = $1';
    const params: any[] = [providerId];

    if (status === 'available') {
      whereClause += ' AND p.status = $2';
      params.push('available');
    } else if (status === 'sold') {
      whereClause += ' AND p.status = $2';
      params.push('sold');
    }

    // 获取产品销售记录（包含当前持有人信息）
    const offset = (page - 1) * pageSize;
    const limitIndex = params.length + 1;
    const offsetIndex = params.length + 2;

    const sql = `
      SELECT 
        p.id as product_id,
        p.name,
        p.code,
        p.price,
        p.period,
        p.total_rate,
        p.market_rate,
        p.profit_rate,
        p.status as product_status,
        p.created_at as product_created_at,
        p.updated_at as product_updated_at,
        -- 订单信息
        o.id as order_id,
        o.order_type,
        o.status as order_status,
        o.amount,
        o.created_at as order_created_at,
        -- 当前持有人信息（从user_products获取最新持仓）
        up.id as holding_id,
        up.status as holding_status,
        up.purchase_price,
        up.purchase_date,
        up.expire_date,
        up.expected_profit,
        holder.id as holder_id,
        holder.username as holder_name,
        holder.phone as holder_phone
      FROM products p
      LEFT JOIN orders o ON o.product_id = p.id AND o.order_type = 'buy' AND o.status = 'completed'
      LEFT JOIN user_products up ON up.product_id = p.id AND up.status = 'holding'
      LEFT JOIN users holder ON up.user_id = holder.id
      ${whereClause}
      ORDER BY p.updated_at DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `;

    params.push(pageSize, offset);
    const records = await query(sql, params);

    // 统计
    const statsSql = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE p.status = 'available') as available,
        COUNT(*) FILTER (WHERE p.status = 'sold') as sold,
        COALESCE(SUM(p.price) FILTER (WHERE p.status = 'sold'), 0) as total_sold_amount
      FROM products p
      WHERE p.provider_id = $1
    `;
    const statsResult = await query(statsSql, [providerId]);
    const stats = statsResult[0] || { total: 0, available: 0, sold: 0, total_sold_amount: 0 };

    // 获取总数
    const countSql = `SELECT COUNT(*) as total FROM products p ${whereClause}`;
    const countParams = params.slice(0, status ? 2 : 1);
    const countResult = await query(countSql, countParams);
    const total = parseInt(countResult[0]?.total || '0');

    return NextResponse.json({
      success: true,
      data: {
        records: records.map(r => ({
          productId: r.product_id,
          name: r.name,
          code: r.code,
          price: r.price,
          period: r.period,
          totalRate: r.total_rate,
          marketRate: r.market_rate,
          profitRate: r.profit_rate,
          productStatus: r.product_status,
          productCreatedAt: r.product_created_at,
          productUpdatedAt: r.product_updated_at,
          order: r.order_id ? {
            id: r.order_id,
            type: r.order_type,
            status: r.order_status,
            amount: r.amount,
            createdAt: r.order_created_at
          } : null,
          holder: r.holder_id ? {
            id: r.holder_id,
            name: r.holder_name,
            phone: r.holder_phone,
            holdingStatus: r.holding_status,
            purchasePrice: r.purchase_price,
            purchaseDate: r.purchase_date,
            expireDate: r.expire_date,
            expectedProfit: r.expected_profit
          } : null
        })),
        stats: {
          total: parseInt(stats.total),
          available: parseInt(stats.available),
          sold: parseInt(stats.sold),
          totalAmount: parseFloat(stats.total_sold_amount)
        },
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize)
        }
      }
    });
  } catch (error) {
    console.error('获取产品销售记录失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '服务器错误'
    }, { status: 500 });
  }
}
