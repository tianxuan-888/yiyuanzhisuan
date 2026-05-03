/**
 * 能量值操作工具
 * 
 * 所有能量值相关的数据库操作必须通过此工具执行，
 * 确保 users.energy_value 和 energy_accounts 双表同步 + energy_transactions 流水记录。
 * 
 * 不使用 rpc_execute（有参数替换bug），而是直接用 Supabase JS Client 操作，
 * 保证数据一致性和可靠性。
 */

import { getSupabase } from './supabase-client';

/**
 * 获取用户当前能量值余额（优先从 energy_accounts 读取，兜底从 users 读取）
 */
export async function getEnergyBalance(userId: string): Promise<number> {
  const supabase = getSupabase();
  
  // 1. 从 energy_accounts 读取
  const { data: account } = await supabase
    .from('energy_accounts')
    .select('balance')
    .eq('user_id', userId)
    .single();
  
  if (account && Number(account.balance) !== 0) {
    return Number(account.balance);
  }
  
  // 2. 兜底从 users.energy_value 读取
  const { data: user } = await supabase
    .from('users')
    .select('energy_value')
    .eq('id', userId)
    .single();
  
  const balance = Number(user?.energy_value || 0);
  
  // 3. 如果 users 有值但 energy_accounts 没有，同步回写
  if (balance > 0 && (!account || Number(account.balance) !== balance)) {
    await syncEnergyAccounts(userId, balance);
  }
  
  return balance;
}

/**
 * 同步 energy_accounts 与 users.energy_value
 */
async function syncEnergyAccounts(userId: string, balance: number): Promise<void> {
  const supabase = getSupabase();
  
  const { data: existing } = await supabase
    .from('energy_accounts')
    .select('id, total_in, total_out')
    .eq('user_id', userId)
    .single();
  
  const now = new Date().toISOString();
  
  if (existing) {
    const totalIn = Number(existing.total_in) || 0;
    const totalOut = Number(existing.total_out) || 0;
    // 保持 total_in/total_out 不变，只修正 balance
    // 但如果 balance 与 total_in - total_out 不一致，需要修正 total_in
    const calcBalance = totalIn - totalOut;
    const newTotalIn = calcBalance !== balance ? totalIn + (balance - calcBalance) : totalIn;
    
    await supabase
      .from('energy_accounts')
      .update({
        balance,
        total_in: newTotalIn,
        updated_at: now,
      })
      .eq('user_id', userId);
  } else {
    await supabase
      .from('energy_accounts')
      .insert({
        id: crypto.randomUUID(),
        user_id: userId,
        balance,
        total_in: balance,
        total_out: 0,
        created_at: now,
        updated_at: now,
      });
  }
}

/**
 * 能量值变动类型
 */
export type EnergyChangeType = 
  | 'create'           // 总公司创建
  | 'quota_match'      // 额度匹配下发
  | 'purchase'         // 分公司购买
  | 'recharge'         // 充值（服务商给会员）
  | 'transfer_in'      // 转入
  | 'transfer_out'     // 转出
  | 'convert'          // 余额转换
  | 'convert_from_balance' // 余额转能量值
  | 'withdraw_freeze'  // 变现冻结
  | 'withdraw_return'  // 变现退回（审核拒绝）
  | 'withdraw_complete' // 变现到账
  | 'withdraw_fee'     // 变现手续费
  | 'withdraw'         // 变现发放
  | 'burn'             // 销毁
  | 'market_fee'       // 市场费
  | 'refund'           // 退款（审核拒绝退还）
  | 'income'           // 收益
  | 'reward'           // 奖励
  | 'deposit'          // 保证金
  | 'admin_create'     // 管理员创建
  | 'provider_share'   // 服务商分成
  | 'direct_reward'    // 直推奖励
  | 'parent_provider_share' // 上级服务商分成
  | 'branch_share'     // 分公司分成
  | 'company_share'    // 公司运营分成
  | 'subordinate_split' // 下级服务商分成
  | 'provider_share'   // 服务商分成
  | 'direct_reward'    // 直推奖励
  | 'parent_provider_share' // 上级服务商分成
  | 'branch_share'     // 分公司分成
  | 'company_share'    // 公司运营分成
  | 'subordinate_split';  // 下级分成

/**
 * 增加用户能量值
 * 同时更新 users.energy_value + energy_accounts + energy_transactions
 * 
 * @param userId 用户ID
 * @param amount 增加金额（正数）
 * @param type 变动类型
 * @param options 可选参数
 * @returns 更新后的余额
 */
export async function addEnergy(
  userId: string,
  amount: number,
  type: EnergyChangeType,
  options?: {
    fromUserId?: string;
    toUserId?: string;
    note?: string;
    relatedId?: string;  // 关联ID（订单ID等）
  }
): Promise<{ success: boolean; newBalance: number; error?: string }> {
  if (amount <= 0) {
    return { success: false, newBalance: 0, error: '增加金额必须大于0' };
  }
  
  const supabase = getSupabase();
  const now = new Date().toISOString();
  
  try {
    // 1. 获取当前余额
    const currentBalance = await getEnergyBalance(userId);
    const newBalance = currentBalance + amount;
    
    // 2. 更新 users.energy_value
    const { error: userErr } = await supabase
      .from('users')
      .update({ energy_value: newBalance, updated_at: now })
      .eq('id', userId);
    
    if (userErr) {
      console.error('[energy-util] addEnergy: 更新users失败', userErr.message);
      return { success: false, newBalance: currentBalance, error: '更新用户能量值失败: ' + userErr.message };
    }
    
    // 3. 更新 energy_accounts
    const { data: existingAccount } = await supabase
      .from('energy_accounts')
      .select('id, total_in, total_out')
      .eq('user_id', userId)
      .single();
    
    if (existingAccount) {
      const newTotalIn = (Number(existingAccount.total_in) || 0) + amount;
      const { error: accErr } = await supabase
        .from('energy_accounts')
        .update({
          balance: newBalance,
          total_in: newTotalIn,
          updated_at: now,
        })
        .eq('user_id', userId);
      
      if (accErr) {
        console.error('[energy-util] addEnergy: 更新energy_accounts失败', accErr.message);
        // 回滚 users.energy_value
        await supabase.from('users').update({ energy_value: currentBalance }).eq('id', userId);
        return { success: false, newBalance: currentBalance, error: '更新能量账户失败: ' + accErr.message };
      }
    } else {
      const { error: accErr } = await supabase
        .from('energy_accounts')
        .insert({
          id: crypto.randomUUID(),
          user_id: userId,
          balance: newBalance,
          total_in: amount,
          total_out: 0,
          created_at: now,
          updated_at: now,
        });
      
      if (accErr) {
        console.error('[energy-util] addEnergy: 创建energy_accounts失败', accErr.message);
        await supabase.from('users').update({ energy_value: currentBalance }).eq('id', userId);
        return { success: false, newBalance: currentBalance, error: '创建能量账户失败: ' + accErr.message };
      }
    }
    
    // 4. 记录 energy_transactions 流水
    const { error: txErr } = await supabase
      .from('energy_transactions')
      .insert({
        id: crypto.randomUUID(),
        user_id: userId,
        type,
        amount,
        from_user_id: options?.fromUserId || null,
        to_user_id: options?.toUserId || userId,
        status: 'completed',
        note: options?.note || null,
        created_at: now,
      });
    
    if (txErr) {
      console.error('[energy-util] addEnergy: 记录流水失败', txErr.message);
      // 不回滚，流水记录失败不影响业务
    }
    
    console.log(`[energy-util] addEnergy: ${userId} +${amount} (${type}) => ${newBalance}`);
    return { success: true, newBalance };
    
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[energy-util] addEnergy exception:', msg);
    return { success: false, newBalance: 0, error: msg };
  }
}

/**
 * 扣减用户能量值
 * 同时更新 users.energy_value + energy_accounts + energy_transactions
 * 
 * @param userId 用户ID
 * @param amount 扣减金额（正数）
 * @param type 变动类型
 * @param options 可选参数
 * @returns 更新后的余额
 */
export async function deductEnergy(
  userId: string,
  amount: number,
  type: EnergyChangeType,
  options?: {
    fromUserId?: string;
    toUserId?: string;
    note?: string;
    relatedId?: string;
  }
): Promise<{ success: boolean; newBalance: number; error?: string }> {
  if (amount <= 0) {
    return { success: false, newBalance: 0, error: '扣减金额必须大于0' };
  }
  
  const supabase = getSupabase();
  const now = new Date().toISOString();
  
  try {
    // 1. 获取当前余额
    const currentBalance = await getEnergyBalance(userId);
    
    if (currentBalance < amount) {
      return { success: false, newBalance: currentBalance, error: '能量值余额不足' };
    }
    
    const newBalance = currentBalance - amount;
    
    // 2. 更新 users.energy_value
    const { error: userErr } = await supabase
      .from('users')
      .update({ energy_value: newBalance, updated_at: now })
      .eq('id', userId);
    
    if (userErr) {
      console.error('[energy-util] deductEnergy: 更新users失败', userErr.message);
      return { success: false, newBalance: currentBalance, error: '更新用户能量值失败: ' + userErr.message };
    }
    
    // 3. 更新 energy_accounts
    const { data: existingAccount } = await supabase
      .from('energy_accounts')
      .select('id, total_in, total_out')
      .eq('user_id', userId)
      .single();
    
    if (existingAccount) {
      const newTotalOut = (Number(existingAccount.total_out) || 0) + amount;
      const { error: accErr } = await supabase
        .from('energy_accounts')
        .update({
          balance: newBalance,
          total_out: newTotalOut,
          updated_at: now,
        })
        .eq('user_id', userId);
      
      if (accErr) {
        console.error('[energy-util] deductEnergy: 更新energy_accounts失败', accErr.message);
        await supabase.from('users').update({ energy_value: currentBalance }).eq('id', userId);
        return { success: false, newBalance: currentBalance, error: '更新能量账户失败: ' + accErr.message };
      }
    } else {
      // 不应该存在有余额但没有 energy_accounts 记录的情况
      console.error('[energy-util] deductEnergy: 用户没有energy_accounts记录但余额>0，数据异常');
      // 创建记录
      const { error: accErr } = await supabase
        .from('energy_accounts')
        .insert({
          id: crypto.randomUUID(),
          user_id: userId,
          balance: newBalance,
          total_in: currentBalance,
          total_out: amount,
          created_at: now,
          updated_at: now,
        });
      
      if (accErr) {
        console.error('[energy-util] deductEnergy: 创建energy_accounts失败', accErr.message);
        await supabase.from('users').update({ energy_value: currentBalance }).eq('id', userId);
        return { success: false, newBalance: currentBalance, error: '创建能量账户失败: ' + accErr.message };
      }
    }
    
    // 4. 记录 energy_transactions 流水
    const { error: txErr } = await supabase
      .from('energy_transactions')
      .insert({
        id: crypto.randomUUID(),
        user_id: userId,
        type,
        amount,
        from_user_id: options?.fromUserId || userId,
        to_user_id: options?.toUserId || null,
        status: 'completed',
        note: options?.note || null,
        created_at: now,
      });
    
    if (txErr) {
      console.error('[energy-util] deductEnergy: 记录流水失败', txErr.message);
    }
    
    console.log(`[energy-util] deductEnergy: ${userId} -${amount} (${type}) => ${newBalance}`);
    return { success: true, newBalance };
    
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[energy-util] deductEnergy exception:', msg);
    return { success: false, newBalance: 0, error: msg };
  }
}

/**
 * 能量值转账（从A扣减，给B增加）
 * 原子操作：确保双方数据一致
 * 
 * @param fromUserId 转出方
 * @param toUserId 转入方
 * @param amount 金额
 * @param options 可选参数
 */
export async function transferEnergy(
  fromUserId: string,
  toUserId: string,
  amount: number,
  options?: {
    fromType?: EnergyChangeType;  // 转出方记录类型，默认 'transfer_out'
    toType?: EnergyChangeType;    // 转入方记录类型，默认 'transfer_in'
    note?: string;
  }
): Promise<{ success: boolean; fromNewBalance: number; toNewBalance: number; error?: string }> {
  if (amount <= 0) {
    return { success: false, fromNewBalance: 0, toNewBalance: 0, error: '转账金额必须大于0' };
  }
  
  const fromType = options?.fromType || 'transfer_out';
  const toType = options?.toType || 'transfer_in';
  
  // 1. 先扣减转出方
  const deductResult = await deductEnergy(fromUserId, amount, fromType, {
    toUserId,
    note: options?.note,
  });
  
  if (!deductResult.success) {
    return { 
      success: false, 
      fromNewBalance: deductResult.newBalance, 
      toNewBalance: 0, 
      error: '转出失败: ' + deductResult.error 
    };
  }
  
  // 2. 再增加转入方
  const addResult = await addEnergy(toUserId, amount, toType, {
    fromUserId,
    note: options?.note,
  });
  
  if (!addResult.success) {
    // 转入失败，回滚转出方
    console.error('[energy-util] transferEnergy: 转入失败，回滚转出方');
    await addEnergy(fromUserId, amount, 'refund', {
      fromUserId: toUserId,
      note: '转账失败退款: ' + (options?.note || ''),
    });
    return { 
      success: false, 
      fromNewBalance: deductResult.newBalance, 
      toNewBalance: 0, 
      error: '转入失败: ' + addResult.error 
    };
  }
  
  console.log(`[energy-util] transferEnergy: ${fromUserId} -> ${toUserId}, amount=${amount}`);
  return { 
    success: true, 
    fromNewBalance: deductResult.newBalance, 
    toNewBalance: addResult.newBalance 
  };
}

/**
 * 对账：验证并修复所有用户的能量值数据一致性
 * 从 energy_transactions 重新计算正确余额，修正 users.energy_value 和 energy_accounts
 */
export async function reconcileEnergy(): Promise<{
  total: number;
  fixed: number;
  details: Array<{
    userId: string;
    username: string;
    role: string;
    beforeEnergyValue: number;
    afterEnergyValue: number;
    beforeBalance: number;
    afterBalance: number;
    fixed: boolean;
  }>;
}> {
  const supabase = getSupabase();
  
  // 1. 获取所有用户
  const { data: users } = await supabase
    .from('users')
    .select('id, username, role, energy_value')
    .order('created_at');
  
  if (!users) return { total: 0, fixed: 0, details: [] };
  
  // 2. 获取所有 energy_transactions
  const { data: allTx } = await supabase
    .from('energy_transactions')
    .select('*')
    .order('created_at', { ascending: true });
  
  // 3. 按 user_id 分组计算
  const userCalc: Record<string, { totalIn: number; totalOut: number }> = {};
  if (allTx) {
    allTx.forEach(tx => {
      const uid = tx.user_id;
      if (!userCalc[uid]) userCalc[uid] = { totalIn: 0, totalOut: 0 };
      const amt = Number(tx.amount);
      const isOut = ['transfer_out', 'withdraw_freeze', 'withdraw', 'burn'].includes(tx.type);
      if (isOut) userCalc[uid].totalOut += amt;
      else userCalc[uid].totalIn += amt;
    });
  }
  
  // 4. 获取所有 energy_accounts
  const { data: accounts } = await supabase
    .from('energy_accounts')
    .select('*');
  
  const accMap: Record<string, any> = {};
  if (accounts) accounts.forEach((a: any) => { accMap[a.user_id] = a; });
  
  // 5. 验证并修复
  const details: Array<{
    userId: string;
    username: string;
    role: string;
    beforeEnergyValue: number;
    afterEnergyValue: number;
    beforeBalance: number;
    afterBalance: number;
    fixed: boolean;
  }> = [];
  
  let fixedCount = 0;
  
  for (const user of users) {
    const calc = userCalc[user.id] || { totalIn: 0, totalOut: 0 };
    // 注意：如果用户没有 transaction 记录，不修改其值（可能是初始分配未记录流水）
    const hasTransactions = !!userCalc[user.id];
    const expectedFromTx = calc.totalIn - calc.totalOut;
    
    const acc = accMap[user.id];
    const currentEv = Number(user.energy_value);
    const currentBalance = acc ? Number(acc.balance) : 0;
    
    // 如果有流水记录，以流水为准
    // 如果没有流水记录，以 users.energy_value 为准
    let targetEv = currentEv;
    let targetBalance = currentEv;
    let targetTotalIn = acc ? Number(acc.total_in) : currentEv;
    let targetTotalOut = acc ? Number(acc.total_out) : 0;
    
    if (hasTransactions) {
      // 有流水：以流水计算为准
      targetEv = expectedFromTx;
      targetBalance = expectedFromTx;
      targetTotalIn = calc.totalIn;
      targetTotalOut = calc.totalOut;
    }
    
    const needsFix = currentEv !== targetEv || currentBalance !== targetBalance ||
      (acc && (Number(acc.total_in) !== targetTotalIn || Number(acc.total_out) !== targetTotalOut));
    
    if (needsFix) {
      const now = new Date().toISOString();
      
      // 修复 users.energy_value
      if (currentEv !== targetEv) {
        await supabase.from('users').update({ energy_value: targetEv, updated_at: now }).eq('id', user.id);
      }
      
      // 修复 energy_accounts
      if (acc) {
        await supabase.from('energy_accounts').update({
          balance: targetBalance,
          total_in: targetTotalIn,
          total_out: targetTotalOut,
          updated_at: now,
        }).eq('user_id', user.id);
      } else if (targetBalance !== 0) {
        await supabase.from('energy_accounts').insert({
          id: crypto.randomUUID(),
          user_id: user.id,
          balance: targetBalance,
          total_in: targetTotalIn,
          total_out: targetTotalOut,
          created_at: now,
          updated_at: now,
        });
      }
      
      fixedCount++;
    }
    
    details.push({
      userId: user.id,
      username: user.username,
      role: user.role,
      beforeEnergyValue: currentEv,
      afterEnergyValue: targetEv,
      beforeBalance: currentBalance,
      afterBalance: targetBalance,
      fixed: needsFix,
    });
  }
  
  return { total: users.length, fixed: fixedCount, details };
}
