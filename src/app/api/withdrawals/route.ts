import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { query, queryOne, execute } from '@/lib/supabase-client';

/**
 * 统一提现API
 * 
 * GET  - 查询提现记录（按角色过滤）
 * POST - 申请提现（通用）
 * 
 * 提现来源：
 *   会员/服务商 → 从 energy_value（智算金）扣除
 *   网点       → 从 balance（收益）扣除
 * 
 * 审核方：
 *   会员   → 网点审核
 *   服务商 → 网点审核
 *   网点   → 总台审核
 */

// 申请提现
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) return NextResponse.json({ success: false, message: '未授权' }, { status: 401 });

    const body = await request.json();
    const { amount, alipayAccount, realName, note } = body;

    if (!amount || amount < 100) {
      return NextResponse.json({ success: false, message: '最低提现金额为100元' });
    }

    // 查询用户信息
    const user = await queryOne(
      `SELECT id, username, role, energy_value, balance, provider_id, branch_id FROM users WHERE id = $1`,
      [auth.userId]
    );

    if (!user) {
      return NextResponse.json({ success: false, message: '用户不存在' });
    }

    console.log('[withdrawals] POST user:', user.username, 'role:', user.role, 'energy_value:', user.energy_value, 'balance:', user.balance, 'amount:', amount);

    // 所有角色统一从智算金(energy_value)扣除
    const sourceField = 'energy_value';
    const sourceLabel = '智算金';
    const availableAmount = user.energy_value;

    if (availableAmount < amount) {
      return NextResponse.json({ success: false, message: `${sourceLabel}余额不足，当前余额¥${availableAmount}` });
    }

    // 计算手续费 5%
    const feeRate = 0.05;
    const fee = Math.round(amount * feeRate * 100) / 100;
    const actualAmount = Math.round((amount - fee) * 100) / 100;

    // 审核方类型：会员/服务商 → branch审核，网点 → admin审核
    const reviewerType = user.role === 'branch' ? 'admin' : 'branch';

    // 角色中文
    const roleLabel = user.role === 'member' ? '会员' : user.role === 'provider' ? '服务商' : '网点';

    // 扣除金额
    await execute(
      `UPDATE users SET ${sourceField} = ${sourceField} - $1, updated_at = NOW() WHERE id = $2`,
      [amount, user.id]
    );

    // 写入提现记录
    const result = await queryOne(
      `INSERT INTO withdrawals (user_id, user_role, amount, fee, actual_amount, alipay_account, real_name, status, reviewer_type, note, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, NOW(), NOW())
       RETURNING id`,
      [user.id, user.role, amount, fee, actualAmount, alipayAccount || null, realName || null, reviewerType, note || `${roleLabel}${sourceLabel}提现`]
    );

    // 写入energy_transactions明细（提现冻结）
    await execute(
      `INSERT INTO energy_transactions (user_id, type, amount, from_user_id, to_user_id, note, created_at)
       VALUES ($1, 'withdraw_freeze', $2, $1, NULL, $3, NOW())`,
      [user.id, amount, `${roleLabel}提现¥${amount}`]
    );

    // 查询更新后的余额
    const updatedUser = await queryOne(
      `SELECT ${sourceField} FROM users WHERE id = $1`,
      [user.id]
    );

    return NextResponse.json({
      success: true,
      message: '提现申请已提交，等待审核',
      data: {
        withdrawalId: result.id,
        amount,
        fee,
        actualAmount,
        reviewerType,
        currentBalance: updatedUser[sourceField] || 0
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '提现申请失败';
    console.error('[withdrawals] POST error:', error);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

// 查询提现记录
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) return NextResponse.json({ success: false, message: '未授权' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const filterRole = searchParams.get('role');
    const filterUserId = searchParams.get('userId');
    const tab = searchParams.get('tab'); // 'mine' 自己的提现, 'review' 待我审核的

    // 查询用户信息确定角色
    const user = await queryOne(
      `SELECT id, role, provider_id, branch_id FROM users WHERE id = $1`,
      [auth.userId]
    );

    if (!user) {
      return NextResponse.json({ success: false, message: '用户不存在' });
    }

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (user.role === 'admin') {
      // 总台：看所有提现，主要看网点提现（reviewer_type = admin）
      if (tab === 'review') {
        conditions.push(`w.reviewer_type = 'admin'`);
      } else if (tab === 'mine') {
        conditions.push(`w.user_id = $${paramIndex++}`);
        params.push(user.id);
      }
      if (filterRole) {
        conditions.push(`w.user_role = $${paramIndex++}`);
        params.push(filterRole);
      }
      if (filterUserId) {
        conditions.push(`w.user_id = $${paramIndex++}`);
        params.push(filterUserId);
      }
    } else if (user.role === 'branch') {
      // 网点：
      //   review tab: 看待自己审核的提现（会员+服务商的提现，reviewer_type = branch 且属于本网点）
      //   mine tab: 看自己的提现
      if (tab === 'review') {
        conditions.push(`w.reviewer_type = 'branch'`);
        // 只看本网点下的会员和服务商的提现
        // 会员的 branch_id 直接指向网点，服务商通过 providers 表关联网点
        conditions.push(`(u.branch_id = $${paramIndex++} OR w.user_id IN (SELECT p.user_id FROM providers p WHERE p.branch_id = $${paramIndex++}))`);
        params.push(user.id);
        params.push(user.id);
      } else if (tab === 'mine') {
        conditions.push(`w.user_id = $${paramIndex++}`);
        params.push(user.id);
      } else {
        // 默认：自己的提现 + 待自己审核的提现
        conditions.push(`(w.user_id = $${paramIndex++} OR (w.reviewer_type = 'branch' AND (u.branch_id = $${paramIndex++} OR w.user_id IN (SELECT p.user_id FROM providers p WHERE p.branch_id = $${paramIndex++}))))`);
        params.push(user.id);
        params.push(user.id);
        params.push(user.id);
      }
    } else if (user.role === 'provider') {
      // 服务商：只看自己的提现
      conditions.push(`w.user_id = $${paramIndex++}`);
      params.push(user.id);
    } else {
      // 会员：只看自己的提现
      conditions.push(`w.user_id = $${paramIndex++}`);
      params.push(user.id);
    }

    if (status) {
      conditions.push(`w.status = $${paramIndex++}`);
      params.push(status);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const records = await query(
      `SELECT w.id, w.user_id, w.user_role, w.amount, w.fee, w.actual_amount,
              w.alipay_account, w.real_name, w.status, w.reject_reason, w.reviewer_type,
              w.reviewer_id, w.reviewed_at, w.completed_at, w.note, w.created_at, w.updated_at,
              u.username, u.phone, u.unique_id
       FROM withdrawals w
       LEFT JOIN users u ON w.user_id = u.id
       ${whereClause}
       ORDER BY w.created_at DESC
       LIMIT 100`,
      params
    );

    // 统计数据
    const stats = await query(
      `SELECT 
         COUNT(*) FILTER (WHERE w.status = 'pending') as pending_count,
         COALESCE(SUM(w.amount) FILTER (WHERE w.status = 'pending'), 0) as pending_amount,
         COALESCE(SUM(w.amount) FILTER (WHERE w.status = 'completed'), 0) as completed_amount,
         COALESCE(SUM(w.amount) FILTER (WHERE w.status = 'approved'), 0) as approved_amount
       FROM withdrawals w
       LEFT JOIN users u ON w.user_id = u.id
       ${whereClause}`,
      params
    );

    return NextResponse.json({
      success: true,
      data: {
        records,
        stats: stats[0] || { pending_count: 0, pending_amount: 0, completed_amount: 0, approved_amount: 0 }
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '查询失败';
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
