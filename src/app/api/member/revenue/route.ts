import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth';
import { getSupabaseUrl, getSupabaseServiceRoleKey } from '@/lib/env';
import { execute, queryOne } from '@/lib/pg-client';

// 获取管理员 Supabase 客户端（绕过 RLS）
function getAdminSupabase() {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    throw new Error('Missing Supabase configuration');
  }
  return createClient(url, key);
}

/**
 * 获取会员收益记录
 * 
 * 会员收益逻辑：
 * - 收益来源：持有产品期间按周期收益率产生（具体费率以产品market_rate/profit_rate为准）
 * - 入账时机：产品到期卖出时，本金+收益进入收益账户
 * - 与服务商/分公司不同：服务商分公司收益来自市场业务，会员收益来自产品持有时长
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: '用户ID不能为空' }, { status: 400 });
    }

    const client = getAdminSupabase();

    // ========== 1. 获取收益记录（使用 rpc_query 关联查询）==========
    const { data: revenueRecords } = await client
      .rpc('rpc_query', {
        sql_query: `
          SELECT mr.*, 
            p.name as product_name, p.code as product_code, p.period as product_period,
            p.total_rate, p.profit_rate, p.market_rate
          FROM member_revenue mr
          LEFT JOIN user_products up ON mr.user_product_id = up.id
          LEFT JOIN products p ON up.product_id = p.id
          WHERE mr.user_id = '${userId}'
          ORDER BY mr.created_at DESC
          LIMIT 50
        `
      });

    const formattedRecords = (revenueRecords || []).map((record: any) => ({
      id: record.id,
      user_id: record.user_id,
      order_id: record.order_id,
      user_product_id: record.user_product_id,
      principal: parseFloat(record.principal || 0),
      profit: parseFloat(record.profit || 0),
      total_amount: parseFloat(record.total_amount || 0),
      converted_to_energy: parseFloat(record.converted_to_energy || 0),
      status: record.status,
      // 产品信息
      product_name: record.product_name || '未知产品',
      product_code: record.product_code || '',
      product_period: record.product_period || 0,
      total_rate: record.total_rate || 0,
      profit_rate: record.profit_rate || 0,
      market_rate: record.market_rate || 0,
      holding_days: record.holding_days || 0,
      created_at: record.created_at,
      updated_at: record.updated_at,
    }));

    // ========== 2. 统计汇总（已卖出产生的收益统计）==========
    const { data: revenueStats } = await client
      .rpc('rpc_query', {
        sql_query: `
          SELECT 
            COALESCE(SUM(principal), 0) as total_principal,
            COALESCE(SUM(profit), 0) as total_profit,
            COALESCE(SUM(converted_to_energy), 0) as total_converted
          FROM member_revenue
          WHERE user_id = '${userId}'
        `
      });

    const statsRow = (revenueStats || [])[0] || {};
    const totalPrincipal = parseFloat(statsRow.total_principal || 0);
    const totalProfit = parseFloat(statsRow.total_profit || 0);
    const converted = parseFloat(statsRow.total_converted || 0);
    const available = totalProfit - converted;

    // ========== 3. 当前持有中产品的预期收益（持仓中未卖出）==========
    // 使用分开的查询避免 enum 类型转换问题
    // 使用 Supabase REST API 直接查询
    const holdingResult = await client
      .from('user_products')
      .select('expected_profit, purchase_price')
      .eq('user_id', userId)
      .eq('status', 'holding');

    // 再查 pending_confirm
    let pendingData: any[] = [];
    try {
      const { data: pd } = await client
        .from('user_products')
        .select('expected_profit, purchase_price')
        .eq('user_id', userId)
        .eq('status', 'pending_confirm');
      pendingData = pd || [];
    } catch {
      // schema cache 可能不识别 pending_confirm，忽略
    }

    const allHoldings = [...(holdingResult.data || []), ...pendingData];
    let holdingExpectedProfit = 0;
    let holdingPrincipal = 0;
    if (allHoldings.length > 0) {
      holdingExpectedProfit = allHoldings.reduce((sum: number, r: any) => sum + (parseFloat(r.expected_profit) || 0), 0);
      holdingPrincipal = allHoldings.reduce((sum: number, r: any) => sum + (parseFloat(r.purchase_price) || 0), 0);
    }

    // ========== 4. 收益说明 ==========
    const revenueDescription = {
      source: '产品持有收益',
      description: '会员通过持有GPU算力产品，按周期收益率获得收益。具体收益率以产品设定的total_rate为准。',
      timing: '产品到期卖出时，本金和收益进入收益账户',
      difference: '与服务商/分公司收益不同：服务商分公司收益来自市场业务（市场费分成），会员收益来自产品持有时长产生的回报',
    };

    return NextResponse.json({
      success: true,
      data: {
        records: formattedRecords,
        stats: {
          totalPrincipal,
          totalProfit,
          converted,
          available,
          holdingExpectedProfit,
          holdingPrincipal,
        },
        description: revenueDescription,
      }
    });
  } catch (error) {
    console.error('获取会员收益记录失败:', error);
    return NextResponse.json({
      success: true,
      data: {
        records: [],
        stats: { totalPrincipal: 0, totalProfit: 0, converted: 0, available: 0, holdingExpectedProfit: 0, holdingPrincipal: 0 },
        description: null,
      }
    });
  }
}

/**
 * 会员收益转能量值
 * 将已入账的收益转为能量值（1:1）
 */
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
    }

    const body = await request.json();
    const { amount } = body;

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return NextResponse.json({ success: false, error: '请输入有效金额' }, { status: 400 });
    }

    const convertAmount = Number(amount);
    const userId = authUser.userId;
    const client = getAdminSupabase();

    // 查询可转换的收益
    const { data: revenueRecords } = await client
      .from('member_revenue')
      .select('id, profit, converted_to_energy, status')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    let totalAvailable = 0;
    (revenueRecords || []).forEach((row: any) => {
      totalAvailable += parseFloat(row.profit || 0) - parseFloat(row.converted_to_energy || 0);
    });

    if (convertAmount > totalAvailable) {
      return NextResponse.json({
        success: false,
        error: `可转换收益不足，当前可转换 ${totalAvailable.toFixed(2)} 元`
      }, { status: 400 });
    }

    // 按顺序扣减收益记录的转换额度
    let remaining = convertAmount;
    for (const record of (revenueRecords || [])) {
      if (remaining <= 0) break;
      const recordProfit = parseFloat(record.profit || 0);
      const recordConverted = parseFloat(record.converted_to_energy || 0);
      const recordAvailable = recordProfit - recordConverted;

      if (recordAvailable <= 0) continue;

      const deductAmount = Math.min(remaining, recordAvailable);
      const newConverted = recordConverted + deductAmount;

      await client
        .from('member_revenue')
        .update({
          converted_to_energy: newConverted,
          status: newConverted >= recordProfit ? 'converted' : 'pending',
          updated_at: new Date().toISOString(),
        })
        .eq('id', record.id);

      remaining -= deductAmount;
    }

    // 更新用户能量值 - 使用 SQL 直接更新确保写入成功
    const userRow = await queryOne('SELECT energy_value FROM users WHERE id = $1', [userId]);
    const currentEnergy = parseFloat(String(userRow?.energy_value)) || 0;
    const newEnergy = currentEnergy + convertAmount;

    await execute('UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2', [newEnergy, userId]);

    // 更新能量值账户 - 使用 SQL 直接更新
    const accRow = await queryOne('SELECT balance, total_in FROM energy_accounts WHERE user_id = $1', [userId]);
    if (accRow) {
      await execute(
        'UPDATE energy_accounts SET balance = $1, total_in = $2, updated_at = NOW() WHERE user_id = $3',
        [(parseFloat(String(accRow.balance)) || 0) + convertAmount, (parseFloat(String(accRow.total_in)) || 0) + convertAmount, userId]
      );
    }

    // 写入收益明细流水
    await client
      .from('revenue_details')
      .insert({
        id: crypto.randomUUID(),
        user_id: userId,
        revenue_id: null,
        type: 'convert_to_energy',
        amount: convertAmount,
        balance_before: currentEnergy,
        balance_after: newEnergy,
        description: `收益转为能量值`,
        created_at: new Date().toISOString(),
      });

    // 记录能量值交易
    await client
      .from('energy_transactions')
      .insert({
        id: crypto.randomUUID(),
        user_id: userId,
        type: 'profit_convert',
        amount: convertAmount,
        from_user_id: null,
        to_user_id: null,
        status: 'completed',
        description: `产品收益转为能量值`,
        created_at: new Date().toISOString(),
      });

    return NextResponse.json({
      success: true,
      message: '收益已转为能量值',
      data: {
        convertAmount,
        newEnergy,
      }
    });
  } catch (error) {
    console.error('收益转能量值失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '服务器错误'
    }, { status: 500 });
  }
}
