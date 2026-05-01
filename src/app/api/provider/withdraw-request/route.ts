import { NextRequest, NextResponse } from 'next/server';
import { query, execute, queryOne } from '@/storage/database/pg-client';
import { generateUUID } from '@/lib/utils';

// 服务商提交提现申请
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { providerId, amount, note } = body;

    if (!providerId || !amount) {
      return NextResponse.json({ success: false, error: '缺少必要参数' }, { status: 400 });
    }

    const withdrawAmount = parseFloat(amount);
    if (withdrawAmount < 50) {
      return NextResponse.json({ success: false, error: '最低提现金额为50能量值' }, { status: 400 });
    }

    // 获取服务商信息
    const provider = await queryOne<{ id: string; username: string; energy_value: number; branch_id: string }>(
      'SELECT id, username, energy_value, branch_id FROM users WHERE id = $1',
      [providerId]
    );

    if (!provider) {
      return NextResponse.json({ success: false, error: '服务商不存在' }, { status: 404 });
    }

    const currentEnergy = parseFloat(String(provider.energy_value)) || 0;
    if (currentEnergy < withdrawAmount) {
      return NextResponse.json({ success: false, error: '能量值余额不足' }, { status: 400 });
    }

    // 创建提现申请
    const requestId = generateUUID();
    const feeRate = 0.05;
    const fee = withdrawAmount * feeRate;
    const actualAmount = withdrawAmount - fee;

    await execute(
      `INSERT INTO quota_requests (id, requester_id, requester_type, parent_id, requested_amount, approved_amount, multiplier, status, reject_reason, created_at, updated_at)
       VALUES ($1, $2, 'provider', $3, $4, $5, $6, 'pending', $7, NOW(), NOW())`,
      [requestId, providerId, provider.branch_id, Math.floor(withdrawAmount), Math.floor(actualAmount), fee, note || null]
    );

    return NextResponse.json({
      success: true,
      message: '提现申请已提交，等待分公司审核',
      data: {
        requestId,
        amount: withdrawAmount,
        actualAmount,
        fee,
        feeRate: feeRate * 100 + '%',
      },
    });
  } catch (error: any) {
    console.error('提交提现申请失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// 获取服务商的提现申请列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');
    const status = searchParams.get('status') || 'all';

    if (!providerId) {
      return NextResponse.json({ success: false, error: '服务商ID不能为空' }, { status: 400 });
    }

    let sql = `
      SELECT * FROM quota_requests 
      WHERE requester_id = $1 AND requester_type = 'provider'
    `;
    const params: any[] = [providerId];

    if (status !== 'all') {
      sql += ' AND status = $2';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';

    const records = await query(sql, params);

    return NextResponse.json({ success: true, data: records || [] });
  } catch (error: any) {
    console.error('获取提现申请失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
