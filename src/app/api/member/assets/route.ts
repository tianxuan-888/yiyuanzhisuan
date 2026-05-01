import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

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
    // 普通数字字符串
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

// 获取用户资产概览
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: '缺少用户ID' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient();

    // 查询用户信息
    const { data: user, error: userError } = await client
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (userError) {
      throw new Error(`查询用户失败: ${userError.message}`);
    }

    if (!user) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      );
    }

    // 查询用户持有的产品
    const { data: userProducts, error: productsError } = await client
      .from('user_products')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (productsError) {
      throw new Error(`查询用户产品失败: ${productsError.message}`);
    }

    // 如果有产品，获取产品详情
    const productsMap: Record<string, { name: string; code: string; period: number }> = {};
    if (userProducts && userProducts.length > 0) {
      const productIds = [...new Set(userProducts.map(p => p.product_id))];
      const { data: productsData, error: productsDetailError } = await client
        .from('products')
        .select('id, name, code, period')
        .in('id', productIds);

      if (!productsDetailError && productsData) {
        productsData.forEach(p => {
          productsMap[p.id] = { name: p.name, code: p.code, period: p.period };
        });
      }
    }

    // 合并产品详情
    const enrichedUserProducts = userProducts?.map(p => ({
      ...p,
      products: productsMap[p.product_id] || null
    })) || [];

    // 查询用户订单
    const { data: orders, error: ordersError } = await client
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (ordersError) {
      throw new Error(`查询订单失败: ${ordersError.message}`);
    }

    // 查询交易记录
    const { data: transactions, error: transactionsError } = await client
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (transactionsError) {
      throw new Error(`查询交易记录失败: ${transactionsError.message}`);
    }

    // 计算统计数据
    // 所有产品（包括已卖出的）
    const allProducts = enrichedUserProducts;
    // 持有中的产品
    const holdingProducts = enrichedUserProducts.filter(p => p.status === 'holding');
    
    // 累计总收益 = 所有产品的预期收益总和
    const totalProfit = allProducts.reduce((sum, p) => sum + parseFloat(p.expected_profit || '0'), 0);
    // 现有收益 = 持有中产品的预期收益（可转为能量值）
    const availableProfit = holdingProducts.reduce((sum, p) => sum + parseFloat(p.expected_profit || '0'), 0);

    // 优先从 energy_accounts 表获取能量值余额
    let energyValue = parseNumeric(user.energy_value);
    try {
      const { data: energyAccount } = await client
        .from('energy_accounts')
        .select('balance')
        .eq('user_id', userId)
        .maybeSingle();
      if (energyAccount && energyAccount.balance !== null) {
        energyValue = parseNumeric(energyAccount.balance);
      }
    } catch (e) {
      console.error('获取能量值账户失败，使用users表数据:', e);
    }

    // 返回用户信息（不包含密码）
    const { password: _, ...userWithoutPassword } = user;

    return NextResponse.json({
      success: true,
      data: {
        user: userWithoutPassword,
        stats: {
          energy_value: energyValue,
          balance: parseNumeric(user.balance),
          points: parseNumeric(user.points),
          total_holding: holdingProducts.reduce((sum, p) => sum + parseFloat(p.purchase_price), 0),
          total_profit: totalProfit,       // 累计总收益
          available_profit: availableProfit, // 现有收益（可转能量值）
          holding_count: holdingProducts.length,
          sold_count: allProducts.length - holdingProducts.length,
        },
        products: enrichedUserProducts,
        orders: orders,
        transactions: transactions,
      },
    });
  } catch (error) {
    console.error('获取用户资产失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取用户资产失败' },
      { status: 500 }
    );
  }
}
