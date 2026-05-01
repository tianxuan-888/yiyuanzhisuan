import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest } from '@/lib/auth';

// 提现申请
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

    // 验证操作者权限：管理员或本人
    if (user.role !== 'admin' && user.userId !== userId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    if (amount <= 0) {
      return NextResponse.json({ error: '提现金额必须大于0' }, { status: 400 });
    }

    // 最低提现金额
    const minWithdrawAmount = 100;
    if (amount < minWithdrawAmount) {
      return NextResponse.json({ error: `最低提现金额为 ${minWithdrawAmount} 元` }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 查询用户信息
    const { data: userData, error: userError } = await client
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (userError || !userData) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    // 检查余额是否足够
    const userBalance = parseFloat(userData.balance || '0');
    if (userBalance < amount) {
      return NextResponse.json({
        success: false,
        error: '余额不足',
        data: { required: amount, current: userBalance, short: amount - userBalance }
      }, { status: 400 });
    }

    // 查询服务商收款账号
    const { data: provider } = await client
      .from('users')
      .select('wechat_account, alipay_account')
      .eq('role', 'provider')
      .maybeSingle();

    // 白名单过滤更新字段
    const safeUserUpdate = { balance: userBalance - amount };

    // 扣除余额
    const { error: updateBalanceError } = await client
      .from('users')
      .update(safeUserUpdate)
      .eq('id', userId);

    if (updateBalanceError) {
      throw new Error(`扣除余额失败: ${updateBalanceError.message}`);
    }

    // 创建提现记录 - 白名单过滤
    const { data: withdrawal, error: createError } = await client
      .from('withdrawals')
      .insert({
        user_id: userId,
        amount: amount,
        status: 'pending'
      })
      .select()
      .single();

    if (createError) {
      // 回滚余额
      await client.from('users').update({ balance: userBalance }).eq('id', userId);
      throw new Error(`创建提现记录失败: ${createError.message}`);
    }

    return NextResponse.json({
      success: true,
      message: '提现申请已提交',
      data: {
        withdrawalId: withdrawal.id,
        amount,
        newBalance: userBalance - amount
      }
    });
  } catch (error) {
    console.error('提现申请失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
