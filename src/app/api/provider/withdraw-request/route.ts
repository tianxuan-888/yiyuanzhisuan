import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 服务商收益提现申请（统一到总台审核）
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { amount, alipayAccount, realName, note } = body;
    const providerId = authUser.userId;

    if (!amount) {
      return NextResponse.json({ error: '缺少提现金额' }, { status: 400 });
    }

    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      return NextResponse.json({ error: '提现金额无效' }, { status: 400 });
    }

    if (withdrawAmount < 100) {
      return NextResponse.json({ error: '最低提现金额为100元' }, { status: 400 });
    }

    // 查询服务商balance
    const providerUser = await queryOne(
      'SELECT id, username, balance FROM users WHERE id = $1',
      [providerId]
    );

    if (!providerUser) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    const currentBalance = parseFloat(String(providerUser.balance)) || 0;
    if (currentBalance < withdrawAmount) {
      return NextResponse.json({ error: '收益余额不足' }, { status: 400 });
    }

    // 冻结：从balance中扣除
    await execute(
      'UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE id = $2',
      [withdrawAmount, providerId]
    );

    // 创建提现记录（pending状态，等总台审核）
    const fee = Math.round(withdrawAmount * 0.05 * 100) / 100;
    const actualAmount = withdrawAmount - fee;

    const withdrawalResult = await queryOne(
      `INSERT INTO withdrawals (user_id, user_role, amount, fee, actual_amount, alipay_account, real_name, status, note, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, NOW(), NOW()) RETURNING id`,
      [providerId, 'provider', withdrawAmount, fee, actualAmount, alipayAccount || null, realName || null, note || `服务商提现: ${withdrawAmount}，到账${actualAmount}`]
    );

    return NextResponse.json({
      success: true,
      message: `提现申请已提交，等待总台审核。实际到账: ${actualAmount}元（扣除5%手续费 ${fee}元）`,
      data: {
        withdrawalId: withdrawalResult?.id,
        amount: withdrawAmount,
        fee,
        actualAmount,
      },
    });
  } catch (error: any) {
    console.error('服务商提现申请失败:', error);
    return NextResponse.json(
      { error: error.message || '提现申请失败' },
      { status: 500 }
    );
  }
}

// 获取服务商提现记录
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId') || authUser.userId;
    const status = searchParams.get('status') || 'all';

    let sql = `SELECT * FROM withdrawals WHERE user_id = $1 AND user_role = 'provider'`;
    const params: any[] = [providerId];

    if (status !== 'all') {
      sql += ' AND status = $2';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';

    const records = await query(sql, params);

    return NextResponse.json({ success: true, data: records || [] });
  } catch (error: any) {
    console.error('获取提现记录失败:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
