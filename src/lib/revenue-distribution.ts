/**
 * 收益分配工具函数
 * 
 * 分配比例（基于产品市场费率 market_rate）：
 * - 会员实际到手: profit_rate%（从 total_rate 中扣除 market_rate 后剩余）
 * - 服务商: market_rate * 40%（保底2%对应3天产品5%*40%=2%）
 * - 上级服务商: market_rate * 6%
 * - 直推奖励: market_rate * 6%
 * - 高级服务商: market_rate * 3%（培养≥3个直推服务商，无则归智算总台）
 * - 服务网点: market_rate * 3%
 * - 智算总台: market_rate * 2%
 */

import { queryOne, execute } from '@/storage/database/pg-client';

// 分配比例（占 market_rate 的百分比）
const DISTRIBUTION_RATIOS = {
  provider: 0.40,        // 服务商 40%
  parentProvider: 0.06,  // 上级服务商 6%
  inviter: 0.06,         // 直推奖励 6%
  seniorProvider: 0.03,  // 高级服务商 3%
  branch: 0.03,          // 服务网点 3%
  company: 0.02,         // 智算总台 2%
} as const;

// 验证比例总和 = 60%（剩余40%是会员的 profit_rate）
// 40% + 6% + 6% + 3% + 3% + 2% = 60% ✓

interface DistributionResult {
  memberProfit: number;       // 会员实际到手
  providerShare: number;      // 服务商分成
  parentProviderShare: number; // 上级服务商分成
  inviterShare: number;       // 直推奖励
  seniorProviderShare: number; // 高级服务商分成
  branchShare: number;        // 服务网点分成
  companyShare: number;       // 智算总台分成
  providerId: string;         // 服务商ID
  parentProviderId: string | null;  // 上级服务商ID
  inviterId: string | null;   // 直推人ID
  seniorProviderId: string | null;  // 高级服务商ID
  branchId: string | null;    // 服务网点ID
  adminId: string;            // 智算总台ID
}

/**
 * 计算收益分配
 */
export function calculateDistribution(
  productPrice: number,
  totalRate: number,    // 总收益率（如 5 表示 5%）
  marketRate: number,   // 市场费率（如 5 表示 5%）
): Omit<DistributionResult, 'providerId' | 'parentProviderId' | 'inviterId' | 'seniorProviderId' | 'branchId' | 'adminId'> {
  const totalAmount = productPrice * totalRate / 100;    // 总收益金额
  const marketFee = productPrice * marketRate / 100;     // 市场费金额
  const memberProfit = totalAmount - marketFee;          // 会员实际到手 = 总收益 - 市场费

  return {
    memberProfit: Math.round(memberProfit * 100) / 100,
    providerShare: Math.round(marketFee * DISTRIBUTION_RATIOS.provider * 100) / 100,
    parentProviderShare: Math.round(marketFee * DISTRIBUTION_RATIOS.parentProvider * 100) / 100,
    inviterShare: Math.round(marketFee * DISTRIBUTION_RATIOS.inviter * 100) / 100,
    seniorProviderShare: Math.round(marketFee * DISTRIBUTION_RATIOS.seniorProvider * 100) / 100,
    branchShare: Math.round(marketFee * DISTRIBUTION_RATIOS.branch * 100) / 100,
    companyShare: Math.round(marketFee * DISTRIBUTION_RATIOS.company * 100) / 100,
  };
}

/**
 * 执行收益分配（写入各角色 balance）
 * @returns 完整的分配结果
 */
export async function distributeRevenue(params: {
  userId: string;         // 购买/持有的会员ID
  productId: string;      // 产品ID
  productPrice: number;   // 产品价格
  totalRate: number;      // 总收益率
  marketRate: number;     // 市场费率
  orderId?: string;       // 关联订单ID
  distributionType: string; // 分配类型：buy/sell/transfer
}): Promise<DistributionResult> {
  const { userId, productId, productPrice, totalRate, marketRate, orderId, distributionType } = params;

  // 计算各角色分配金额
  const amounts = calculateDistribution(productPrice, totalRate, marketRate);

  // 查询服务商信息
  const user = await queryOne(
    `SELECT u.id, u.provider_id, u.inviter_id, u.branch_id, p.user_id as provider_user_id, p.parent_provider_id
     FROM users u
     LEFT JOIN providers p ON u.provider_id = p.id
     WHERE u.id = $1`,
    [userId]
  );

  if (!user) throw new Error('用户不存在');

  const providerId = user.provider_id || '';
  const inviterId = user.inviter_id || null;
  const branchId = user.branch_id || null;
  const parentProviderId = user.parent_provider_id || null;

  // 查找上级服务商的user_id
  let parentProviderUserId: string | null = null;
  if (parentProviderId) {
    const parentProvider = await queryOne(
      `SELECT user_id FROM providers WHERE id = $1`,
      [parentProviderId]
    );
    parentProviderUserId = parentProvider?.user_id || null;
  }

  // 查找最近的上级高级服务商
  let seniorProviderUserId: string | null = null;
  if (providerId) {
    seniorProviderUserId = await findSeniorProvider(providerId);
  }

  // 智算总台ID（固定为admin角色的用户）
  const admin = await queryOne(
    `SELECT id FROM users WHERE role = 'admin' LIMIT 1`,
    []
  );
  const adminId = admin?.id || '00000000-0000-0000-0000-000000000001';

  // 开始分配
  const distributionResults: { role: string; userId: string; amount: number }[] = [];

  // 1. 会员收益
  distributionResults.push({ role: 'member', userId, amount: amounts.memberProfit });

  // 2. 服务商收益
  if (providerId) {
    const providerUser = await queryOne(
      `SELECT user_id FROM providers WHERE id = $1`,
      [providerId]
    );
    if (providerUser) {
      distributionResults.push({ role: 'provider', userId: providerUser.user_id, amount: amounts.providerShare });
    }
  }

  // 3. 上级服务商收益
  if (parentProviderUserId && amounts.parentProviderShare > 0) {
    distributionResults.push({ role: 'parent_provider', userId: parentProviderUserId, amount: amounts.parentProviderShare });
  } else if (amounts.parentProviderShare > 0) {
    // 无上级服务商，归智算总台
    distributionResults.push({ role: 'company', userId: adminId, amount: amounts.parentProviderShare });
  }

  // 4. 直推奖励
  if (inviterId && amounts.inviterShare > 0) {
    distributionResults.push({ role: 'inviter', userId: inviterId, amount: amounts.inviterShare });
  } else if (amounts.inviterShare > 0) {
    // 无直推人，归智算总台
    distributionResults.push({ role: 'company', userId: adminId, amount: amounts.inviterShare });
  }

  // 5. 高级服务商收益
  if (seniorProviderUserId && amounts.seniorProviderShare > 0) {
    distributionResults.push({ role: 'senior_provider', userId: seniorProviderUserId, amount: amounts.seniorProviderShare });
  } else if (amounts.seniorProviderShare > 0) {
    // 无高级服务商，归智算总台
    distributionResults.push({ role: 'company', userId: adminId, amount: amounts.seniorProviderShare });
  }

  // 6. 服务网点收益
  if (branchId && amounts.branchShare > 0) {
    distributionResults.push({ role: 'branch', userId: branchId, amount: amounts.branchShare });
  } else if (amounts.branchShare > 0) {
    distributionResults.push({ role: 'company', userId: adminId, amount: amounts.branchShare });
  }

  // 7. 智算总台收益（基础 + 归属部分）
  const companyTotal = distributionResults
    .filter(r => r.role === 'company')
    .reduce((sum, r) => sum + r.amount, 0) + amounts.companyShare;
  
  // 移除临时的company记录，统一添加
  const finalResults = distributionResults.filter(r => r.role !== 'company');
  finalResults.push({ role: 'company', userId: adminId, amount: companyTotal });

  // 执行余额更新
  for (const result of finalResults) {
    if (result.amount > 0) {
      await execute(
        `UPDATE users SET balance = COALESCE(balance, 0) + $1 WHERE id = $2`,
        [result.amount, result.userId]
      );
    }
  }

  // 写入分配记录
  await execute(
    `INSERT INTO provider_revenue_distribution (
      user_id, product_id, provider_id, order_id,
      total_amount, market_fee, member_profit,
      provider_share, provider_user_id,
      parent_provider_share, parent_provider_id,
      inviter_share, inviter_id,
      senior_provider_share, senior_provider_id,
      branch_share, branch_id,
      company_share, distribution_type
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    [
      userId, productId, providerId, orderId || null,
      productPrice * totalRate / 100, productPrice * marketRate / 100, amounts.memberProfit,
      amounts.providerShare, providerId ? (await queryOne(`SELECT user_id FROM providers WHERE id = $1`, [providerId]))?.user_id : null,
      amounts.parentProviderShare, parentProviderId,
      amounts.inviterShare, inviterId,
      amounts.seniorProviderShare, seniorProviderUserId,
      amounts.branchShare, branchId,
      companyTotal, distributionType
    ]
  );

  return {
    ...amounts,
    providerId,
    parentProviderId,
    inviterId,
    seniorProviderId: seniorProviderUserId,
    branchId,
    adminId,
  };
}

/**
 * 查找最近的高级服务商（从当前服务商往上逐级查找）
 * 高级服务商：培养≥3个直推服务商的服务商
 */
export async function findSeniorProvider(providerId: string): Promise<string | null> {
  // 逐级往上查找
  let currentProviderId: string | null = providerId;
  const visited = new Set<string>();

  while (currentProviderId && !visited.has(currentProviderId)) {
    visited.add(currentProviderId);

    const provider: { id: string; user_id: string; parent_provider_id: string | null; is_senior: boolean } | null = await queryOne(
      `SELECT id, user_id, parent_provider_id, is_senior FROM providers WHERE id = $1`,
      [currentProviderId]
    );

    if (!provider) break;

    // 如果当前服务商就是高级服务商，返回其 user_id
    if (provider.is_senior) {
      return provider.user_id;
    }

    // 继续往上找
    currentProviderId = provider.parent_provider_id;
  }

  return null;
}

/**
 * 检查并更新高级服务商状态
 * 培养≥3个直推服务商即升级为高级服务商
 */
export async function checkAndUpdateSeniorStatus(providerId: string): Promise<boolean> {
  // 查询该服务商培养了多少个直推服务商
  const result = await queryOne(
    `SELECT COUNT(*) as count FROM providers WHERE parent_provider_id = $1`,
    [providerId]
  );

  const directProviderCount = parseInt(result?.count || '0', 10);

  if (directProviderCount >= 3) {
    await execute(
      `UPDATE providers SET is_senior = true WHERE id = $1 AND is_senior = false`,
      [providerId]
    );
    return true;
  }

  return false;
}

/**
 * 批量检查并更新所有服务商的高级状态
 */
export async function updateAllSeniorStatus(): Promise<number> {
  // 找出所有培养≥3个直推服务商但还不是高级的服务商
  const result = await queryOne(
    `SELECT COUNT(*) as count FROM providers p
     WHERE p.is_senior = false
     AND (SELECT COUNT(*) FROM providers WHERE parent_provider_id = p.id) >= 3`,
    []
  );

  await execute(
    `UPDATE providers SET is_senior = true
     WHERE is_senior = false
     AND (SELECT COUNT(*) FROM providers WHERE parent_provider_id = providers.id) >= 3`,
    []
  );

  return parseInt(result?.count || '0', 10);
}
