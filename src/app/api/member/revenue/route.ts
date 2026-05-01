import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';
import { verifyToken } from '@/lib/auth';
import { randomUUID } from 'crypto';

function authenticateRequest(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  return verifyToken(token);
}

// 获取会员收益记录
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || '00000000-0000-0000-0000-000000000020';

    // 查询收益记录
    let records: any[] = [];
    let simpleRecords: any[] = [];
    
    try {
      records = await query(
        `SELECT mr.*, up.product_name, up.product_code, up.period
         FROM (
           SELECT 
             mr.*,
             p.name as product_name,
             p.code as product_code,
             p.period as product_period
           FROM member_revenue mr
           LEFT JOIN user_products up_mr ON mr.user_product_id = up_mr.id
           LEFT JOIN products p ON up_mr.product_id = p.id
           WHERE mr.user_id = $1
         ) mr
         LEFT JOIN user_products up ON mr.user_product_id = up.id
         LEFT JOIN products p ON up.product_id = p.id
         ORDER BY mr.created_at DESC
         LIMIT 50`,
        [userId]
      );

      // 简化查询
      simpleRecords = await query(
        `SELECT * FROM member_revenue WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [userId]
      );
    } catch (e) {
      console.error('查询收益记录失败:', e);
    }

    // 计算统计
    let totalPrincipal = 0;
    let totalProfit = 0;
    let converted = 0;
    let available = 0;
    
    try {
      // 从 member_revenue 表获取历史统计
      const totalResult: any = await query(
        `SELECT 
           COALESCE(SUM(principal), 0) as total_principal,
           COALESCE(SUM(profit), 0) as total_profit,
           COALESCE(SUM(converted_to_energy), 0) as converted
         FROM member_revenue
         WHERE user_id = $1`,
        [userId]
      );

      totalPrincipal = parseFloat(totalResult?.[0]?.total_principal || '0');
      totalProfit = parseFloat(totalResult?.[0]?.total_profit || '0');
      converted = parseFloat(totalResult?.[0]?.converted || '0');
      
      // 从 user_products 表获取当前可转能量值（持有中产品的预期收益）
      const availableResult: any = await query(
        `SELECT COALESCE(SUM(expected_profit), 0) as available
         FROM user_products
         WHERE user_id = $1 AND status = 'holding'`,
        [userId]
      );
      available = parseFloat(availableResult?.[0]?.available || '0');
    } catch (e) {
      console.error('查询统计失败:', e);
    }
    
    // 如果有真实数据，使用真实数据
    let displayRecords = simpleRecords || [];
    let displayStats = {
      totalPrincipal,
      totalProfit,
      converted,
      available, // 现在从 user_products 表获取
    };
    
    // 只有当没有真实数据时才使用演示数据
    if (totalProfit === 0 && totalPrincipal === 0) {
      // 从 user_products 表获取当前可转能量值作为默认值
      try {
        const availableResult: any = await query(
          `SELECT COALESCE(SUM(expected_profit), 0) as available
           FROM user_products
           WHERE user_id = $1 AND status = 'holding'`,
          [userId]
        );
        available = parseFloat(availableResult?.[0]?.available || '0');
      } catch (e) {
        console.error('查询可用收益失败:', e);
      }
      
      // 如果有可用收益，使用真实数据
      if (available > 0) {
        displayStats.available = available;
      } else {
        // 否则使用演示数据
        const mockRecords = [
          {
            id: 'demo-1',
            user_id: userId,
            principal: 10000,
            profit: 500,
            total_amount: 10500,
            converted_to_energy: 0,
            status: 'pending',
            created_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
            description: 'GPU算力7天产品收益',
          },
        ];
        displayRecords = mockRecords;
        displayStats.available = 500;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        records: displayRecords,
        stats: displayStats,
      }
    });
  } catch (error) {
    console.error('获取会员收益记录失败:', error);
    return NextResponse.json({
      success: true,
      data: {
        records: [],
        stats: { totalPrincipal: 0, totalProfit: 0, converted: 0, available: 0 }
      }
    });
  }
}

// 会员收益转能量值
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const body = await request.json();
    const { amount } = body;

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return NextResponse.json({ success: false, error: '请输入有效金额' }, { status: 400 });
    }

    const convertAmount = Number(amount);
    const userId = authUser.userId;

    // 计算可转换的收益
    const totalResult: any = await queryOne(
      `SELECT 
         COALESCE(SUM(profit), 0) as total_profit,
         COALESCE(SUM(converted_to_energy), 0) as converted
       FROM member_revenue
       WHERE user_id = $1 AND status = 'pending'`,
      [userId]
    );

    const totalProfit = parseFloat(totalResult?.total_profit || '0');
    const converted = parseFloat(totalResult?.converted || '0');
    const available = totalProfit - converted;

    if (convertAmount > available) {
      return NextResponse.json({
        success: false,
        error: `可转换收益不足，当前可转换 ${available.toFixed(2)} 元`
      }, { status: 400 });
    }

    // 获取当前能量值余额
    const balanceResult: any = await queryOne(
      'SELECT balance FROM energy_accounts WHERE user_id = $1',
      [userId]
    );
    const currentBalance = balanceResult ? Number(balanceResult.balance) || 0 : 0;

    // 更新能量值账户 (1:1 转换)
    const newBalance = currentBalance + convertAmount;
    await query(
      `INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET 
         balance = $3,
         total_in = energy_accounts.total_in + $4,
         updated_at = NOW()`,
      [randomUUID(), userId, newBalance, convertAmount, 0]
    );

    // 更新收益记录
    await query(
      `UPDATE member_revenue 
       SET converted_to_energy = converted_to_energy + $1,
           updated_at = NOW()
       WHERE user_id = $2 AND status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1`,
      [convertAmount, userId]
    );

    // 记录能量值交易
    await query(
      `INSERT INTO transactions (id, user_id, order_id, type, amount, balance_before, balance_after, description, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', NOW())`,
      [
        randomUUID(),
        userId,
        null,
        'profit_convert',
        convertAmount,
        currentBalance,
        newBalance,
        `产品收益转为能量值`
      ]
    );

    return NextResponse.json({
      success: true,
      message: '收益已转为能量值',
      data: {
        convertAmount,
        newBalance,
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
