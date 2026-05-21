import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';
import { randomUUID } from 'crypto';

// 辅助函数：将PostgreSQL numeric格式转换为数字
function parseNumeric(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const match = val.match(/\{(\d+)\s+(-?\d+)/);
    if (match) {
      return parseFloat(match[1]) * Math.pow(10, parseInt(match[2]));
    }
    return parseFloat(val) || 0;
  }
  return 0;
}

// 会员收益转收益
export async function POST(request: NextRequest) {
  try {
    // 支持带userId参数的无认证调用（用于测试）
    let userId: string;
    const authUser = authenticateRequest(request);
    
    if (authUser) {
      userId = authUser.userId;
    } else {
      // 无认证时，从URL参数获取userId（测试用）
      const { searchParams } = new URL(request.url);
      userId = searchParams.get('userId') || '';
      if (!userId) {
        return NextResponse.json({ error: '无权限' }, { status: 403 });
      }
    }

    const body = await request.json();
    const { amount } = body;

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return NextResponse.json({ success: false, error: '请输入有效金额' }, { status: 400 });
    }

    if (Number(amount) < 50) {
      return NextResponse.json({ success: false, error: '最低转换额度为50元' }, { status: 400 });
    }

    const convertAmount = Number(amount);

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

    // 获取当前余额
    const beforeResult: any = await queryOne(
      'SELECT balance FROM energy_accounts WHERE user_id = $1',
      [userId]
    );
    const balanceBefore = beforeResult ? parseNumeric(beforeResult.balance) : 0;

    // 更新收益账户 (1:1 转换) - 使用增量方式更新
    await query(
      `INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 0, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET 
         balance = energy_accounts.balance + $4,
         total_in = energy_accounts.total_in + $4,
         updated_at = NOW()`,
      [randomUUID(), userId, convertAmount, convertAmount]
    );

    // 更新收益记录 - 找到第一条可转换的pending记录
    const recordToUpdate: any = await queryOne(
      `SELECT id, converted_to_energy, profit FROM member_revenue 
       WHERE user_id = $1 AND status = 'pending' AND (converted_to_energy IS NULL OR converted_to_energy < profit)
       ORDER BY created_at ASC LIMIT 1`,
      [userId]
    );

    let updateRevenueId = null;
    if (recordToUpdate) {
      // 计算这条记录还能转换多少
      const alreadyConverted = parseFloat(recordToUpdate.converted_to_energy || '0');
      const profit = parseFloat(recordToUpdate.profit || '0');
      const canConvert = profit - alreadyConverted;
      
      // 只能转换这条记录能转换的部分
      const actualConvert = Math.min(convertAmount, canConvert);
      
      await query(
        `UPDATE member_revenue 
         SET converted_to_energy = COALESCE(converted_to_energy, 0) + $1,
             updated_at = NOW()
         WHERE id = $2`,
        [actualConvert, recordToUpdate.id]
      );
      
      updateRevenueId = recordToUpdate.id;
    }

    // 获取更新后的总收益和已转换金额
    const afterResult: any = await queryOne(
      `SELECT 
         COALESCE(SUM(profit), 0) as total_profit,
         COALESCE(SUM(converted_to_energy), 0) as converted
       FROM member_revenue
       WHERE user_id = $1`,
      [userId]
    );
    const afterTotalProfit = parseFloat(afterResult?.total_profit || '0');
    const afterConverted = parseFloat(afterResult?.converted || '0');

    // 记录收益明细（收益转出）
    await query(
      `INSERT INTO revenue_details (id, user_id, revenue_id, type, amount, balance_before, balance_after, description, created_at)
       VALUES ($1, $2, $3, 'convert_to_energy', $4, $5, $6, $7, NOW())`,
      [
        randomUUID(),
        userId,
        updateRevenueId,
        convertAmount,
        afterTotalProfit + convertAmount,
        afterTotalProfit,
        `收益转为收益`
      ]
    );

    // 记录收益交易（写入 transactions 表）
    await query(
      `INSERT INTO transactions (id, user_id, order_id, type, amount, balance_before, balance_after, description, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', NOW())`,
      [
        randomUUID(),
        userId,
        null,
        'profit',
        convertAmount,
        balanceBefore,
        balanceBefore + convertAmount,
        `产品收益转为收益`
      ]
    );

    // 记录收益交易（写入 energy_transactions 表 - 用于会员端收益记录显示）
    await query(
      `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, status, description, created_at)
       VALUES ($1, $2, 'transfer_in', $3, $4, 'completed', $5, NOW())`,
      [
        randomUUID(),
        userId,
        convertAmount,
        null,
        `产品收益转为收益`
      ]
    );

    return NextResponse.json({
      success: true,
      message: `转换成功，获得 ${convertAmount} 收益`,
      data: {
        convertAmount,
        energyBalance: balanceBefore + convertAmount,
        revenueTotal: afterTotalProfit,
        revenueConverted: afterConverted,
        revenueAvailable: afterTotalProfit - afterConverted,
      }
    });
  } catch (error) {
    console.error('收益转收益失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '服务器错误'
    }, { status: 500 });
  }
}
