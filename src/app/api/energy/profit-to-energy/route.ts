import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest } from '@/lib/auth';
import { execute, queryOne } from '@/lib/pg-client';

// 收益转能量值
export async function POST(request: NextRequest) {
  try {
    // 鉴权：需要登录
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, amount } = body;

    // 参数验证
    if (!userId || !amount) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 验证操作者权限
    if (user.role !== 'admin' && user.userId !== userId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    if (amount <= 0) {
      return NextResponse.json({ error: '转换金额必须大于0' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 使用 SQL 直接查询用户信息
    const userData = await queryOne('SELECT id, username, balance, energy_value FROM users WHERE id = $1', [userId]);

    if (!userData) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    // 检查余额是否足够
    const userBalance = parseFloat(String(userData.balance)) || 0;
    if (userBalance < amount) {
      return NextResponse.json({
        success: false,
        error: '余额不足',
        data: { required: amount, current: userBalance, short: amount - userBalance }
      }, { status: 400 });
    }

    // 使用 SQL 直接更新余额和能量值（原子操作，确保写入成功）
    const newBalance = userBalance - amount;
    const newEnergy = (parseFloat(String(userData.energy_value)) || 0) + amount;

    await execute('UPDATE users SET balance = $1, energy_value = $2, updated_at = NOW() WHERE id = $3', [newBalance, newEnergy, userId]);

    // 记录交易
    await client.from('transactions').insert({
      user_id: userId,
      type: 'profit_to_energy',
      amount: amount,
      note: '收益转换为能量值'
    });

    return NextResponse.json({
      success: true,
      message: '转换成功',
      data: { newBalance, newEnergy, amount }
    });
  } catch (error) {
    console.error('收益转能量值失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
