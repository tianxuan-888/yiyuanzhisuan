import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

/**
 * 服务商后台 - Token存储包售卖统计
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');
    const viewType = searchParams.get('viewType') || 'provider'; // provider / branch / admin

    let sql: string;
    let params: any[] = [];

    if (viewType === 'admin') {
      // 总后台 - 查看所有
      sql = `
        SELECT 
          p.id, p.name, p.code, p.price, p.period, p.status, p.created_at,
          pr.name as provider_name, pr.user_id as provider_id,
          u.username as member_name
        FROM products p
        LEFT JOIN providers pr ON p.provider_id = pr.user_id
        LEFT JOIN user_products up ON p.id = up.product_id
        LEFT JOIN users u ON up.user_id = u.id
        ORDER BY p.created_at DESC
      `;
    } else if (viewType === 'branch') {
      // 分公司 - 查看该分公司下所有服务商的产品
      const branchId = searchParams.get('branchId');
      if (!branchId) {
        return NextResponse.json({ error: '缺少分公司ID' }, { status: 400 });
      }
      
      sql = `
        SELECT 
          p.id, p.name, p.code, p.price, p.period, p.status, p.created_at,
          pr.name as provider_name, pr.user_id as provider_id,
          u.username as member_name
        FROM products p
        LEFT JOIN providers pr ON p.provider_id = pr.user_id
        LEFT JOIN user_products up ON p.id = up.product_id
        LEFT JOIN users u ON up.user_id = u.id
        WHERE pr.branch_id = $1
        ORDER BY p.created_at DESC
      `;
      params = [branchId];
    } else {
      // 服务商 - 只看自己的
      if (!providerId) {
        return NextResponse.json({ error: '缺少服务商ID' }, { status: 400 });
      }
      
      sql = `
        SELECT 
          p.id, p.name, p.code, p.price, p.period, p.status, p.created_at,
          u.username as member_name
        FROM products p
        LEFT JOIN user_products up ON p.id = up.product_id
        LEFT JOIN users u ON up.user_id = u.id
        WHERE p.provider_id = $1
        ORDER BY p.created_at DESC
      `;
      params = [providerId];
    }

    const products = await query<any>(sql, params);

    // 统计
    const stats = {
      totalProducts: products.length,
      totalQuota: products.reduce((sum: number, p: any) => sum + parseFloat(p.price || 0), 0),
      available: products.filter((p: any) => p.status === 'available').length,
      sold: products.filter((p: any) => p.status === 'sold').length,
      unlisted: products.filter((p: any) => p.status === 'unlisted').length,
      totalSoldAmount: products
        .filter((p: any) => p.status === 'sold')
        .reduce((sum: number, p: any) => sum + parseFloat(p.price || 0), 0),
      totalAvailableAmount: products
        .filter((p: any) => p.status === 'available')
        .reduce((sum: number, p: any) => sum + parseFloat(p.price || 0), 0),
    };

    // 按状态分组
    const byStatus = {
      available: products.filter((p: any) => p.status === 'available'),
      sold: products.filter((p: any) => p.status === 'sold'),
      unlisted: products.filter((p: any) => p.status === 'unlisted'),
    };

    // 按周期分组
    const byPeriod = products.reduce((acc: any, p: any) => {
      const period = p.period;
      if (!acc[period]) {
        acc[period] = { count: 0, amount: 0 };
      }
      acc[period].count++;
      acc[period].amount += parseFloat(p.price || 0);
      return acc;
    }, {});

    return NextResponse.json({
      success: true,
      data: {
        stats,
        byStatus,
        byPeriod,
        products: products.slice(0, 50), // 限制返回数量
      },
    });
  } catch (error) {
    console.error('获取售卖统计失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    );
  }
}
