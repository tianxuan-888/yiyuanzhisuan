import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { randomUUID } from 'crypto';

// 服务商收益转能量值
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅服务商可操作
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['provider'])) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const body = await request.json();
    const { amount } = body;

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return NextResponse.json({ success: false, error: '请输入有效金额' }, { status: 400 });
    }

    const withdrawAmount = Number(amount);
    const userId = authUser.userId;

    // 获取服务商记录
    const providerRecord: any = await queryOne(
      'SELECT * FROM providers WHERE user_id = $1',
      [userId]
    );

    if (!providerRecord) {
      return NextResponse.json({ success: false, error: '服务商记录不存在' }, { status: 404 });
    }

    // 计算服务商的总可提现收益
    const totalRevenueResult: any = await query(
      `SELECT COALESCE(SUM(provider_share + direct_reward + parent_provider_share), 0) as total
       FROM provider_revenue_distribution
       WHERE provider_id = $1 AND status = 'completed'`,
      [providerRecord.id]
    );

    const totalRevenue = parseFloat(totalRevenueResult?.[0]?.total || '0');

    // 计算已提现金额
    const withdrawnResult: any = await query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM energy_withdraw_requests
       WHERE user_id = $1 AND status = 'completed'`,
      [userId]
    );

    const withdrawnAmount = parseFloat(withdrawnResult?.[0]?.total || '0');
    const availableAmount = totalRevenue - withdrawnAmount;

    if (withdrawAmount > availableAmount) {
      return NextResponse.json({
        success: false,
        error: `可提现余额不足，当前可提现 ${availableAmount.toFixed(2)} 元`
      }, { status: 400 });
    }

    // 计算手续费 (5%)
    const fee = Math.floor(withdrawAmount * 0.05);
    const actualAmount = withdrawAmount - fee;

    // 获取当前能量值余额
    const balanceResult: any = await queryOne(
      'SELECT balance FROM energy_accounts WHERE user_id = $1',
      [userId]
    );
    const currentBalance = balanceResult ? Number(balanceResult.balance) || 0 : 0;

    // 更新能量值账户
    const newBalance = currentBalance + actualAmount;
    await query(
      `INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET 
         balance = $3,
         total_in = energy_accounts.total_in + $4,
         updated_at = NOW()`,
      [randomUUID(), userId, newBalance, actualAmount, 0]
    );

    // 记录提现申请
    await query(
      `INSERT INTO energy_withdraw_requests (id, user_id, amount, actual_amount, fee, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'completed', NOW())`,
      [randomUUID(), userId, withdrawAmount, actualAmount, fee]
    );

    // 记录能量值交易
    await query(
      `INSERT INTO transactions (id, user_id, order_id, type, amount, balance_before, balance_after, description, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', NOW())`,
      [
        randomUUID(),
        userId,
        null,
        'revenue_convert',
        actualAmount,
        currentBalance,
        newBalance,
        `收益转为能量值 (提现${withdrawAmount}, 手续费${fee})`
      ]
    );

    return NextResponse.json({
      success: true,
      message: '收益已转为能量值',
      data: {
        withdrawAmount,
        fee,
        actualAmount,
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

// 获取服务商提现记录
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['provider'])) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const records = await query(
      `SELECT * FROM energy_withdraw_requests
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [authUser.userId]
    );

    // 计算统计
    const totalResult: any = await query(
      `SELECT 
         COALESCE(SUM(amount), 0) as total_withdraw,
         COALESCE(SUM(actual_amount), 0) as total_actual,
         COALESCE(SUM(fee), 0) as total_fee
       FROM energy_withdraw_requests
       WHERE user_id = $1 AND status = 'completed'`,
      [authUser.userId]
    );

    return NextResponse.json({
      success: true,
      data: {
        records,
        stats: {
          totalWithdraw: parseFloat(totalResult?.[0]?.total_withdraw || '0'),
          totalActual: parseFloat(totalResult?.[0]?.total_actual || '0'),
          totalFee: parseFloat(totalResult?.[0]?.total_fee || '0'),
        }
      }
    });
  } catch (error) {
    console.error('获取提现记录失败:', error);
    return NextResponse.json({
      success: true,
      data: { records: [], stats: { totalWithdraw: 0, totalActual: 0, totalFee: 0 } }
    });
  }
}
