import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/pg-client';
import { providerProductConfig } from '@/config/powerPackages';

/**
 * 服务商生成产品
 * 
 * GET 请求：获取产品生成预览
 * POST 请求：实际生成产品
 * 
 * 规则：
 * - 1万 = 4个产品（2个3天 + 2个7天交替）
 * - 2万 = 8个产品
 * - 3万 = 12个产品
 * - 4万 = 16个产品
 * - 5万 = 20个产品
 * 
 * 产品配置：
 * - 3天：总收益5%，会员到手2%，能量值3%，金额¥200-5,000
 * - 7天：总收益10%，会员到手5%，能量值5%，金额¥200-10,000
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const quotaStr = searchParams.get('quota');

    if (!quotaStr) {
      return NextResponse.json(
        { error: '请提供额度参数' },
        { status: 400 }
      );
    }

    const quota = parseInt(quotaStr);
    if (isNaN(quota) || quota < 10000) {
      return NextResponse.json(
        { error: '最低额度为1万元' },
        { status: 400 }
      );
    }

    // 计算产品预览
    const config = providerProductConfig;
    const products = config.generateProducts(quota);
    const usedQuota = quota;
    const remainingQuota = 0;

    // 统计
    const day3Products = products.filter(p => p.period === 3);
    const day7Products = products.filter(p => p.period === 7);

    return NextResponse.json({
      success: true,
      data: {
        usedQuota,
        remainingQuota,
        products,
        stats: {
          total: products.length,
          totalValue: usedQuota,
          day3Count: day3Products.length,
          day7Count: day7Products.length,
          day3Value: day3Products.reduce((sum, p) => sum + p.price, 0),
          day7Value: day7Products.reduce((sum, p) => sum + p.price, 0),
        }
      }
    });
  } catch (error) {
    console.error('获取预览失败:', error);
    return NextResponse.json(
      { error: '获取预览失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { providerId, allocationId, customQuota } = body;

    // 参数验证
    if (!providerId) {
      return NextResponse.json(
        { error: '服务商ID不能为空' },
        { status: 400 }
      );
    }

    // 验证服务商是否存在
    const provider = await queryOne<any>(
      `SELECT p.*, u.username 
       FROM providers p 
       JOIN users u ON p.user_id = u.id 
       WHERE p.user_id = $1`,
      [providerId]
    );

    if (!provider) {
      return NextResponse.json(
        { error: '服务商不存在' },
        { status: 404 }
      );
    }

    // 获取额度分配记录
    let availableQuota = 0;
    
    if (customQuota && customQuota > 0) {
      // 使用自定义额度（不能超过可用额度）
      const totalAvailable = parseFloat(provider.quota || 0) - parseFloat(provider.used_quota || 0);
      availableQuota = Math.min(customQuota, totalAvailable);
      
      if (availableQuota < 10000) {
        return NextResponse.json(
          { error: '最低额度为1万元' },
          { status: 400 }
        );
      }
    } else if (allocationId) {
      // 使用指定的额度分配
      const allocation = await queryOne<any>(
        `SELECT * FROM quota_allocations WHERE id = $1 AND provider_id = $2 AND status = 'active'`,
        [allocationId, providerId]
      );
      
      if (!allocation) {
        return NextResponse.json(
          { error: '额度分配记录不存在' },
          { status: 404 }
        );
      }
      
      availableQuota = parseFloat(allocation.quota_amount) - parseFloat(allocation.used_amount);
    } else {
      // 使用服务商总可用额度
      availableQuota = parseFloat(provider.quota || 0) - parseFloat(provider.used_quota || 0);
    }

    if (availableQuota < 10000) {
      return NextResponse.json(
        { error: '可用额度不足，最低需要1万元' },
        { status: 400 }
      );
    }

    // 使用配置生成产品
    const config = providerProductConfig;
    const productsToCreate = config.generateProducts(availableQuota);

    if (productsToCreate.length === 0) {
      return NextResponse.json(
        { error: '无法生成产品，请检查额度配置' },
        { status: 400 }
      );
    }

    // 批量插入产品
    const now = new Date().toISOString();
    let codeCounter = Date.now();
    
    const insertPromises = productsToCreate.map(product => {
      return query(
        `INSERT INTO products (id, name, code, price, period, total_rate, market_rate, profit_rate, provider_id, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          crypto.randomUUID(),
          product.period === 3 ? `3天算力套餐-${(codeCounter++).toString().slice(-6)}` : `7天算力套餐-${(codeCounter++).toString().slice(-6)}`,
          product.period === 3 ? `GPU-3D-${(codeCounter++).toString().slice(-6)}` : `GPU-7D-${(codeCounter++).toString().slice(-6)}`,
          product.price,
          product.period,
          product.totalRate,
          product.energyRate,
          product.memberRate,
          providerId,
          'available',
          now,
          now
        ]
      );
    });

    await Promise.all(insertPromises);

    // 更新服务商的已使用额度
    await query(
      `UPDATE providers 
       SET used_quota = COALESCE(used_quota, 0) + $1,
           updated_at = $2
       WHERE user_id = $3`,
      [availableQuota, now, providerId]
    );

    // 更新额度分配记录（如果有）
    if (allocationId) {
      await query(
        `UPDATE quota_allocations 
         SET used_amount = COALESCE(used_amount, 0) + $1,
             updated_at = $2
         WHERE id = $3`,
        [availableQuota, now, allocationId]
      );
    }

    const totalValue = productsToCreate.reduce((sum, p) => sum + p.price, 0);

    return NextResponse.json({
      success: true,
      message: `成功生成 ${productsToCreate.length} 个算力产品`,
      data: {
        products: productsToCreate,
        stats: {
          total: productsToCreate.length,
          totalValue,
          day3Count: productsToCreate.filter(p => p.period === 3).length,
          day7Count: productsToCreate.filter(p => p.period === 7).length,
        }
      }
    });
  } catch (error) {
    console.error('生成产品失败:', error);
    return NextResponse.json(
      { error: '生成产品失败' },
      { status: 500 }
    );
  }
}
