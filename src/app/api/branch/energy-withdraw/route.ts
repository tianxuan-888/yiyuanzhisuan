import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取分公司的变现申请记录
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');

    if (!branchId) {
      return NextResponse.json(
        { success: false, error: '缺少分公司ID' },
        { status: 400 }
      );
    }

    // 查询分公司的变现申请记录
    const records = await query(
      `SELECT wr.*, 
              u.username
       FROM energy_withdraw_requests wr
       JOIN users u ON u.id = wr.user_id
       WHERE wr.user_id = $1
       ORDER BY wr.created_at DESC
       LIMIT 100`,
      [branchId]
    );

    // 计算统计
    const stats = {
      pending: { count: 0, amount: 0 },
      approved: { count: 0, amount: 0 },
      rejected: { count: 0, amount: 0 },
    };

    records.forEach((r: any) => {
      if (r.status === 'pending') {
        stats.pending.count++;
        stats.pending.amount += Number(r.amount);
      } else if (r.status === 'approved') {
        stats.approved.count++;
        stats.approved.amount += Number(r.amount);
      } else if (r.status === 'rejected') {
        stats.rejected.count++;
        stats.rejected.amount += Number(r.amount);
      }
    });

    return NextResponse.json({
      success: true,
      data: {
        records,
        stats,
      },
    });
  } catch (error) {
    console.error('获取变现记录失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    );
  }
}

// 分公司申请变现
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { branchId, amount, paymentMethod, paymentAccount, note } = body;

    if (!branchId || !amount || !paymentMethod || !paymentAccount) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount < 50) {
      return NextResponse.json(
        { success: false, error: '变现金额最低为50' },
        { status: 400 }
      );
    }

    // 验证是分公司
    const branch = await query(
      'SELECT id, username, role FROM users WHERE id = $1',
      [branchId]
    );

    if (!branch || branch.length === 0) {
      return NextResponse.json(
        { success: false, error: '用户不存在' },
        { status: 404 }
      );
    }

    if (branch[0].role !== 'branch') {
      return NextResponse.json(
        { success: false, error: '只有分公司才能申请变现' },
        { status: 403 }
      );
    }

    // 检查能量值余额
    const account = await query(
      `SELECT balance FROM energy_accounts WHERE user_id::text = $1`,
      [branchId]
    );
    const currentBalance = account.length > 0 ? Number(account[0].balance || 0) : 0;

    if (currentBalance < withdrawAmount) {
      return NextResponse.json(
        { success: false, error: `能量值余额不足（当前余额：${currentBalance.toLocaleString()}）` },
        { status: 400 }
      );
    }

    // 计算手续费（5%）和实际到账金额
    const feeRate = 0.05;
    const fee = withdrawAmount * feeRate;
    const actualAmount = withdrawAmount - fee;

    // 创建变现申请
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO energy_withdraw_requests 
       (id, user_id, amount, payment_method, payment_account, fee, actual_amount, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW(), NOW())`,
      [id, branchId, withdrawAmount, paymentMethod, paymentAccount, fee, actualAmount]
    );

    // 记录能量值变动（冻结）
    await query(
      `INSERT INTO energy_transactions
       (id, user_id, type, amount, energy_before, energy_after, note, status, created_at)
       VALUES ($1, $2, 'withdraw_freeze', $3, $4, $4, $5, 'pending', NOW())`,
      [crypto.randomUUID(), branchId, withdrawAmount, currentBalance.toFixed(2), `申请变现 ${withdrawAmount.toLocaleString()}，手续费 ${fee.toLocaleString()}，实际到账 ${actualAmount.toLocaleString()}`]
    );

    // 扣除能量值
    await query(
      `INSERT INTO energy_accounts (user_id, balance, total_in, total_out, created_at, updated_at)
       VALUES ($1, 0, 0, $2, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         balance = energy_accounts.balance - $2,
         total_out = energy_accounts.total_out + $2,
         updated_at = NOW()`,
      [branchId, withdrawAmount]
    );

    return NextResponse.json({
      success: true,
      message: `变现申请已提交，等待总公司审核`,
      data: {
        requestId: id,
        amount: withdrawAmount,
        fee: fee,
        actualAmount: actualAmount,
        status: 'pending',
      },
    });
  } catch (error) {
    console.error('变现申请失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '变现申请失败' },
      { status: 500 }
    );
  }
}
