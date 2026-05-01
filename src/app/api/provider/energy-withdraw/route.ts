import { NextRequest, NextResponse } from 'next/server';
import { query, execute, queryOne } from '@/storage/database/pg-client';
import { generateUUID } from '@/lib/utils';

// 服务商能量值提现申请
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { providerId, amount, note } = body;

    if (!providerId || !amount) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const withdrawAmount = parseFloat(amount);
    if (withdrawAmount < 50) {
      return NextResponse.json({ error: '最低提现金额为50能量值' }, { status: 400 });
    }

    // 获取服务商信息
    const provider = await queryOne<{ id: string; username: string; energy_value: number; branch_id: string }>(
      'SELECT id, username, energy_value, branch_id FROM users WHERE id = $1',
      [providerId]
    );

    if (!provider) {
      return NextResponse.json({ error: '服务商不存在' }, { status: 404 });
    }

    const currentEnergy = parseFloat(String(provider.energy_value)) || 0;
    if (currentEnergy < withdrawAmount) {
      return NextResponse.json({ error: '能量值余额不足' }, { status: 400 });
    }

    // 计算手续费和实际到账
    const feeRate = 0.05;
    const fee = withdrawAmount * feeRate;
    const actualAmount = withdrawAmount - fee;

    // 创建提现记录
    const requestId = generateUUID();
    await execute(
      `INSERT INTO withdrawals (id, user_id, amount, actual_amount, fee_amount, status, note, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW(), NOW())`,
      [requestId, providerId, withdrawAmount, actualAmount, fee, note || null]
    );

    return NextResponse.json({
      success: true,
      message: `提现申请已提交，等待分公司审核。实际到账: ${actualAmount}（扣除5%手续费 ${fee}）`,
      data: {
        requestId,
        amount: withdrawAmount,
        actualAmount,
        fee,
        feeRate: `${feeRate * 100}%`,
      },
    });
  } catch (error: any) {
    console.error('服务商提现申请失败:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 获取服务商提现记录
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');
    const status = searchParams.get('status') || 'all';

    if (!providerId) {
      return NextResponse.json({ error: '服务商ID不能为空' }, { status: 400 });
    }

    let sql = 'SELECT * FROM withdrawals WHERE user_id = $1';
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
