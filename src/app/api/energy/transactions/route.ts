import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取能量值流水记录
// 统一使用 PostgreSQL 直连
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const type = searchParams.get('type'); // recharge, spend, transfer_in, transfer_out, profit_share, provider_income
    const limit = searchParams.get('limit') || '50';

    if (!userId) {
      return NextResponse.json(
        { error: '用户ID不能为空' },
        { status: 400 }
      );
    }

    // 构建查询
    let sql = 'SELECT * FROM energy_transactions WHERE user_id = $1';
    const params: any[] = [userId];
    
    if (type) {
      sql += ' AND type = $2';
      params.push(type);
    }
    
    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(parseInt(limit));

    const transactions = await query(sql, params);

    // 获取统计信息
    const allRecords = await query(
      'SELECT type, amount FROM energy_transactions WHERE user_id = $1',
      [userId]
    );

    const stats: Record<string, number> = {
      totalTransferIn: 0,
      totalTransferOut: 0,
      totalRecharge: 0,
      totalSpend: 0,
      totalProfitShare: 0,
      totalConvertFromBalance: 0,
      totalIncome: 0,
      totalReward: 0,
      totalSubordinateSplit: 0,
      transferInCount: 0,
      transferOutCount: 0,
    };

    allRecords.forEach((record: any) => {
      const amount = parseFloat(record.amount) || 0;
      switch (record.type) {
        case 'transfer_in':
          stats.totalTransferIn += amount;
          stats.transferInCount++;
          break;
        case 'transfer_out':
          stats.totalTransferOut += Math.abs(amount);
          stats.transferOutCount++;
          break;
        case 'recharge':
        case 'recharge_in':
        case 'recharge_out':
          stats.totalRecharge += amount > 0 ? amount : 0;
          break;
        case 'spend':
        case 'market_fee':
          stats.totalSpend += Math.abs(amount);
          break;
        case 'profit_share':
        case 'provider_income':
          stats.totalProfitShare += amount;
          break;
        case 'convert_from_balance':
          stats.totalConvertFromBalance += amount;
          break;
        case 'income':
          stats.totalIncome += amount;
          break;
        case 'reward':
          stats.totalReward += amount;
          break;
        case 'subordinate_split':
          stats.totalSubordinateSplit += amount;
          break;
      }
    });

    return NextResponse.json({
      success: true,
      data: transactions,
      stats,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    console.error('获取能量值流水记录失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    );
  }
}
