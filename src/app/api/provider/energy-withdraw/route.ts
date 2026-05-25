import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';

// 获取服务商智算金提现记录
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    let providerId = searchParams.get('providerId');

    // 如果没传providerId，从JWT中获取
    if (!providerId) {
      const auth = await authenticateRequest(request);
      if (!auth) {
        return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
      }
      providerId = auth.userId;
    }

    const data = await query(
      `SELECT id, user_id, amount, fee, actual_amount, alipay_account, real_name, status, reject_reason, note, created_at, updated_at
       FROM withdrawals 
       WHERE user_id = $1 AND user_role = 'provider'
       ORDER BY created_at DESC`,
      [providerId]
    );

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// 服务商智算金提现
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { providerId, amount } = body;

    if (!providerId || !amount || Number(amount) < 100) {
      return NextResponse.json({
        success: false,
        error: '请填写完整信息，最低提现金额为100元'
      }, { status: 400 });
    }

    const withdrawAmount = Number(amount);

    // 查询服务商余额
    const user = await queryOne(
      'SELECT id, username, balance, energy_value, role FROM users WHERE id = $1',
      [providerId]
    );

    if (!user) {
      return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
    }

    const currentEnergy = parseFloat(String(user.energy_value || '0'));
    if (currentEnergy < withdrawAmount) {
      return NextResponse.json({
        success: false,
        error: `智算金余额不足，当前余额：${currentEnergy.toFixed(2)}`
      }, { status: 400 });
    }

    // 计算手续费5%
    const fee = Math.round(withdrawAmount * 0.05 * 100) / 100;
    const actualAmount = withdrawAmount - fee;

    // 扣除智算金
    await execute(
      'UPDATE users SET energy_value = energy_value - $1, updated_at = NOW() WHERE id = $2',
      [withdrawAmount.toFixed(2), providerId]
    );

    // 创建提现记录
    await execute(
      `INSERT INTO withdrawals (user_id, user_role, amount, fee, actual_amount, status, note, created_at)
       VALUES ($1, 'provider', $2, $3, $4, 'pending', '服务商智算金提现', NOW())`,
      [providerId, withdrawAmount.toFixed(2), fee.toFixed(2), actualAmount.toFixed(2)]
    );

    return NextResponse.json({
      success: true,
      message: '提现申请已提交，等待审核',
      data: {
        amount: withdrawAmount.toFixed(2),
        fee: fee.toFixed(2),
        actualAmount: actualAmount.toFixed(2),
        currentEnergy: (currentEnergy - withdrawAmount).toFixed(2),
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
