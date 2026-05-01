import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

// 辅助函数：将PostgreSQL numeric格式转换为数字
function parseNumeric(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    // 格式如: {7800 -2 false finite true} = 7800 * 10^(-2) = 78
    const match = val.match(/\{(\d+)\s+(-?\d+)/);
    if (match) {
      const num = parseFloat(match[1]);
      const exp = parseInt(match[2]);
      return num * Math.pow(10, exp);
    }
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

// 能量值支付比例（根据产品周期）
function getEnergyValueRate(period: number): number {
  if (period === 3) return 0.03; // 3天产品 3%
  if (period === 7) return 0.05; // 7天产品 5%
  if (period === 15) return 0.10; // 15天产品 10%
  if (period === 30) return 0.22; // 30天产品 22%
  if (period === 90) return 0.60; // 90天产品 60%
  return 0.05; // 默认5%
}

// 购买产品接口（线下交易模式 + 能量值检查）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, productId } = body;

    // 参数验证
    if (!userId || !productId) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 查询产品信息
    const product = await queryOne<any>(
      `SELECT * FROM products WHERE id = $1`,
      [productId]
    );

    if (!product) {
      return NextResponse.json(
        { error: '产品不存在' },
        { status: 404 }
      );
    }

    if (product.status !== 'available') {
      return NextResponse.json(
        { error: '产品不可购买' },
        { status: 400 }
      );
    }

    // 查询用户信息
    const user = await queryOne<any>(
      `SELECT * FROM users WHERE id = $1`,
      [userId]
    );

    if (!user) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      );
    }

    // ========== 持仓金额检查（上限2万） ==========
    // 查询用户当前持仓金额（只计算已购买但未结算的产品）
    const holdingsResult: any = await queryOne<any>(
      `SELECT COALESCE(SUM(purchase_price), 0) as total_holding
       FROM user_products 
       WHERE user_id = $1 AND status = 'holding'`,
      [userId]
    );
    const currentHolding = parseNumeric(holdingsResult?.total_holding);
    const productPrice = parseNumeric(product.price);
    const newTotalHolding = currentHolding + productPrice;
    const maxHolding = 20000;
    
    // 检查是否超过持仓上限
    if (newTotalHolding > maxHolding) {
      return NextResponse.json({
        success: false,
        error: '持仓金额超限',
        data: {
          code: 'HOLDING_LIMIT',
          message: `购买后持仓金额为 ${newTotalHolding.toLocaleString()} 元，超过上限 ${maxHolding.toLocaleString()} 元`,
          currentHolding,
          productPrice,
          maxHolding,
          canBuy: false,
        },
      }, { status: 400 });
    }

    // ========== 时间锁检查（超过20天且无有效推荐人则锁定）==========
    // 检查用户是否有有效推荐人（推荐人也要购买过产品才算）
    let hasValidInviter = false;
    
    if (user.inviter_id) {
      // 查询推荐人信息
      const inviter = await queryOne<any>(
        `SELECT id FROM users WHERE id = $1`,
        [user.inviter_id]
      );
      
      if (inviter) {
        // 检查推荐人是否购买过产品
        const inviterPurchase = await queryOne<any>(
          `SELECT COUNT(*) as count FROM user_products WHERE user_id = $1 AND status = 'holding'`,
          [inviter.id]
        );
        
        hasValidInviter = parseInt(inviterPurchase?.count || '0') > 0;
      }
    }
    
    // 检查是否超过20天保护期且无有效推荐人
    if (!hasValidInviter) {
      // 获取第一次购买日期
      const firstPurchaseResult: any = await queryOne<any>(
        `SELECT MIN(purchase_date) as first_date
         FROM user_products 
         WHERE user_id = $1 AND status = 'holding'`,
        [userId]
      );
      
      const firstPurchaseDate = firstPurchaseResult?.first_date;
      
      if (firstPurchaseDate) {
        const firstDate = new Date(firstPurchaseDate);
        const graceEndDate = new Date(firstDate.getTime() + 20 * 24 * 60 * 60 * 1000); // 20天后
        const now = new Date();
        
        // 超过20天保护期且无有效推荐人则锁定
        if (now >= graceEndDate) {
          return NextResponse.json({
            success: false,
            error: '需要有效推荐人',
            data: {
              code: 'TIME_LOCK',
              message: `已超过20天保护期，需绑定有效推荐人才能继续购买`,
              hasValidInviter: false,
              firstPurchaseDate,
              graceEndDate: graceEndDate.toISOString(),
              canBuy: false,
            },
          }, { status: 400 });
        }
      }
    }

    // ========== 能量值检查 ==========
    const energyRate = getEnergyValueRate(product.period);
    const requiredEnergy = Math.ceil(parseNumeric(product.price) * energyRate); // 需要的能量值
    
    // 优先从 energy_accounts 表获取能量值
    let userEnergy = parseNumeric(user.energy_value); // 默认从 users 表
    try {
      const energyAccount = await queryOne<any>(
        `SELECT balance::float as balance FROM energy_accounts WHERE user_id = $1`,
        [userId]
      );
      if (energyAccount) {
        userEnergy = energyAccount.balance;
      }
    } catch (e) {
      console.error('获取能量值账户失败，使用users表数据:', e);
    }

    // 获取产品所属服务商
    const providerId = product.provider_id;

    if (userEnergy < requiredEnergy) {
      return NextResponse.json({
        success: false,
        error: '能量值不足，请联系服务商充值',
        data: {
          required: requiredEnergy,
          current: userEnergy,
          short: requiredEnergy - userEnergy,
          productPrice: parseNumeric(product.price),
          energyRate: energyRate * 100,
          period: product.period,
        },
      }, { status: 400 });
    }

    // ========== 创建待审核订单（能量值暂不扣除）==========
    // 能量值将在服务商审核通过后扣除，并记录在订单的 energy_cost 字段中
    const orderId = crypto.randomUUID();
    await query(
      `INSERT INTO orders (id, user_id, user_product_id, product_id, order_type, amount, status, energy_cost, created_at)
       VALUES ($1, $2, $3, $4, 'buy', $5, 'pending', $6, NOW())`,
      [orderId, userId, null, productId, parseFloat(product.price), requiredEnergy]
    );

    // 查询服务商信息（用于显示联系方式）
    let providerInfo = null;
    if (providerId) {
      const provider = await queryOne<any>(
        `SELECT username, phone, real_name FROM users WHERE id = $1`,
        [providerId]
      );

      if (provider) {
        providerInfo = {
          name: provider.real_name || provider.username,
          phone: provider.phone,
        };
      }
    }

    // 发送通知给服务商
    if (providerId) {
      const notifId = crypto.randomUUID();
      await query(
        `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, sender_name, type, title, content, amount, related_id, created_at)
         VALUES ($1, $2, 'provider', $3, $4, 'buy_request', '会员购买申请', $5, $6, $7, NOW())`,
        [notifId, providerId, userId, user.username, `${user.username} 申请购买 ${product.name}，金额 ¥${product.price}，待确认收款`, parseFloat(product.price), orderId]
      );
    }

    // 获取订单信息
    const order = await queryOne(
      `SELECT * FROM orders WHERE id = $1`,
      [orderId]
    );

    return NextResponse.json({
      success: true,
      data: {
        order,
        product,
        providerInfo,
        energyRequired: requiredEnergy,
        message: `购买申请已提交，请等待服务商确认收款后完成购买`,
      },
    });
  } catch (error) {
    console.error('购买产品失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '购买产品失败' },
      { status: 500 }
    );
  }
}
