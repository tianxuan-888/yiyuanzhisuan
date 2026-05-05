import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/pg-client';

/**
 * 服务商生成产品
 * 
 * GET 请求：获取产品生成预览
 * POST 请求：实际生成产品
 * 
 * 新逻辑：
 * - 模板只是规则定义（周期、收益率），不涉及额度
 * - 服务商选择模板 + 输入总额 → 系统生成整数价格产品
 * - 单个产品价格 ≤ 10,000
 * - 产品价格从百元到几千不等
 * - 只要额度≥100即可生成产品
 * - 从服务商可用额度中扣除总额
 */

/**
 * 将总额拆分为整数金额的产品列表
 * 规则：单个产品 ≤ 10,000，整数金额，从百元到几千
 */
function generateProductPrices(totalAmount: number): number[] {
  if (totalAmount <= 0) return [];
  
  const prices: number[] = [];
  let remaining = totalAmount;
  
  // 价格档位配置（百元到几千，最大1万）
  const priceLevels = [
    100, 200, 300, 400, 500, 600, 700, 800, 900, 1000,
    1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000
  ];
  
  while (remaining >= 100) {
    if (remaining <= 10000) {
      // 剩余金额可以直接作为一个产品
      prices.push(remaining);
      break;
    }
    
    // 随机选择一个价格档位，不超过剩余金额
    const maxLevel = priceLevels.filter(p => p <= remaining - 200).length;
    if (maxLevel === 0) {
      // 剩余金额不够再分一个200的产品，把剩余全给最后一个
      prices.push(remaining);
      break;
    }
    
    // 按权重选择：小额(200-1000)权重更高，大额权重较低
    const weights = priceLevels.slice(0, maxLevel).map(p => {
      if (p <= 1000) return 3;      // 小额权重3
      if (p <= 3000) return 2.5;    // 中小权重2.5
      if (p <= 6000) return 1.5;    // 中大权重1.5
      return 1;                      // 大额权重1
    });
    
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    let selectedIndex = 0;
    for (let i = 0; i < weights.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        selectedIndex = i;
        break;
      }
    }
    
    const selectedPrice = priceLevels[selectedIndex];
    prices.push(selectedPrice);
    remaining -= selectedPrice;
  }
  
  // 处理剩余零头（< 200的部分）
  if (remaining > 0 && remaining < 200) {
    // 把零头加到最后一个产品上
    if (prices.length > 0) {
      prices[prices.length - 1] += remaining;
    }
  }
  
  return prices;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const totalAmountStr = searchParams.get('totalAmount');
    const periodStr = searchParams.get('period');

    if (!totalAmountStr || !periodStr) {
      return NextResponse.json(
        { error: '请提供总额和产品周期参数' },
        { status: 400 }
      );
    }

    const totalAmount = parseInt(totalAmountStr);
    const period = parseInt(periodStr);

    if (isNaN(totalAmount) || totalAmount < 100) {
      return NextResponse.json(
        { error: '最低总额为100元' },
        { status: 400 }
      );
    }

    // 生成预览
    const prices = generateProductPrices(totalAmount);
    const products = prices.map(price => ({
      price,
      period,
      totalRate: period === 3 ? 5 : period === 7 ? 10 : period === 15 ? 20 : period === 30 ? 44 : 120,
      marketRate: period === 3 ? 3 : period === 7 ? 5 : period === 15 ? 10 : period === 30 ? 22 : 60,
      profitRate: period === 3 ? 2 : period === 7 ? 5 : period === 15 ? 10 : period === 30 ? 22 : 60,
    }));

    return NextResponse.json({
      success: true,
      data: {
        products,
        stats: {
          total: products.length,
          totalValue: products.reduce((sum, p) => sum + p.price, 0),
          minPrice: Math.min(...prices),
          maxPrice: Math.max(...prices),
          avgPrice: Math.round(products.reduce((sum, p) => sum + p.price, 0) / products.length),
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
    const { providerId, templateId, totalAmount } = body;

    console.log('[generate-products] 请求参数:', { providerId, templateId, totalAmount });

    // 参数验证
    if (!providerId) {
      return NextResponse.json(
        { error: '服务商ID不能为空' },
        { status: 400 }
      );
    }

    if (!templateId) {
      return NextResponse.json(
        { error: '请选择产品模板' },
        { status: 400 }
      );
    }

    if (!totalAmount || totalAmount < 100) {
      return NextResponse.json(
        { error: '生成总额最低为100元' },
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
      console.error('[generate-products] 服务商不存在:', providerId);
      return NextResponse.json(
        { error: '服务商不存在' },
        { status: 404 }
      );
    }

    console.log('[generate-products] 服务商信息:', { id: provider.user_id, quota: provider.quota, used_quota: provider.used_quota });

    // 检查可用额度
    const availableQuota = parseFloat(provider.quota || 0) - parseFloat(provider.used_quota || 0);
    if (availableQuota < totalAmount) {
      return NextResponse.json(
        { error: `可用额度不足，当前可用额度: ¥${availableQuota.toLocaleString()}` },
        { status: 400 }
      );
    }

    // 获取模板信息
    const template = await queryOne<any>(
      `SELECT * FROM product_templates WHERE id = $1 AND status = 'active'`,
      [templateId]
    );

    if (!template) {
      console.error('[generate-products] 模板不存在:', templateId);
      return NextResponse.json(
        { error: '产品模板不存在或已停用' },
        { status: 404 }
      );
    }

    console.log('[generate-products] 模板信息:', { id: template.id, period: template.period });

    // 生成产品价格列表
    const prices = generateProductPrices(totalAmount);
    if (prices.length === 0) {
      return NextResponse.json(
        { error: '无法生成产品，请检查金额' },
        { status: 400 }
      );
    }

    console.log('[generate-products] 生成价格列表:', prices.length, '个产品, 总额:', prices.reduce((s, p) => s + p, 0));

    // 批量插入产品
    const now = new Date().toISOString();
    let codeCounter = Date.now();
    
    const insertResults: any[] = [];
    for (let i = 0; i < prices.length; i++) {
      const price = prices[i];
      const seq = (codeCounter++).toString().slice(-6);
      const productId = crypto.randomUUID();
      const productName = `${template.period}天算力套餐-${seq}`;
      const productCode = `GPU-${template.period}D-${seq}`;
      
      try {
        const result = await query(
          `INSERT INTO products (id, name, code, price, period, total_rate, market_rate, profit_rate, provider_id, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id, name, status`,
          [
            productId,
            productName,
            productCode,
            price,
            template.period,
            template.total_rate,
            template.market_rate,
            template.profit_rate,
            providerId,
            'unlisted',
            now,
            now
          ]
        );
        insertResults.push(...result);
      } catch (insertError) {
        console.error(`[generate-products] 插入第${i + 1}个产品失败:`, insertError);
        throw insertError;
      }
    }

    // 更新服务商的已使用额度
    const usedAmount = prices.reduce((sum, p) => sum + p, 0);
    await query(
      `UPDATE providers 
       SET used_quota = COALESCE(used_quota, 0) + $1,
           updated_at = $2
       WHERE user_id = $3`,
      [usedAmount, now, providerId]
    );

    console.log('[generate-products] 生成成功:', prices.length, '个产品, 总额:', usedAmount);

    return NextResponse.json({
      success: true,
      message: `成功生成 ${prices.length} 个算力产品，总计 ¥${usedAmount.toLocaleString()}`,
      data: {
        products: prices.map(price => ({
          price,
          period: template.period,
          totalRate: template.total_rate,
          marketRate: template.market_rate,
          profitRate: template.profit_rate,
        })),
        stats: {
          total: prices.length,
          totalValue: usedAmount,
          minPrice: Math.min(...prices),
          maxPrice: Math.max(...prices),
        }
      }
    });
  } catch (error) {
    console.error('生成产品失败:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `生成产品失败: ${errMsg}` },
      { status: 500 }
    );
  }
}
