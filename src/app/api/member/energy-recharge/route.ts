import { NextRequest, NextResponse } from 'next/server';
import { query, execute, queryOne } from '@/storage/database/pg-client';
import { generateUUID } from '@/lib/utils';

// 充值能量值申请
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, amount, note } = body;

    if (!userId || !amount) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const rechargeAmount = parseFloat(amount);
    if (isNaN(rechargeAmount) || rechargeAmount <= 0) {
      return NextResponse.json({ error: '充值金额无效' }, { status: 400 });
    }

    if (rechargeAmount < 50) {
      return NextResponse.json({ error: '最低充值金额为50能量值' }, { status: 400 });
    }

    // 查询用户信息
    const user = await queryOne<{ id: string; username: string; provider_id: string; phone: string }>(
      'SELECT id, username, provider_id, phone FROM users WHERE id = $1',
      [userId]
    );

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    if (!user.provider_id) {
      return NextResponse.json({ error: '未绑定服务商，请先联系服务商' }, { status: 400 });
    }

    // 获取服务商信息
    const provider = await queryOne<{ id: string; username: string; phone: string }>(
      'SELECT id, username, phone FROM users WHERE id = $1',
      [user.provider_id]
    );

    if (!provider) {
      return NextResponse.json({ error: '服务商不存在' }, { status: 404 });
    }

    // 创建充值申请记录
    const requestId = generateUUID();
    await execute(
      `INSERT INTO transactions (id, user_id, type, amount, description, status, created_at)
       VALUES ($1, $2, 'recharge', $3, $4, 'pending', NOW())`,
      [requestId, user.provider_id, rechargeAmount, JSON.stringify({
        member_id: userId,
        member_name: user.username,
        member_phone: user.phone,
        note: note || null,
      })]
    );

    return NextResponse.json({
      success: true,
      message: '充值申请已提交，请联系服务商线下付款后等待确认',
      data: {
        requestId,
        providerName: provider.username,
        providerPhone: provider.phone,
        amount: rechargeAmount,
      },
    });
  } catch (error: any) {
    console.error('充值申请失败:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 获取会员的充值申请记录
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: '用户ID不能为空' }, { status: 400 });
    }

    // 查询该用户的充值申请（通过 member_id 关联）
    const records = await query(
      `SELECT * FROM transactions 
       WHERE type = 'recharge' 
       AND description LIKE $1
       ORDER BY created_at DESC`,
      [`%${userId}%`]
    );

    return NextResponse.json({ success: true, data: records || [] });
  } catch (error: any) {
    console.error('获取充值记录失败:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
