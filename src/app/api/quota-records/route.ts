import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const type = searchParams.get('type');

    let sql = `
      SELECT qr.*, 
             fu.username as from_username, fu.role as from_role,
             tu.username as to_username, tu.role as to_role
      FROM quota_records qr
      LEFT JOIN users fu ON fu.id = qr.from_user_id
      LEFT JOIN users tu ON tu.id = qr.to_user_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (userId) {
      sql += ` AND (qr.from_user_id = $${params.length + 1} OR qr.to_user_id = $${params.length + 1})`;
      params.push(userId);
    }

    if (type) {
      sql += ` AND qr.type = $${params.length + 1}`;
      params.push(type);
    }

    sql += ` ORDER BY qr.created_at DESC LIMIT 100`;

    const records = await query(sql, params);

    // 计算统计数据
    let totalIssued = 0; // 已下发总额度
    let totalUsed = 0;   // 已使用额度
    let totalIdle = 0;   // 闲置额度（下级账户余额，未被购买产品的部分）

    // 获取所有下发记录的总金额
    const issuedResult = await query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM quota_records WHERE type = 'transfer'`
    );
    totalIssued = Number(issuedResult[0]?.total || 0);

    // 闲置额度 = 下级账户（分公司+服务商）的余额总和
    // 这部分额度已经下发但还没有被会员购买
    // 使用子查询方式避免 JOIN 问题
    const idleResult = await query(
      `SELECT COALESCE(SUM((balance)::float), 0) as total 
       FROM quota_accounts 
       WHERE user_id IN (
         SELECT id::text FROM users WHERE role IN ('branch', 'provider')
       )`
    );
    totalIdle = Number(idleResult[0]?.total || 0);

    // 已购买额度 = 已售出产品的总额
    const usedResult = await query(
      `SELECT COALESCE(SUM(price), 0) as total FROM products WHERE status = 'sold'`
    );
    totalUsed = Number(usedResult[0]?.total || 0);

    return NextResponse.json({
      success: true,
      data: records,
      stats: {
        totalIssued,
        totalIdle,
        totalUsed,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// 创建额度记录（用于下发）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fromUserId, toUserId, amount, type, note } = body;

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json(
        { success: false, error: '金额必须大于0' },
        { status: 400 }
      );
    }

    // 扣除转出方余额
    if (fromUserId) {
      const fromAccount = await query(
        `SELECT balance FROM quota_accounts WHERE user_id = $1`,
        [fromUserId]
      );
      if (fromAccount.length === 0 || Number(fromAccount[0].balance) < Number(amount)) {
        return NextResponse.json(
          { success: false, error: '余额不足' },
          { status: 400 }
        );
      }
      await query(
        `UPDATE quota_accounts SET 
          balance = balance - $1, 
          total_out = total_out + $1,
          updated_at = NOW()
        WHERE user_id = $2`,
        [amount, fromUserId]
      );
    }

    // 增加转入方余额
    if (toUserId) {
      await query(
        `INSERT INTO quota_accounts (user_id, balance, total_in, total_out, created_at, updated_at)
         VALUES ($1, $2, $3, 0, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           balance = quota_accounts.balance + $2,
           total_in = quota_accounts.total_in + $3,
           updated_at = NOW()`,
        [toUserId, amount, amount]
      );
      
      // 查询转入方角色，只有分公司才同步发放20%能量值
      const toUserResult = await query(
        `SELECT role FROM users WHERE id = $1`,
        [toUserId]
      );
      const toUserRole = toUserResult.length > 0 ? toUserResult[0].role : null;
      
      // 只有下发对象是分公司时才同步发放20%能量值，服务商只给算力额度
      const energyBonus = toUserRole === 'branch' ? Math.floor(Number(amount) * 0.2) : 0;
      if (energyBonus > 0 && fromUserId) {
        // 1. 扣除总公司能量值
        await query(
          `INSERT INTO energy_accounts (user_id, balance, total_in, total_out, created_at, updated_at)
           VALUES ($1, 0, 0, $2, NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET
             balance = energy_accounts.balance - $2,
             total_out = energy_accounts.total_out + $2,
             updated_at = NOW()`,
          [fromUserId, energyBonus]
        );
        
        // 2. 增加分公司能量值
        await query(
          `INSERT INTO energy_accounts (user_id, balance, total_in, total_out, created_at, updated_at)
           VALUES ($1, $2, $3, 0, NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET
             balance = energy_accounts.balance + $2,
             total_in = energy_accounts.total_in + $3,
             updated_at = NOW()`,
          [toUserId, energyBonus, energyBonus]
        );
        
        // 3. 记录能量值流水（使用 quota_match 类型，算力额度匹配能量值）
        await query(
          `INSERT INTO energy_transactions (user_id, from_user_id, to_user_id, amount, type, note, created_at)
           VALUES ($1, $2, $3, $4, 'quota_match', $5, NOW())`,
          [toUserId, fromUserId, toUserId, energyBonus, `总公司下发算力额度 ${amount} 元，同步配套20%能量值 ${energyBonus}`]
        );
      }
    }

    // 记录流转
    await query(
      `INSERT INTO quota_records (from_user_id, to_user_id, amount, type, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [fromUserId || null, toUserId, amount, type || 'transfer', note || '']
    );

    return NextResponse.json({
      success: true,
      message: '额度下发成功',
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
