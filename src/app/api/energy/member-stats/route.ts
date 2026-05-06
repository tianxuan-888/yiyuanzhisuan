import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';

// 会员视角：能量值统计
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ success: false, error: '缺少userId参数' }, { status: 400 });
    }

    const supabase = getSupabase();

    // 验证用户
    const { data: userData, error: userErr } = await supabase
      .from('users')
      .select('id, username, energy_value, role')
      .eq('id', userId)
      .single();

    if (userErr || !userData) {
      return NextResponse.json({ success: false, error: '无效的用户ID' }, { status: 400 });
    }

    // 能量值账户
    const { data: accountData } = await supabase
      .from('energy_accounts')
      .select('*')
      .eq('user_id', userId)
      .single();

    let balance = accountData ? Number(accountData.balance) || 0 : 0;
    // 兜底：如果 energy_accounts 无记录或 balance 为 0，从 users 表获取
    if (balance === 0 && Number(userData.energy_value) > 0) {
      balance = Number(userData.energy_value);
    }
    const totalIn = accountData ? Number(accountData.total_in) || 0 : 0;
    const totalOut = accountData ? Number(accountData.total_out) || 0 : 0;

    // 能量值交易记录（所有类型）
    const { data: txData } = await supabase
      .from('energy_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    // 统计
    let totalRecharge = 0;
    let totalTransferIn = 0;
    let totalTransferOut = 0;

    (txData || []).forEach((tx: any) => {
      const amt = Number(tx.amount);
      const tp = tx.type;
      if (tp === 'recharge') {
        totalRecharge += amt;
      } else if (['transfer_in', 'convert_from_balance'].includes(tp)) {
        // 注意：provider_share/direct_reward/branch_share等是收益(balance)，不是能量值
        totalTransferIn += amt;
      } else if (tp === 'transfer_out') {
        totalTransferOut += amt;
      }
    });

    // 最近充值记录
    const recentRecharge = (txData || [])
      .filter((tx: any) => tx.type === 'recharge')
      .slice(0, 10)
      .map((tx: any) => ({
        id: tx.id,
        type: tx.type,
        amount: Number(tx.amount),
        note: tx.note,
        createdAt: tx.created_at,
      }));

    // 最近转入记录
    const recentTransferIn = (txData || [])
      .filter((tx: any) => ['transfer_in', 'convert_from_balance'].includes(tx.type))
      .slice(0, 10)
      .map((tx: any) => ({
        id: tx.id,
        type: tx.type,
        amount: Number(tx.amount),
        fromUserId: tx.from_user_id,
        note: tx.note,
        createdAt: tx.created_at,
      }));

    // 最近转出记录
    const recentTransferOut = (txData || [])
      .filter((tx: any) => ['transfer_out', 'market_fee', 'withdraw_freeze'].includes(tx.type))
      .slice(0, 10)
      .map((tx: any) => ({
        id: tx.id,
        type: tx.type,
        amount: Number(tx.amount),
        toUserId: tx.to_user_id,
        note: tx.note,
        createdAt: tx.created_at,
      }));

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: userId,
          username: userData.username,
          balance,
          totalIn,
          totalOut,
        },
        summary: {
          totalRecharge,
          totalTransferIn,
          totalTransferOut,
        },
        recentRecharge,
        recentTransferIn,
        recentTransferOut,
      },
    });
  } catch (error: any) {
    console.error('获取会员能量值统计失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
