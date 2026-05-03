import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

// 辅助函数：将字节数组格式的UUID转换为字符串
function uuidToString(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    // PostgreSQL bytea 格式: [243 242 25 52 ...]
    return val.map((b: number) => b.toString(16).padStart(2, '0')).join('').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  }
  return String(val);
}

// 辅助函数：将PostgreSQL numeric格式转换为数字
// numeric格式: {1000000 -2 false finite true} = 1000000 * 10^(-2) = 10000
function numericToNumber(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    // 格式如: {1000000 -2 false finite true}
    const match = val.match(/\{(\d+)\s+(-?\d+)/);
    if (match) {
      const num = parseFloat(match[1]);
      const exp = parseInt(match[2]);
      return num * Math.pow(10, exp);
    }
    return parseFloat(val) || 0;
  }
  if (Array.isArray(val)) {
    return parseFloat(val[0]) || 0;
  }
  return 0;
}

// 获取用户能量值记录
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: '用户ID不能为空' },
        { status: 400 }
      );
    }

    // 查询能量值交易记录
    let records: any[] = [];
    let stats = {
      totalRecharge: 0,
      totalTransferIn: 0,
      totalTransferOut: 0,
      totalConsume: 0,
      rechargeCount: 0,
      transferInCount: 0,
      transferOutCount: 0,
      consumeCount: 0,
    };

    // 查询能量值交易记录
    try {
      const result = await query(
        `SELECT 
          et.id,
          et.type,
          et.amount,
          et.from_user_id,
          et.to_user_id,
          et.status,
          et.description,
          et.created_at
         FROM energy_transactions et
         WHERE et.user_id = $1
         ORDER BY et.created_at DESC 
         LIMIT 100`,
        [userId]
      );
      
      records = (result || []).map((r: any) => {
        const type = r.type;
        const amount = numericToNumber(r.amount);
        
        return {
          id: uuidToString(r.id),
          type: type,
          recordType: type, // 兼容页面
          amount: Math.abs(amount), // 确保为正数
          fromUserId: uuidToString(r.from_user_id),
          toUserId: uuidToString(r.to_user_id),
          status: r.status,
          description: r.description,
          createdAt: r.created_at,
        };
      });
      
      // 计算统计
      for (const r of records) {
        if (r.type === 'recharge') {
          stats.totalRecharge += r.amount;
          stats.rechargeCount++;
        } else if (r.type === 'transfer_in') {
          stats.totalTransferIn += r.amount;
          stats.transferInCount++;
        } else if (r.type === 'transfer_out') {
          stats.totalTransferOut += r.amount;
          stats.transferOutCount++;
        } else if (r.type === 'consume' || r.type === 'market_transfer' || r.type === 'purchase') {
          stats.totalConsume += r.amount;
          stats.consumeCount++;
        }
      }
      
      // 总充值 = recharge + transfer_in
      stats.totalRecharge = stats.totalRecharge + stats.totalTransferIn;
      
    } catch (e) {
      console.error('查询能量值记录失败:', e);
    }

    // 获取能量值账户余额
    // 优先读 energy_accounts，如果不存在则回退读 users.energy_value
    let balance = 0;
    try {
      const accountResult = await queryOne<{balance: number}>(
        `SELECT balance::float as balance FROM energy_accounts WHERE user_id = $1`,
        [userId]
      );
      if (accountResult) {
        balance = accountResult.balance;
      }
      // 兜底：如果 energy_accounts 无记录或 balance 为 0，从 users 表获取
      if (balance === 0) {
        const userResult = await queryOne<{energy_value: number}>(
          `SELECT energy_value::float as energy_value FROM users WHERE id = $1`,
          [userId]
        );
        if (userResult && userResult.energy_value > 0) {
          balance = userResult.energy_value;
          // 同步回写 energy_accounts
          await query(
            `INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at)
             VALUES ($1, $2, $3, $3, 0, NOW(), NOW())
             ON CONFLICT (user_id) DO UPDATE SET balance = $3, updated_at = NOW()`,
            [crypto.randomUUID(), userId, balance]
          );
        }
      }
    } catch (e) {
      console.error('查询能量值余额失败:', e);
    }

    return NextResponse.json({
      success: true,
      data: {
        records,
        stats,
        balance,
      }
    });
  } catch (error) {
    console.error('获取能量值记录失败:', error);
    return NextResponse.json({
      success: false,
      error: '获取能量值记录失败'
    }, { status: 500 });
  }
}
