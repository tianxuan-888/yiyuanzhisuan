import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

/**
 * 服务商上架产品（单个或批量）
 * 状态从 'unlisted' 改为 'available'
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { providerId, productIds, action } = body;

    // 参数验证
    if (!providerId) {
      return NextResponse.json(
        { error: '服务商ID不能为空' },
        { status: 400 }
      );
    }

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json(
        { error: '请选择要上架的产品' },
        { status: 400 }
      );
    }

    // 验证服务商
    const provider = await query<any>(
      `SELECT user_id FROM providers WHERE user_id = $1 AND is_active = true`,
      [providerId]
    );

    if (!provider) {
      return NextResponse.json(
        { error: '服务商不存在' },
        { status: 404 }
      );
    }

    // 验证产品是否属于该服务商且状态为 'unlisted'
    const products = await query<any>(
      `SELECT id, name, price, status FROM products 
       WHERE id = ANY($1) AND provider_id = $2`,
      [productIds, providerId]
    );

    const validProductIds = products
      .filter((p: any) => p.status === 'unlisted')
      .map((p: any) => p.id);

    if (validProductIds.length === 0) {
      return NextResponse.json(
        { error: '没有可上架的产品（可能已上架或不属于您）' },
        { status: 400 }
      );
    }

    // 上架产品
    const newStatus = action === 'unlist' ? 'unlisted' : 'available';
    await query(
      `UPDATE products SET status = $1, is_listed = $2, updated_at = NOW() 
       WHERE id = ANY($3)`,
      [newStatus, newStatus === 'available', validProductIds]
    );

    // 发送通知（如果是上架）
    if (newStatus === 'available') {
      const totalAmount = products
        .filter((p: any) => validProductIds.includes(p.id))
        .reduce((sum: number, p: any) => sum + parseFloat(p.price), 0);

      const notifId = crypto.randomUUID();
      await query(
        `INSERT INTO notifications (id, receiver_id, receiver_role, type, title, content, created_at)
         VALUES ($1, $2, 'provider', 'product_listed', '产品已上架', $3, NOW())`,
        [notifId, providerId, `已上架 ${validProductIds.length} 个产品，总额 ${totalAmount.toLocaleString()} 元，等待会员购买`]
      );
    }

    return NextResponse.json({
      success: true,
      message: `已${newStatus === 'available' ? '上架' : '下架'} ${validProductIds.length} 个产品`,
      data: {
        updatedCount: validProductIds.length,
        status: newStatus,
      },
    });
  } catch (error) {
    console.error('产品状态更新失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '操作失败' },
      { status: 500 }
    );
  }
}

/**
 * 批量上架所有未上架产品
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { providerId } = body;

    if (!providerId) {
      return NextResponse.json(
        { error: '服务商ID不能为空' },
        { status: 400 }
      );
    }

    // 获取所有未上架产品
    const products = await query<any>(
      `SELECT id, price FROM products WHERE provider_id = $1 AND status = 'unlisted'`,
      [providerId]
    );

    if (products.length === 0) {
      return NextResponse.json(
        { error: '没有待上架的产品' },
        { status: 400 }
      );
    }

    const productIds = products.map((p: any) => p.id);

    // 批量上架
    await query(
      `UPDATE products SET status = 'available', is_listed = true, updated_at = NOW() 
       WHERE id = ANY($1)`,
      [productIds]
    );

    const totalAmount = products.reduce((sum: number, p: any) => sum + parseFloat(p.price), 0);

    return NextResponse.json({
      success: true,
      message: `已上架全部 ${products.length} 个产品`,
      data: {
        updatedCount: products.length,
        totalAmount: totalAmount,
      },
    });
  } catch (error) {
    console.error('批量上架失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '操作失败' },
      { status: 500 }
    );
  }
}
