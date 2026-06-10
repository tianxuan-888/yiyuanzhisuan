/**
 * 安全更新用户 energy_value / balance 的工具函数
 *
 * 核心问题：Supabase REST API 的 .update() 会静默失败
 *   - 返回 204 但不实际写入数据
 *   - .select('id, energy_value') 返回空数组但不报错
 *
 * 解决方案：全部使用 execute(SQL) 直接执行 SQL，确保数据一定写入
 */

import { execute, queryOne } from '@/lib/supabase-client';

/**
 * 安全地增加用户的 energy_value，同时写入energy_transactions流水记录
 * 使用 execute(SQL) 直接操作，避免 Supabase REST API 静默失败
 */
export async function addEnergyValue(userId: string, amount: number, description: string = '', fromUserId?: string, txType?: string): Promise<number | null> {
  try {
    // 1. 读取当前值
    const user = await queryOne<any>('SELECT energy_value FROM users WHERE id = $1', [userId]);
    if (!user) {
      console.error(`[addEnergyValue] 读取用户失败: userId=${userId}`);
      return null;
    }

    const currentVal = Number(user.energy_value) || 0;
    const newVal = currentVal + amount;

    // 2. 用 execute(SQL) 更新，COALESCE 确保处理 NULL
    await execute(
      `UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2`,
      [amount, userId]
    );

    // 3. 验证更新是否成功
    const recheck = await queryOne<any>('SELECT energy_value FROM users WHERE id = $1', [userId]);
    if (!recheck || Number(recheck.energy_value) !== newVal) {
      // 如果原子加失败，再用字面值强制设置
      console.warn(`[addEnergyValue] 原子加验证不一致，强制设置: ${currentVal} + ${amount} = ${newVal}, 实际=${recheck?.energy_value}`);
      await execute(
        `UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2`,
        [newVal, userId]
      );
    }

    // 4. 写入energy_transactions流水记录
    try {
      await execute(
        `INSERT INTO energy_transactions (user_id, type, amount, from_user_id, to_user_id, note, energy_before, energy_after, created_at)
         VALUES ($1, $2, $3, $4, $1, $5, $6, $7, NOW())`,
        [
          userId,
          txType || (fromUserId ? 'transfer_in' : 'revenue'),
          amount,
          fromUserId || null,
          description || '智算金增加',
          currentVal,
          newVal,
        ]
      );
    } catch (txErr) {
      console.error(`[addEnergyValue] 写入流水失败:`, txErr);
    }

    console.log(`[addEnergyValue] 成功: ${description}, userId=${userId}, ${currentVal} → ${newVal} (+${amount})`);
    return newVal;
  } catch (error) {
    console.error(`[addEnergyValue] 异常:`, error);
    return null;
  }
}

/**
 * 安全地扣除用户的 energy_value，同时写入energy_transactions流水记录
 * 使用 execute(SQL) 直接操作
 */
export async function deductEnergyValue(userId: string, amount: number, description: string = '', toUserId?: string): Promise<number | null> {
  try {
    const user = await queryOne<any>('SELECT energy_value FROM users WHERE id = $1', [userId]);
    if (!user) {
      console.error(`[deductEnergyValue] 读取用户失败: userId=${userId}`);
      return null;
    }

    const currentVal = Number(user.energy_value) || 0;
    if (currentVal < amount) {
      console.error(`[deductEnergyValue] 余额不足: userId=${userId}, 当前=${currentVal}, 需扣=${amount}`);
      return null;
    }

    const newVal = currentVal - amount;

    // 用 execute(SQL) 更新
    await execute(
      `UPDATE users SET energy_value = energy_value - $1, updated_at = NOW() WHERE id = $2`,
      [amount, userId]
    );

    // 验证
    const recheck = await queryOne<any>('SELECT energy_value FROM users WHERE id = $1', [userId]);
    if (!recheck || Math.abs(Number(recheck.energy_value) - newVal) > 0.01) {
      console.warn(`[deductEnergyValue] 验证不一致，强制设置: ${currentVal} - ${amount} = ${newVal}`);
      await execute(
        `UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2`,
        [newVal, userId]
      );
    }

    // 写入energy_transactions流水记录
    try {
      await execute(
        `INSERT INTO energy_transactions (user_id, type, amount, from_user_id, to_user_id, note, energy_before, energy_after, created_at)
         VALUES ($1, $2, $3, $1, $4, $5, $6, $7, NOW())`,
        [
          userId,
          toUserId ? 'transfer_out' : 'deduction',
          amount,
          toUserId || null,
          description || '智算金扣除',
          currentVal,
          newVal,
        ]
      );
    } catch (txErr) {
      console.error(`[deductEnergyValue] 写入流水失败:`, txErr);
    }

    console.log(`[deductEnergyValue] 成功: ${description}, userId=${userId}, ${currentVal} → ${newVal} (-${amount})`);
    return newVal;
  } catch (error) {
    console.error(`[deductEnergyValue] 异常:`, error);
    return null;
  }
}

/**
 * 安全地增加用户的 balance
 * 使用 execute(SQL) 直接操作
 */
export async function addBalance(userId: string, amount: number, description: string = ''): Promise<number | null> {
  try {
    const user = await queryOne<any>('SELECT balance FROM users WHERE id = $1', [userId]);
    if (!user) {
      console.error(`[addBalance] 读取用户失败: userId=${userId}`);
      return null;
    }

    const currentVal = Number(user.balance) || 0;
    const newVal = currentVal + amount;

    // 用 execute(SQL) 更新
    await execute(
      `UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2`,
      [amount, userId]
    );

    // 验证
    const recheck = await queryOne<any>('SELECT balance FROM users WHERE id = $1', [userId]);
    if (!recheck || Math.abs(Number(recheck.balance) - newVal) > 0.01) {
      console.warn(`[addBalance] 验证不一致，强制设置`);
      await execute(
        `UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2`,
        [newVal, userId]
      );
    }

    console.log(`[addBalance] 成功: ${description}, userId=${userId}, ${currentVal} → ${newVal} (+${amount})`);
    return newVal;
  } catch (error) {
    console.error(`[addBalance] 异常:`, error);
    return null;
  }
}

/**
 * 设置 user_products 记录的 revenue_released 标记
 */
export async function setRevenueReleased(userProductId: string, released: boolean): Promise<boolean> {
  try {
    await execute(
      `UPDATE user_products SET revenue_released = $1, updated_at = NOW() WHERE id = $2`,
      [released, userProductId]
    );
    return true;
  } catch (error) {
    console.error(`[setRevenueReleased] 失败: id=${userProductId}`, error);
    return false;
  }
}

/**
 * 设置 user_products 记录的状态
 */
export async function setUserProductStatus(userProductId: string, status: string, extraFields?: Record<string, unknown>): Promise<boolean> {
  try {
    const updateData: Record<string, unknown> = { status, ...extraFields };
    const setClauses = Object.entries(updateData)
      .map(([key], i) => `${key} = $${i + 1}`)
      .join(', ');
    const values = [...Object.values(updateData), userProductId];

    await execute(
      `UPDATE user_products SET ${setClauses}, updated_at = NOW() WHERE id = $${values.length}`,
      values
    );
    return true;
  } catch (error) {
    console.error(`[setUserProductStatus] 失败: id=${userProductId}`, error);
    return false;
  }
}
