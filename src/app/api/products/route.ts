import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取产品列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const providerId = searchParams.get('providerId');
    const memberId = searchParams.get('memberId');

    let sql = 'SELECT * FROM products';
    const params: any[] = [];
    let conditions: string[] = [];
    let paramIndex = 1;

    // 如果是服务商查询，返回该服务商的所有产品（包括未上架的）
    if (providerId) {
      conditions.push(`provider_id = $${paramIndex}`);
      params.push(providerId);
      paramIndex++;
      // 服务商查询：允许看到所有状态的产品（包括已售出的）
      if (status && status !== 'all') {
        conditions.push(`status = $${paramIndex}`);
        params.push(status);
        paramIndex++;
      }
    } else if (memberId) {
      // 如果是会员查询，只显示该会员服务商的产品
      const memberResult = await query<{ provider_id: string }>(
        `SELECT provider_id FROM users WHERE id = $1`,
        [memberId]
      );

      if (memberResult.length > 0 && memberResult[0].provider_id) {
        conditions.push(`provider_id = $${paramIndex}`);
        params.push(memberResult[0].provider_id);
        paramIndex++;
      }
      // 会员只能看到已上架的产品
      conditions.push(`status = 'available'`);
    } else {
      // 其他查询：只显示已上架的可用产品
      if (status && status !== 'all') {
        conditions.push(`status = $${paramIndex}`);
        params.push(status);
        paramIndex++;
      } else {
        conditions.push(`status IN ('available', 'unlisted')`);
      }
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';

    const products = await query(sql, params);

    // 转换数值字段为数字类型
    const formattedProducts = products.map(p => ({
      ...p,
      price: Number(p.price),
      total_rate: parseFloat(p.total_rate).toFixed(2),
      market_rate: parseFloat(p.market_rate).toFixed(2),
      profit_rate: parseFloat(p.profit_rate).toFixed(2),
    }));

    // 为已出售产品关联持有会员信息
    const soldProductIds = formattedProducts
      .filter((p: any) => p.status === 'sold')
      .map((p: any) => p.id);

    let holderMap: Record<string, { userId: string; username: string; phone: string; uniqueId: string }> = {};

    if (soldProductIds.length > 0) {
      // 查询 user_products 关联表获取持有会员
      const userProducts = await query(
        `SELECT up.product_id, up.user_id, u.username, u.phone, u.unique_id
         FROM user_products up
         JOIN users u ON up.user_id = u.id
         WHERE up.product_id = ANY($1) AND up.status IN ('holding', 'pending_sell')`,
        [soldProductIds]
      );

      for (const up of userProducts) {
        holderMap[up.product_id] = {
          userId: up.user_id,
          username: up.username || '',
          phone: up.phone || '',
          uniqueId: up.unique_id || '',
        };
      }
    }

    // 将持有会员信息附加到产品数据
    const productsWithHolder = formattedProducts.map((p: any) => ({
      ...p,
      holder: holderMap[p.id] || null,
    }));

    return NextResponse.json({
      success: true,
      data: productsWithHolder,
    });
  } catch (error) {
    console.error('获取产品列表失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取产品列表失败' },
      { status: 500 }
    );
  }
}

// POST 方法需要单独导入
import { queryOne } from '@/storage/database/pg-client';

// 创建产品
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      code,
      imageUrl,
      price,
      period,
      totalRate,
      marketRate,
      profitRate,
      providerId,
    } = body;

    // 参数验证
    if (!name || !code || !price || !period || !totalRate || !marketRate || !profitRate) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 生成产品ID
    const productId = crypto.randomUUID();
    const now = new Date().toISOString();

    // 插入产品
    await query(
      `INSERT INTO products (id, name, code, image_url, price, period, total_rate, market_rate, profit_rate, provider_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'unlisted', $11, $11)`,
      [productId, name, code, imageUrl || null, price, period, totalRate, marketRate, profitRate, providerId || null, now]
    );

    // 获取创建的产品
    const product = await queryOne(
      `SELECT * FROM products WHERE id = $1`,
      [productId]
    );

    return NextResponse.json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error('创建产品失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建产品失败' },
      { status: 500 }
    );
  }
}
