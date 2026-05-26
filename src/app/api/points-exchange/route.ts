import { NextRequest, NextResponse } from 'next/server';
import { query, execute } from '@/lib/pg-client';

// POST - 兑换商品
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, productId, receiverName, receiverPhone, receiverAddress } = body;

    if (!userId || !productId || !receiverName || !receiverPhone || !receiverAddress) {
      return NextResponse.json({ success: false, error: '缺少必填信息' }, { status: 400 });
    }

    // 1. 查询商品信息
    const products = await query('SELECT * FROM points_products WHERE id = $1 AND status = $2', [productId, 'active']);
    const product = products?.[0];

    if (!product) {
      return NextResponse.json({ success: false, error: '商品不存在或已下架' }, { status: 400 });
    }

    // 2. 检查库存（stock > 0 表示有限库存，-1 表示无限库存）
    if (product.stock > 0) {
      const stockResult = await execute(
        'UPDATE points_products SET stock = stock - 1, updated_at = NOW() WHERE id = $1 AND stock > 0',
        [productId]
      );
      if (stockResult.rowCount === 0) {
        return NextResponse.json({ success: false, error: '库存不足' }, { status: 400 });
      }
    }

    // 3. 查询用户积分
    const users = await query('SELECT id, username, points FROM users WHERE id = $1', [userId]);
    const user = users?.[0];

    if (!user) {
      return NextResponse.json({ success: false, error: '用户不存在' }, { status: 400 });
    }

    if ((user.points || 0) < product.points_price) {
      return NextResponse.json({ success: false, error: `积分不足，需要 ${product.points_price} 积分，当前 ${user.points || 0} 积分` }, { status: 400 });
    }

    // 4. 扣除积分
    const deductResult = await execute(
      'UPDATE users SET points = points - $1, updated_at = NOW() WHERE id = $2 AND points >= $1',
      [product.points_price, userId]
    );

    if (deductResult.rowCount === 0) {
      return NextResponse.json({ success: false, error: '扣除积分失败' }, { status: 500 });
    }

    // 5. 创建兑换订单
    try {
      const orders = await query(
        `INSERT INTO points_exchange_orders (user_id, product_id, product_name, points_cost, receiver_name, receiver_phone, receiver_address, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING *`,
        [userId, productId, product.name || '', product.points_price, receiverName, receiverPhone, receiverAddress]
      );

      return NextResponse.json({
        success: true,
        data: {
          order: orders[0],
          remainingPoints: (user.points || 0) - product.points_price
        },
        message: '兑换成功'
      });
    } catch (orderError) {
      // 回滚积分
      await execute('UPDATE users SET points = points + $1 WHERE id = $2', [product.points_price, userId]);
      throw orderError;
    }
  } catch (error: any) {
    console.error('兑换商品失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// GET - 获取用户兑换记录
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    let sql = `SELECT eo.*, pp.name as product_name, pp.image_url, pp.points_price
      FROM points_exchange_orders eo
      LEFT JOIN points_products pp ON eo.product_id = pp.id`;
    const params: any[] = [];

    if (userId) {
      sql += ` WHERE eo.user_id = $1`;
      params.push(userId);
    }
    sql += ` ORDER BY eo.created_at DESC`;

    const records = await query(sql, params);

    return NextResponse.json({ success: true, data: records });
  } catch (error: any) {
    console.error('获取兑换记录失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
