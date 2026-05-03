import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/lib/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { randomUUID } from 'crypto';

// 允许更新的字段白名单
const ALLOWED_ORDER_STATUS = new Set(['pending', 'paid', 'completed', 'cancelled', 'awaiting_payment']);

// 能量值分配比例（总计100%）
const REVENUE_SHARE_RATIOS = {
  provider: 0.70,      // 服务商 70%
  directReward: 0.10,   // 直推奖励 10%
  parentProvider: 0.10, // 上级服务商 10%
  branch: 0.05,        // 分公司 5%
  company: 0.05,        // 公司运营 5%
};

// 下级分成比例（基于交易额）
const SUBORDINATE_SPLIT_RATIOS = {
  oneProvider: 0.003,  // 培养1个服务商：下级交易额 0.3%
  threePlusProviders: 0.005, // 培养≥3个服务商：所有下级交易额 0.5%
};

// 获取用户能量值账户余额
async function getEnergyBalance(userId: string): Promise<number> {
  const account = await queryOne(
    'SELECT balance FROM energy_accounts WHERE user_id = $1',
    [userId]
  );
  return account ? Number(account.balance) || 0 : 0;
}

// 更新用户能量值账户（同时同步 users.energy_value）
async function updateEnergyBalance(userId: string, newBalance: number, amount: number) {
  const isIncrease = amount > 0;
  await query(
    `INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE SET 
       balance = $3,
       total_in = energy_accounts.total_in + $4,
       total_out = energy_accounts.total_out + $5,
       updated_at = NOW()`,
    [randomUUID(), userId, newBalance, isIncrease ? Math.abs(amount) : 0, isIncrease ? 0 : Math.abs(amount)]
  );
  // 同步更新 users.energy_value
  await query(
    'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
    [newBalance, userId]
  );
}

// 记录能量值交易（同时写入 energy_transactions + 更新 energy_accounts + 同步 users.energy_value）
async function recordEnergyTransaction(
  userId: string,
  orderId: string,
  type: string,
  amount: number,
  description: string
) {
  const balanceBefore = await getEnergyBalance(userId);
  const balanceAfter = balanceBefore + amount;
  
  // 写入 energy_transactions 能量值流水表
  await query(
    `INSERT INTO energy_transactions (user_id, type, amount, from_user_id, to_user_id, note, status, created_at)
     VALUES ($1, $2, $3, $1, $1, $4, 'completed', NOW())`,
    [userId, type, amount, description]
  );
  
  // 更新 energy_accounts 并同步 users.energy_value
  await updateEnergyBalance(userId, balanceAfter, amount);
}

// 记录服务商收益分配
async function recordProviderRevenueDistribution(
  orderId: string,
  providerId: string,
  memberId: string,
  productId: string,
  marketFee: number,
  providerShare: number,
  directReward: number,
  directRewardTo: string | null,
  parentProviderShare: number,
  parentProviderId: string | null,
  branchShare: number,
  branchId: string | null,
  companyShare: number
) {
  await query(
    `INSERT INTO provider_revenue_distribution 
     (id, order_id, provider_id, member_id, product_id, market_fee, provider_share, direct_reward, direct_reward_to, parent_provider_share, parent_provider_id, branch_share, branch_id, company_share, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'completed', NOW())`,
    [
      randomUUID(), orderId, providerId, memberId, productId,
      marketFee, providerShare, directReward, directRewardTo,
      parentProviderShare, parentProviderId, branchShare, branchId,
      companyShare
    ]
  );
}

// 计算下级分成
async function calculateSubordinateSplit(
  providerId: string,
  productPrice: number,
  productName: string
): Promise<{ splitAmount: number; splitRatio: number; subordinateCount: number }> {
  // 查询该服务商有多少个下级服务商
  const subProviders: any[] = await query(
    'SELECT COUNT(*) as count FROM providers WHERE parent_provider_id = $1',
    [providerId]
  );
  const subordinateCount = parseInt(subProviders?.[0]?.count || '0');
  
  let splitRatio = 0;
  let splitAmount = 0;
  
  if (subordinateCount >= 3) {
    // 培养≥3个服务商：所有下级交易额 0.5%
    splitRatio = SUBORDINATE_SPLIT_RATIOS.threePlusProviders;
    splitAmount = Math.floor(productPrice * splitRatio);
  } else if (subordinateCount >= 1) {
    // 培养1个服务商：下级交易额 0.3%
    splitRatio = SUBORDINATE_SPLIT_RATIOS.oneProvider;
    splitAmount = Math.floor(productPrice * splitRatio);
  }
  
  return { splitAmount, splitRatio, subordinateCount };
}

// 记录下级分成收益
async function recordSubordinateSplit(
  orderId: string,
  providerId: string,
  upperProviderId: string,
  upperProviderUserId: string,
  productName: string,
  splitAmount: number,
  splitRatio: number,
  subordinateCount: number
) {
  if (splitAmount <= 0) return;
  
  // 发放能量值给上级服务商
  await recordEnergyTransaction(
    upperProviderUserId,
    orderId,
    'subordinate_split',
    splitAmount,
    `下级服务商(${subordinateCount}个)会员购买 ${productName} 交易额分成 (${(splitRatio * 100).toFixed(1)}%)`
  );
  
  // 记录到服务商收益分配表
  await query(
    `INSERT INTO provider_subordinate_split 
     (id, order_id, provider_id, upper_provider_id, product_name, order_amount, split_ratio, split_amount, subordinate_count, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
    [randomUUID(), orderId, providerId, upperProviderId, productName, splitAmount / splitRatio, splitRatio, splitAmount, subordinateCount]
  );
}

export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅管理员和服务商可审核
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { orderId, reviewerId, action, note } = body;

    if (!orderId || !reviewerId || !action) {
      return NextResponse.json({ success: false, error: '缺少必要参数' }, { status: 400 });
    }

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ success: false, error: '无效的审核动作' }, { status: 400 });
    }

    // 获取订单信息
    const order = await queryOne(
      'SELECT * FROM orders WHERE id = $1',
      [orderId]
    );

    if (!order) {
      return NextResponse.json({ success: false, error: '订单不存在' }, { status: 404 });
    }

    if (order.status !== 'pending') {
      return NextResponse.json({ success: false, error: '订单状态不是待审核' }, { status: 400 });
    }

    // 审核人必须是服务商或管理员
    const reviewer: any = await queryOne(
      'SELECT id, username, role, provider_id, branch_id FROM users WHERE id = $1',
      [reviewerId]
    );

    if (!reviewer || !authorizeRole({ ...reviewer, userId: reviewer.id, username: reviewer.username || '' }, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作此订单' }, { status: 403 });
    }

    if (action === 'reject') {
      // 拒绝订单
      await query(
        `UPDATE orders SET status = 'cancelled', reviewed_by = $1, reviewed_at = NOW(), review_note = $2 WHERE id = $3`,
        [reviewerId, note || '审核拒绝', orderId]
      );

      // 恢复用户产品状态
      if (order.user_product_id) {
        await query(
          "UPDATE user_products SET status = 'holding' WHERE id = $1",
          [order.user_product_id]
        );
      }

      return NextResponse.json({ success: true, message: '订单已拒绝' });
    }

    // 批准订单 - 根据订单类型处理
    if (order.order_type === 'buy') {
      // 购买订单审核通过
      // 1. 获取产品信息计算市场费
      const product: any = await queryOne(
        'SELECT * FROM products WHERE id = $1',
        [order.product_id]
      );

      // 计算市场费 = 价格 × market_rate / 100
      const marketRate = Number(product?.market_rate) || (product?.period === 3 ? 3 : 5);
      const marketFee = Math.floor(Number(product?.price) * marketRate / 100);

      // 2. 获取会员信息（用于查找邀请人、上级服务商等）
      const member: any = await queryOne(
        'SELECT * FROM users WHERE id = $1',
        [order.user_id]
      );

      // 3. 获取服务商信息
      const providerRecord: any = await queryOne(
        'SELECT * FROM providers WHERE id = $1',
        [product?.provider_id]
      );

      // 4. 查找直推奖励接收者（会员的邀请人）
      // 重要：如果邀请人就是当前服务商自己，直推奖励直接加到服务商收益（不重复分配）
      let directRewardTo: string | null = null;
      let directRewardAmount = 0;
      if (member?.inviter_id) {
        // 如果邀请人不是当前服务商，才需要单独分配直推奖励
        if (member.inviter_id !== providerRecord?.user_id) {
          directRewardTo = member.inviter_id;
          directRewardAmount = Math.floor(marketFee * REVENUE_SHARE_RATIOS.directReward);
        }
        // 如果邀请人就是服务商，直推奖励会合并到服务商收益中
      }

      // 5. 查找上级服务商（服务商的父级服务商）
      let parentProviderId: string | null = null;
      if (providerRecord?.parent_provider_id) {
        parentProviderId = providerRecord.parent_provider_id;
      }

      // 6. 获取分公司ID
      const branchId = providerRecord?.branch_id || member?.branch_id;

      // 7. 扣除会员能量值（市场费）
      const memberBalanceBefore = await getEnergyBalance(order.user_id);
      const memberBalanceAfter = memberBalanceBefore - marketFee;

      if (memberBalanceAfter < 0) {
        return NextResponse.json({
          success: false,
          error: `会员能量值不足，需要 ${marketFee} 能量值，当前余额 ${memberBalanceBefore}`
        }, { status: 400 });
      }

      // 记录会员能量值扣除
      await recordEnergyTransaction(
        order.user_id,
        orderId,
        'market_fee',
        -marketFee,
        `购买产品 ${product?.name || '产品'} 支付市场费`
      );

      // 8. 按比例分配能量值给各方
      // 基础分配
      const baseProviderShare = Math.floor(marketFee * REVENUE_SHARE_RATIOS.provider);
      const providerShare = baseProviderShare + directRewardAmount; // 服务商收益 + 直推奖励（如果邀请人就是服务商）
      const parentProviderShare = Math.floor(marketFee * REVENUE_SHARE_RATIOS.parentProvider);
      const branchBaseShare = Math.floor(marketFee * REVENUE_SHARE_RATIOS.branch);
      // 如果没有上级服务商，上级那份10%给分公司
      const branchShare = parentProviderId ? branchBaseShare : branchBaseShare + parentProviderShare;
      const companyShare = Math.floor(marketFee * REVENUE_SHARE_RATIOS.company);

      // 8.1 给服务商增加能量值 (70% + 直推奖励如果邀请人就是服务商)
      if (providerRecord?.user_id) {
        await recordEnergyTransaction(
          providerRecord.user_id,
          orderId,
          'provider_share',
          providerShare,
          directRewardAmount > 0 
            ? `会员购买产品收益分成 (70%) + 直推奖励 (10%)`
            : `会员购买产品收益分成 (70%)`
        );
      }

      // 8.2 给直推奖励 (10%) - 仅当邀请人不是当前服务商时才单独分配
      if (directRewardTo && directRewardAmount > 0) {
        await recordEnergyTransaction(
          directRewardTo,
          orderId,
          'direct_reward',
          directRewardAmount,
          `直推会员购买产品奖励 (10%)`
        );
      }

      // 8.3 给上级服务商 (10%) - 仅当有上级服务商时才分配
      if (parentProviderId) {
        const parentProvider: any = await queryOne(
          'SELECT user_id FROM providers WHERE id = $1',
          [parentProviderId]
        );
        if (parentProvider?.user_id) {
          await recordEnergyTransaction(
            parentProvider.user_id,
            orderId,
            'parent_provider_share',
            parentProviderShare,
            `下级服务商会员购买产品分成 (10%)`
          );
        }
      }

      // 8.4 给分公司 (5% + 上级服务商10%如果没有上级)
      if (branchId) {
        const branchUser: any = await queryOne(
          'SELECT id FROM users WHERE id = $1 AND role = $2',
          [branchId, 'branch']
        );
        if (branchUser) {
          const branchDescription = parentProviderId 
            ? `服务商会员购买产品分成 (5%)` 
            : `服务商会员购买产品分成 (5%) + 上级服务商分成 (10%)`;
          await recordEnergyTransaction(
            branchUser.id,
            orderId,
            'branch_share',
            branchShare,
            branchDescription
          );
        }
      }

      // 8.5 给公司运营 (5%) - 找admin账户
      const adminUser: any = await queryOne(
        "SELECT id FROM users WHERE role = 'admin' LIMIT 1",
        []
      );
      if (adminUser) {
        await recordEnergyTransaction(
          adminUser.id,
          orderId,
          'company_share',
          companyShare,
          `公司运营收益 (5%)`
        );
      }

      // 8.6 记录现金收益：分公司市场费分润 + 总公司运营费
      if (branchId) {
        let branchRevenueTotal = 0;
        // 分公司5%市场费分润 → 现金收益记录
        await execute(
          `INSERT INTO branch_revenue_records (branch_id, type, amount, related_user_id, related_order_id, note, status, created_at)
           VALUES ($1, 'market_fee_share', $2, $3, $4, $5, 'received', NOW())`,
          [branchId, branchBaseShare, order.user_id, orderId, `市场费5%分润 (订单: ${orderId})`]
        );
        branchRevenueTotal += branchBaseShare;
        // 如果没有上级服务商，10%也归分公司 → 额外现金收益记录
        if (!parentProviderId) {
          await execute(
            `INSERT INTO branch_revenue_records (branch_id, type, amount, related_user_id, related_order_id, note, status, created_at)
             VALUES ($1, 'provider_upstream', $2, $3, $4, $5, 'received', NOW())`,
            [branchId, parentProviderShare, order.user_id, orderId, `一级服务商上级收益10% (订单: ${orderId})`]
          );
          branchRevenueTotal += parentProviderShare;
        }
        // 增加分公司余额
        if (branchRevenueTotal > 0) {
          const branchBalRes = await query(
            'SELECT balance FROM users WHERE id = $1',
            [branchId]
          );
          if (branchBalRes && branchBalRes.length > 0) {
            const curBal = parseFloat(branchBalRes[0].balance) || 0;
            const newBal = curBal + branchRevenueTotal;
            await execute(
              'UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2',
              [newBal.toFixed(2), branchId]
            );
          }
        }
      }
      // 总公司运营5% → 手续费沉淀记录
      if (companyShare > 0) {
        await execute(
          `INSERT INTO company_fee_records (type, amount, source_user_id, source_role, source_order_id, note, created_at)
           VALUES ('market_fee_ops', $1, $2, 'member', $3, $4, NOW())`,
          [companyShare, order.user_id, orderId, `公司运营收益5% (订单: ${orderId})`]
        );
      }

      // 8.7 记录服务商收益分配
      await recordProviderRevenueDistribution(
        orderId,
        product?.provider_id,
        order.user_id,
        order.product_id,
        marketFee,
        providerShare,
        directRewardAmount,
        directRewardTo,
        parentProviderShare,
        parentProviderId,
        branchShare,
        branchId,
        companyShare
      );

      // 8.8 计算并发放下级分成
      // 查询当前服务商有多少下级服务商，用于计算上级服务商的分层收益
      const subordinateSplit = await calculateSubordinateSplit(
        product?.provider_id,
        Number(product?.price),
        product?.name || '产品'
      );
      
      // 如果有上级服务商且有下级分成
      if (parentProviderId && subordinateSplit.splitAmount > 0) {
        const parentProvider: any = await queryOne(
          'SELECT user_id FROM providers WHERE id = $1',
          [parentProviderId]
        );
        if (parentProvider?.user_id) {
          await recordSubordinateSplit(
            orderId,
            product?.provider_id,
            parentProviderId,
            parentProvider.user_id,
            product?.name || '产品',
            subordinateSplit.splitAmount,
            subordinateSplit.splitRatio,
            subordinateSplit.subordinateCount
          );
        }
      }

      // 9. 更新订单状态为已完成
      await query(
        `UPDATE orders SET status = 'completed', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`,
        [reviewerId, orderId]
      );

      // 10. 更新产品状态为已售出
      await query(
        `UPDATE products SET status = 'sold' WHERE id = $1`,
        [order.product_id]
      );

      return NextResponse.json({
        success: true,
        message: '审核通过，能量值已分配',
        data: {
          marketFee,
          distribution: {
            provider: providerShare,
            directReward: directRewardAmount,
            parentProvider: parentProviderShare,
            branch: branchShare,
            company: companyShare,
          }
        }
      });

    } else if (order.order_type === 'sell') {
      // 卖出订单：转为待付款
      await query(
        `UPDATE orders SET status = 'awaiting_payment', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`,
        [reviewerId, orderId]
      );

      return NextResponse.json({ success: true, message: '审核通过，等待线下付款' });
    }

    return NextResponse.json({ success: true, message: '订单审核完成' });
  } catch (error) {
    console.error('审核订单失败:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
