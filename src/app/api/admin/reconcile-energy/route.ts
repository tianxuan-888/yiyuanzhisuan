import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { execute, queryOne } from '@/lib/pg-client';

// 对账API：根据 energy_transactions 流水重新计算所有用户的正确余额
// 并修复 users.energy_value 和 energy_accounts 的不一致
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();

    // 1. 获取所有 energy_transactions
    const { data: allTx, error: txErr } = await supabase
      .from('energy_transactions')
      .select('*')
      .order('created_at', { ascending: true });

    if (txErr) {
      return NextResponse.json({ error: '查询流水失败: ' + txErr.message }, { status: 500 });
    }

    // 2. 按 user_id 分组计算正确的 total_in, total_out, balance
    const userCalc: Record<string, { totalIn: number; totalOut: number }> = {};
    const outTypes = ['transfer_out', 'withdraw_freeze', 'withdraw', 'burn', 'market_fee'];

    (allTx || []).forEach((tx: any) => {
      const uid = tx.user_id;
      if (!userCalc[uid]) userCalc[uid] = { totalIn: 0, totalOut: 0 };
      const amt = Math.abs(Number(tx.amount));
      if (outTypes.includes(tx.type)) {
        userCalc[uid].totalOut += amt;
      } else {
        userCalc[uid].totalIn += amt;
      }
    });

    // 3. 获取所有用户和 energy_accounts
    const { data: users } = await supabase.from('users').select('id,username,role,energy_value').order('created_at');
    const { data: accounts } = await supabase.from('energy_accounts').select('*');
    const accMap: Record<string, any> = {};
    (accounts || []).forEach((a: any) => { accMap[a.user_id] = a; });

    // 4. 修复每个用户
    const results: any[] = [];

    for (const user of (users || [])) {
      const calc = userCalc[user.id] || { totalIn: 0, totalOut: 0 };
      const expectedBalance = calc.totalIn - calc.totalOut;
      const acc = accMap[user.id];

      const currentUserEv = Number(user.energy_value) || 0;
      const currentAccBalance = acc ? Number(acc.balance) || 0 : 0;
      const currentAccTotalIn = acc ? Number(acc.total_in) || 0 : 0;
      const currentAccTotalOut = acc ? Number(acc.total_out) || 0 : 0;

      const needFixUser = currentUserEv !== expectedBalance;
      const needFixAcc = !acc || currentAccBalance !== expectedBalance || currentAccTotalIn !== calc.totalIn || currentAccTotalOut !== calc.totalOut;

      if (!needFixUser && !needFixAcc) {
        results.push({
          username: user.username,
          role: user.role,
          status: 'consistent',
          balance: expectedBalance,
        });
        continue;
      }

      // 修复 users.energy_value - 使用 SQL 直接执行
      if (needFixUser) {
        try {
          await execute('UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2', [expectedBalance, user.id]);
        } catch (updErr: any) {
          results.push({ username: user.username, role: user.role, status: 'fix_failed', error: updErr.message });
          continue;
        }
      }

      // 修复 energy_accounts - 使用 SQL 直接执行
      if (needFixAcc) {
        if (acc) {
          try {
            await execute(
              'UPDATE energy_accounts SET balance = $1, total_in = $2, total_out = $3, updated_at = NOW() WHERE user_id = $4',
              [expectedBalance, calc.totalIn, calc.totalOut, user.id]
            );
          } catch (updErr: any) {
            results.push({ username: user.username, role: user.role, status: 'fix_acc_failed', error: updErr.message });
            continue;
          }
        } else {
          try {
            await execute(
              'INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
              [crypto.randomUUID(), user.id, expectedBalance, calc.totalIn, calc.totalOut]
            );
          } catch (insErr: any) {
            results.push({ username: user.username, role: user.role, status: 'create_acc_failed', error: insErr.message });
            continue;
          }
        }
      }

      results.push({
        username: user.username,
        role: user.role,
        status: 'fixed',
        before: { userEv: currentUserEv, accBalance: currentAccBalance, accTotalIn: currentAccTotalIn, accTotalOut: currentAccTotalOut },
        after: { balance: expectedBalance, totalIn: calc.totalIn, totalOut: calc.totalOut },
      });
    }

    const fixedCount = results.filter(r => r.status === 'fixed').length;
    const consistentCount = results.filter(r => r.status === 'consistent').length;
    const failedCount = results.filter(r => r.status !== 'fixed' && r.status !== 'consistent').length;

    return NextResponse.json({
      success: true,
      summary: {
        totalUsers: results.length,
        fixed: fixedCount,
        consistent: consistentCount,
        failed: failedCount,
      },
      details: results,
    });
  } catch (error: any) {
    console.error('对账失败:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET: 仅检查一致性，不修复
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabase();

    const { data: users } = await supabase.from('users').select('id,username,role,energy_value');
    const { data: accounts } = await supabase.from('energy_accounts').select('*');
    const accMap: Record<string, any> = {};
    (accounts || []).forEach((a: any) => { accMap[a.user_id] = a; });

    const { data: allTx } = await supabase.from('energy_transactions').select('user_id,type,amount');
    const outTypes = ['transfer_out', 'withdraw_freeze', 'withdraw', 'burn', 'market_fee'];
    const userCalc: Record<string, { totalIn: number; totalOut: number }> = {};
    (allTx || []).forEach((tx: any) => {
      const uid = tx.user_id;
      if (!userCalc[uid]) userCalc[uid] = { totalIn: 0, totalOut: 0 };
      const amt = Math.abs(Number(tx.amount));
      if (outTypes.includes(tx.type)) {
        userCalc[uid].totalOut += amt;
      } else {
        userCalc[uid].totalIn += amt;
      }
    });

    const results = (users || []).map((user: any) => {
      const calc = userCalc[user.id] || { totalIn: 0, totalOut: 0 };
      const expectedBalance = calc.totalIn - calc.totalOut;
      const acc = accMap[user.id];
      const currentUserEv = Number(user.energy_value) || 0;
      const currentAccBalance = acc ? Number(acc.balance) || 0 : 0;

      return {
        username: user.username,
        role: user.role,
        usersEnergyValue: currentUserEv,
        accBalance: currentAccBalance,
        expectedBalance,
        consistent: currentUserEv === expectedBalance && currentAccBalance === expectedBalance,
      };
    });

    return NextResponse.json({
      success: true,
      summary: {
        totalUsers: results.length,
        consistent: results.filter(r => r.consistent).length,
        inconsistent: results.filter(r => !r.consistent).length,
      },
      details: results,
    });
  } catch (error: any) {
    console.error('对账检查失败:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
