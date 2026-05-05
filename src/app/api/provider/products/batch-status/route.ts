import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';

/**
 * 服务商产品操作
 * 
 * POST: 单个/批量上架或下架产品
 * PUT: 一键上架所有草稿产品
 * DELETE: 批量删除未上架产品并退回额度
 * 
 * 产品状态流转：
 * - draft（草稿，刚生成）→ available（上架，会员可购买）
 * - available → 下架（如需修改）
 * - sold（已售出，不可删除）
 * - pending_sell（待审核卖出，不可删除）
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { providerId, productIds, action } = body;

    if (!providerId) {
      return NextResponse.json(
        { error: '服务商ID不能为空' },
        { status: 400 }
      );
    }

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json(
        { error: '请选择要操作的产品' },
        { status: 400 }
      );
    }

    // 验证服务商
    const provider = await query<any>(
      `SELECT user_id FROM providers WHERE user_id = $1`,
      [providerId]
    );

    if (!provider || provider.length === 0) {
      return NextResponse.json(
        { error: '服务商不存在' },
        { status: 404 }
      );
    }

    // 获取产品信息
    const products = await query<any>(
      `SELECT id, name, price, status FROM products 
       WHERE id = ANY($1) AND provider_id = $2`,
      [productIds, providerId]
    );

    if (action === 'list') {
      // 上架：draft → available
      const validProductIds = products
        .filter((p: any) => p.status === 'unlisted' || p.status === 'unlisted')
        .map((p: any) => p.id);

      if (validProductIds.length === 0) {
        return NextResponse.json(
          { error: '没有可上架的产品（仅草稿/未上架产品可上架）' },
          { status: 400 }
        );
      }

      await query(
        `UPDATE products SET status = 'available', updated_at = NOW() 
         WHERE id = ANY($1)`,
        [validProductIds]
      );

      const totalAmount = products
        .filter((p: any) => validProductIds.includes(p.id))
        .reduce((sum: number, p: any) => sum + parseFloat(p.price), 0);

      return NextResponse.json({
        success: true,
        message: `已上架 ${validProductIds.length} 个产品，总额 ¥${totalAmount.toLocaleString()}`,
        data: { updatedCount: validProductIds.length, status: 'available' },
      });

    } else if (action === 'unlist') {
      // 下架：available → draft
      const validProductIds = products
        .filter((p: any) => p.status === 'available')
        .map((p: any) => p.id);

      if (validProductIds.length === 0) {
        return NextResponse.json(
          { error: '没有可下架的产品' },
          { status: 400 }
        );
      }

      await query(
        `UPDATE products SET status = 'unlisted', updated_at = NOW() 
         WHERE id = ANY($1)`,
        [validProductIds]
      );

      return NextResponse.json({
        success: true,
        message: `已下架 ${validProductIds.length} 个产品`,
        data: { updatedCount: validProductIds.length, status: 'unlisted' },
      });

    } else {
      return NextResponse.json(
        { error: '无效操作，支持: list(上架), unlist(下架)' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('产品状态更新失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '操作失败' },
      { status: 500 }
    );
  }
}

/**
 * 一键上架所有草稿产品
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

    // 获取所有草稿产品
    const products = await query<any>(
      `SELECT id, price FROM products WHERE provider_id = $1 AND status IN ('unlisted', 'unlisted')`,
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
      `UPDATE products SET status = 'available', updated_at = NOW() 
       WHERE id = ANY($1)`,
      [productIds]
    );

    const totalAmount = products.reduce((sum: number, p: any) => sum + parseFloat(p.price), 0);

    return NextResponse.json({
      success: true,
      message: `已上架全部 ${products.length} 个产品，总额 ¥${totalAmount.toLocaleString()}`,
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

/**
 * 批量删除未上架产品并退回额度
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { providerId, productIds } = body;

    if (!providerId) {
      return NextResponse.json(
        { error: '服务商ID不能为空' },
        { status: 400 }
      );
    }

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json(
        { error: '请选择要删除的产品' },
        { status: 400 }
      );
    }

    // 获取产品信息
    const products = await query<any>(
      `SELECT id, name, price, status FROM products 
       WHERE id = ANY($1) AND provider_id = $2`,
      [productIds, providerId]
    );

    // 只能删除未上架（draft/unlisted）的产品
    const deletableProducts = products.filter(
      (p: any) => p.status === 'unlisted' || p.status === 'unlisted'
    );

    if (deletableProducts.length === 0) {
      return NextResponse.json(
        { error: '没有可删除的产品（已上架或已售出的产品不可删除）' },
        { status: 400 }
      );
    }

    const deletableIds = deletableProducts.map((p: any) => p.id);
    const totalRefund = deletableProducts.reduce(
      (sum: number, p: any) => sum + parseFloat(p.price), 0
    );

    // 批量删除
    await query(
      `DELETE FROM products WHERE id = ANY($1)`,
      [deletableIds]
    );

    // 退回额度
    const now = new Date().toISOString();
    await query(
      `UPDATE providers 
       SET used_quota = GREATEST(0, COALESCE(used_quota, 0) - $1),
           updated_at = $2
       WHERE user_id = $3`,
      [totalRefund, now, providerId]
    );

    return NextResponse.json({
      success: true,
      message: `已删除 ${deletableIds.length} 个产品，¥${totalRefund.toLocaleString()} 额度已退回`,
      data: {
        deletedCount: deletableIds.length,
        refundedAmount: totalRefund,
      },
    });
  } catch (error) {
    console.error('批量删除产品失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '操作失败' },
      { status: 500 }
    );
  }
}
