import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';

// 获取用户收益记录
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: '用户ID不能为空' }, { status: 400 });
    }

    const supabase = getSupabase();

    // 1. 查询收益交易记录
    const { data: txData, error: txErr } = await supabase
      .from('energy_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (txErr) {
      console.error('查询收益记录失败:', txErr.message);
    }

    const records = (txData || []).map((r: any) => {
      const amount = Math.abs(Number(r.amount));
      return {
        id: r.id,
        type: r.type,
        recordType: r.type,
        amount,
        fromUserId: r.from_user_id || '',
        toUserId: r.to_user_id || '',
        status: r.status,
        description: r.note || r.description || '',
        note: r.note || '',
        createdAt: r.created_at,
        created_at: r.created_at,
      };
    });

    // 2. 计算统计
    const stats = {
      totalRecharge: 0,
      totalTransferIn: 0,
      totalTransferOut: 0,
      totalConsume: 0,
      rechargeCount: 0,
      transferInCount: 0,
      transferOutCount: 0,
      consumeCount: 0,
    };

    for (const r of records) {
      if (r.type === 'recharge') {
        stats.totalRecharge += r.amount;
        stats.rechargeCount++;
      } else if (r.type === 'transfer_in' || r.type === 'convert_from_balance' || r.type === 'provider_share' || r.type === 'direct_reward' || r.type === 'branch_share' || r.type === 'company_share' || r.type === 'parent_provider_share' || r.type === 'subordinate_split') {
        stats.totalTransferIn += r.amount;
        stats.transferInCount++;
      } else if (r.type === 'transfer_out') {
        stats.totalTransferOut += r.amount;
        stats.transferOutCount++;
      } else if (r.type === 'market_fee' || r.type === 'consume' || r.type === 'withdraw_freeze' || r.type === 'withdraw' || r.type === 'burn' || r.type === 'purchase') {
        stats.totalConsume += r.amount;
        stats.consumeCount++;
      }
    }

    // 保持各分类独立，前端分别展示
    // totalRecharge: 仅充值(recharge)
    // totalTransferIn: 转入类(convert_from_balance, transfer_in, 各种分成)
    // 总计转入 = totalRecharge + totalTransferIn

    // 3. 获取收益余额
    let balance = 0;

    // 优先读 energy_accounts
    const { data: accountData } = await supabase
      .from('energy_accounts')
      .select('balance')
      .eq('user_id', userId)
      .single();

    if (accountData) {
      balance = Number(accountData.balance) || 0;
    }

    // 兜底：如果 energy_accounts 无记录或 balance 为 0，从 users 表获取
    if (balance === 0) {
      const { data: userData } = await supabase
        .from('users')
        .select('energy_value')
        .eq('id', userId)
        .single();

      if (userData && Number(userData.energy_value) > 0) {
        balance = Number(userData.energy_value);
        // 同步回写 energy_accounts
        await supabase
          .from('energy_accounts')
          .upsert({
            user_id: userId,
            balance,
            total_in: balance,
            total_out: 0,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        records,
        stats,
        balance,
      }
    });
  } catch (error) {
    console.error('获取收益记录失败:', error);
    return NextResponse.json({
      success: false,
      error: '获取收益记录失败'
    }, { status: 500 });
  }
}
