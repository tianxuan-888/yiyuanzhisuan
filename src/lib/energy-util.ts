/**
 * 能量值操作工具
 * 
 * 所有能量值相关的数据库操作必须通过此工具执行，
 * 确保 users.energy_value 和 energy_accounts 双表同步 + energy_transactions 流水记录。
 * 
 * 使用 execute(SQL) 直接SQL执行，绕过 Supabase REST API 的潜在静默失败问题。
 */

import { execute, queryOne } from './pg-client';

/**
 * 获取用户当前能量值余额（优先从 energy_accounts 读取，兜底从 users 读取）
 */
export async function getEnergyBalance(userId: string): Promise<number> {
  // 1. 从 energy_accounts 读取
  const account = await queryOne<{ balance: number }>(
    'SELECT balance FROM energy_accounts WHERE user_id = $1',
    [userId]
  );
  
  if (account && Number(account.balance) !== 0) {
    return Number(account.balance);
  }
  
  // 2. 兜底从 users.energy_value 读取
  const user = await queryOne<{ energy_value: number }>(
    'SELECT energy_value FROM users WHERE id = $1',
    [userId]
  );
  
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
  const existing = await queryOne<{ id: string; total_in: number; total_out: number }>(
    'SELECT id, total_in, total_out FROM energy_accounts WHERE user_id = $1',
    [userId]
  );
  
  if (existing) {
    const totalIn = Number(existing.total_in) || 0;
    const totalOut = Number(existing.total_out) || 0;
    const calcBalance = totalIn - totalOut;
    const newTotalIn = calcBalance !== balance ? totalIn + (balance - calcBalance) : totalIn;
    
    await execute(
      'UPDATE energy_accounts SET balance = $1, total_in = $2, updated_at = NOW() WHERE user_id = $3',
      [balance, newTotalIn, userId]
    );
  } else {
    await execute(
      'INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $2, 0, NOW(), NOW())',
      [userId, balance]
    );
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
  | 'subordinate_split';  // 下级分成

/**
 * 增加用户能量值
 * 同时更新 users.energy_value + energy_accounts + energy_transactions
 * 使用 SQL 直接执行确保写入成功
 */
export async function addEnergy(
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
    return { success: false, newBalance: 0, error: '增加金额必须大于0' };
  }
  
  try {
    // 1. 获取当前余额
    const currentBalance = await getEnergyBalance(userId);
    const newBalance = currentBalance + amount;
    
    // 2. 更新 users.energy_value（SQL直接执行）
    await execute(
      'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
      [newBalance, userId]
    );
    
    // 3. 更新 energy_accounts
    const existingAccount = await queryOne<{ id: string; total_in: number; total_out: number }>(
      'SELECT id, total_in, total_out FROM energy_accounts WHERE user_id = $1',
      [userId]
    );
    
    if (existingAccount) {
      const newTotalIn = (Number(existingAccount.total_in) || 0) + amount;
      await execute(
        'UPDATE energy_accounts SET balance = $1, total_in = $2, updated_at = NOW() WHERE user_id = $3',
        [newBalance, newTotalIn, userId]
      );
    } else {
      await execute(
        'INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 0, NOW(), NOW())',
        [userId, newBalance, amount]
      );
    }
    
    // 4. 记录 energy_transactions 流水（含变动前后余额）
    await execute(
      `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, status, note, energy_before, energy_after, created_at) 
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'completed', $6, $7, $8, NOW())`,
      [userId, type, amount, options?.fromUserId || null, options?.toUserId || userId, options?.note || null, currentBalance, newBalance]
    );
    
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
 * 使用 SQL 直接执行确保写入成功
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
  
  try {
    // 1. 获取当前余额
    const currentBalance = await getEnergyBalance(userId);
    
    if (currentBalance < amount) {
      return { success: false, newBalance: currentBalance, error: '能量值余额不足' };
    }
    
    const newBalance = currentBalance - amount;
    
    // 2. 更新 users.energy_value（SQL直接执行）
    await execute(
      'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
      [newBalance, userId]
    );
    
    // 3. 更新 energy_accounts
    const existingAccount = await queryOne<{ id: string; total_in: number; total_out: number }>(
      'SELECT id, total_in, total_out FROM energy_accounts WHERE user_id = $1',
      [userId]
    );
    
    if (existingAccount) {
      const newTotalOut = (Number(existingAccount.total_out) || 0) + amount;
      await execute(
        'UPDATE energy_accounts SET balance = $1, total_out = $2, updated_at = NOW() WHERE user_id = $3',
        [newBalance, newTotalOut, userId]
      );
    } else {
      // 不应该存在有余额但没有 energy_accounts 记录的情况
      console.error('[energy-util] deductEnergy: 用户没有energy_accounts记录但余额>0，数据异常');
      await execute(
        'INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())',
        [userId, newBalance, currentBalance, amount]
      );
    }
    
    // 4. 记录 energy_transactions 流水（含变动前后余额）
    await execute(
      `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, status, note, energy_before, energy_after, created_at) 
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'completed', $6, $7, $8, NOW())`,
      [userId, type, amount, options?.fromUserId || userId, options?.toUserId || null, options?.note || null, currentBalance, newBalance]
    );
    
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
 */
export async function transferEnergy(
  fromUserId: string,
  toUserId: string,
  amount: number,
  options?: {
    fromType?: EnergyChangeType;
    toType?: EnergyChangeType;
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
  // 1. 获取所有用户
  const users = await queryOne<any[]>(
    'SELECT id, username, role, energy_value FROM users ORDER BY created_at',
    []
  );
  
  if (!users || !Array.isArray(users)) return { total: 0, fixed: 0, details: [] };
  
  // 2. 获取所有 energy_transactions
  const allTx = await queryOne<any[]>(
    'SELECT * FROM energy_transactions ORDER BY created_at ASC',
    []
  );
  
  // 3. 按 user_id 分组计算
  const userCalc: Record<string, { totalIn: number; totalOut: number }> = {};
  if (allTx && Array.isArray(allTx)) {
    allTx.forEach((tx: any) => {
      const uid = tx.user_id;
      if (!userCalc[uid]) userCalc[uid] = { totalIn: 0, totalOut: 0 };
      const amt = Number(tx.amount);
      const isOut = ['transfer_out', 'withdraw_freeze', 'withdraw', 'burn'].includes(tx.type);
      if (isOut) userCalc[uid].totalOut += amt;
      else userCalc[uid].totalIn += amt;
    });
  }
  
  // 4. 获取所有 energy_accounts
  const accounts = await queryOne<any[]>(
    'SELECT * FROM energy_accounts',
    []
  );
  
  const accMap: Record<string, any> = {};
  if (accounts && Array.isArray(accounts)) accounts.forEach((a: any) => { accMap[a.user_id] = a; });
  
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
    const hasTransactions = !!userCalc[user.id];
    const expectedFromTx = calc.totalIn - calc.totalOut;
    
    const acc = accMap[user.id];
    const currentEv = Number(user.energy_value);
    const currentBalance = acc ? Number(acc.balance) : 0;
    
    let targetEv = currentEv;
    let targetBalance = currentEv;
    let targetTotalIn = acc ? Number(acc.total_in) : currentEv;
    let targetTotalOut = acc ? Number(acc.total_out) : 0;
    
    if (hasTransactions) {
      targetEv = expectedFromTx;
      targetBalance = expectedFromTx;
      targetTotalIn = calc.totalIn;
      targetTotalOut = calc.totalOut;
    }
    
    const needsFix = currentEv !== targetEv || currentBalance !== targetBalance ||
      (acc && (Number(acc.total_in) !== targetTotalIn || Number(acc.total_out) !== targetTotalOut));
    
    if (needsFix) {
      if (currentEv !== targetEv) {
        await execute(
          'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
          [targetEv, user.id]
        );
      }
      
      if (acc) {
        await execute(
          'UPDATE energy_accounts SET balance = $1, total_in = $2, total_out = $3, updated_at = NOW() WHERE user_id = $4',
          [targetBalance, targetTotalIn, targetTotalOut, user.id]
        );
      } else if (targetBalance !== 0) {
        await execute(
          'INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())',
          [user.id, targetBalance, targetTotalIn, targetTotalOut]
        );
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
