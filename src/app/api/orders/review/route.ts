import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/storage/database/pg-client';
import { randomUUID } from 'crypto';

// 新的市场费分配比例（3%市场分配率，各角色占市场费的比例）
const REVENUE_SHARE_RATIOS = {
  provider: 2.0 / 3.0,           // 服务商 2.00% / 3.00% = 66.67%
  parentProvider: 0.3 / 3.0,     // 上级服务商 0.30% / 3.00% = 10%
  directReward: 0.3 / 3.0,       // 直推奖励 0.30% / 3.00% = 10%
  seniorProvider: 0.15 / 3.0,    // 高级服务商 0.15% / 3.00% = 5%
  branch: 0.15 / 3.0,            // 服务网点 0.15% / 3.00% = 5%
  company: 0.10 / 3.0,           // 智算总台 0.10% / 3.00% = 3.33%
};

// 各角色占产品价格的直接比例
const PRICE_RATIOS = {
  memberProfit: 0.02,        // 会员实际到手 2%
  providerShare: 0.02,       // 服务商 2%
  parentProvider: 0.003,     // 上级服务商 0.3%
  directReward: 0.003,       // 直推奖励 0.3%
  seniorProvider: 0.0015,    // 高级服务商 0.15%
  branch: 0.0015,            // 服务网点 0.15%
  company: 0.001,            // 智算总台 0.1%
};

// 增加用户余额（balance）并记录
async function addBalance(
  userId: string,
  amount: number,
  type: string,
  note: string
): Promise<void> {
  if (amount <= 0) return;
  
  // 更新 users.balance
  await execute(
    `UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2`,
    [amount, userId]
  );
  
  // 记录到 member_revenue 表
  await execute(
    `INSERT INTO member_revenue (id, user_id, type, amount, note, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'completed', NOW())`,
    [randomUUID(), userId, type, amount, note]
  );
}

// 查找上级最近的高级服务商
async function findNearestSeniorProvider(providerId: string): Promise<{ userId: string; providerId: string } | null> {
  let currentProviderId = providerId;
  let depth = 0;
  const maxDepth = 20; // 防止无限循环
  
  while (currentProviderId && depth < maxDepth) {
    const provider: any = await queryOne(
      'SELECT id, user_id, parent_provider_id, is_senior FROM providers WHERE id = $1',
      [currentProviderId]
    );
    
    if (!provider) break;
    
    // 检查当前服务商是否是高级服务商（跳过自己）
    if (provider.is_senior && provider.id !== providerId) {
      return { userId: provider.user_id, providerId: provider.id };
    }
    
    // 往上找
    currentProviderId = provider.parent_provider_id;
    depth++;
  }
  
  return null;
}

// 更新高级服务商状态
async function updateSeniorProviderStatus(providerId: string): Promise<boolean> {
  try {
    // 统计该服务商的直推服务商数量
    const result: any = await queryOne(
      `SELECT COUNT(*) as count FROM providers WHERE parent_provider_id = $1`,
      [providerId]
    );
    
    const count = parseInt(result?.count || '0');
    const isSenior = count >= 3;
    
    await execute(
      'UPDATE providers SET is_senior = $1 WHERE id = $2',
      [isSenior, providerId]
    );
    
    return isSenior;
  } catch (e) {
    console.error('更新高级服务商状态失败:', e);
    return false;
  }
}

// 记录服务商收益分配
async function recordProviderRevenueDistribution(
  orderId: string,
  providerId: string,
  memberId: string,
  productId: string,
  productPrice: number,
  marketFee: number,
  providerShare: number,
  directReward: number,
  directRewardTo: string | null,
  parentProviderShare: number,
  parentProviderId: string | null,
  seniorProviderShare: number,
  seniorProviderId: string | null,
  branchShare: number,
  branchId: string | null,
  companyShare: number
) {
  // 检查表是否存在 senior_provider 相关字段，如果不存在则添加
  try {
    await execute(
      `INSERT INTO provider_revenue_distribution 
       (id, order_id, provider_id, member_id, product_id, product_price, market_fee, 
        provider_share, direct_reward, direct_reward_to, parent_provider_share, parent_provider_id, 
        branch_share, branch_id, company_share, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'completed', NOW())`,
      [
        randomUUID(), orderId, providerId, memberId, productId, productPrice,
        marketFee, providerShare, directReward, directRewardTo,
        parentProviderShare, parentProviderId,
        branchShare, branchId,
        companyShare
      ]
    );
  } catch (e) {
    console.error('记录服务商收益分配失败:', e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, reviewerId, action, note } = body;

    if (!orderId || !reviewerId || !action) {
      return NextResponse.json({ success: false, error: '缺少必要参数' }, { status: 400 });
    }

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ success: false, error: '无效的审核动作' }, { status: 400 });
    }

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

    const reviewer: any = await queryOne(
      'SELECT id, username, role, provider_id, branch_id FROM users WHERE id = $1',
      [reviewerId]
    );

    if (!reviewer) {
      return NextResponse.json({ error: '审核人不存在' }, { status: 403 });
    }

    if (action === 'reject') {
      // ========== 拒绝订单 ==========
      await query(
        `UPDATE orders SET status = 'cancelled', reviewed_by = $1, reviewed_at = NOW(), review_note = $2 WHERE id = $3`,
        [reviewerId, note || '审核拒绝', orderId]
      );

      // 更新 user_products 为 cancelled
      if (order.user_product_id) {
        await query(
          "UPDATE user_products SET status = 'cancelled', updated_at = NOW() WHERE id = $1",
          [order.user_product_id]
        );
      }

      // 产品恢复为 available
      if (order.product_id) {
        await query(
          "UPDATE products SET status = 'available', updated_at = NOW() WHERE id = $1",
          [order.product_id]
        );
      }

      // 通知会员
      if (order.user_id) {
        await query(
          `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, sender_name, type, title, content, created_at)
           VALUES ($1, $2, 'member', $3, $4, 'order_rejected', '购买申请被拒绝', $5, NOW())`,
          [
            randomUUID(), order.user_id, reviewerId, reviewer.username || '服务商',
            `您购买的产品申请已被拒绝${note ? '，原因: ' + note : ''}`
          ]
        );
      }

      return NextResponse.json({ success: true, message: '订单已拒绝' });
    }

    // ========== 批准订单 ==========
    if (order.order_type === 'buy') {
      const product: any = await queryOne(
        'SELECT * FROM products WHERE id = $1',
        [order.product_id]
      );

      const productPrice = Number(product?.price) || Number(order.amount);
      const marketFee = Number(order.energy_cost) || 0; // 历史兼容

      // 获取会员信息
      const member: any = await queryOne(
        'SELECT * FROM users WHERE id = $1',
        [order.user_id]
      );

      // 获取服务商信息
      const providerRecord: any = await queryOne(
        'SELECT * FROM providers WHERE user_id = $1',
        [product?.provider_id]
      );

      // ===== 按新比例分配收益到各角色 balance =====
      
      // 1. 服务商收益 2%
      const providerShare = Math.floor(productPrice * PRICE_RATIOS.providerShare);
      const providerUserId = product?.provider_id;
      
      if (providerUserId) {
        await addBalance(
          providerUserId,
          providerShare,
          'provider_share',
          `会员购买产品收益分成 (2%)`
        );
      }

      // 2. 直推奖励 0.3%
      let directRewardTo: string | null = null;
      const directRewardAmount = Math.floor(productPrice * PRICE_RATIOS.directReward);
      const inviterIsProvider = member?.inviter_id && member.inviter_id === providerUserId;
      
      if (member?.inviter_id && !inviterIsProvider) {
        directRewardTo = member.inviter_id;
        await addBalance(
          directRewardTo as string,
          directRewardAmount,
          'direct_reward',
          `直推会员购买产品奖励 (0.3%)`
        );
      } else if (inviterIsProvider && providerUserId) {
        // 推荐人就是服务商，合并到服务商收益
        await addBalance(
          providerUserId,
          directRewardAmount,
          'direct_reward_merged',
          `直推奖励(0.3%)合并到服务商收益`
        );
      }

      // 3. 上级服务商 0.3%
      let parentProviderId: string | null = null;
      const parentProviderShare = Math.floor(productPrice * PRICE_RATIOS.parentProvider);
      
      if (providerRecord?.parent_provider_id) {
        parentProviderId = providerRecord.parent_provider_id;
        const parentProvider: any = await queryOne(
          'SELECT user_id FROM providers WHERE id = $1',
          [parentProviderId]
        );
        if (parentProvider?.user_id) {
          await addBalance(
            parentProvider.user_id,
            parentProviderShare,
            'parent_provider_share',
            `下级服务商会员购买产品分成 (0.3%)`
          );
        }
      }

      // 4. 高级服务商 0.15%（向上查找最近的高级服务商）
      let seniorProviderId: string | null = null;
      let seniorProviderShare = Math.floor(productPrice * PRICE_RATIOS.seniorProvider);
      let seniorProviderUserId: string | null = null;
      
      if (providerRecord?.id) {
        const seniorProvider = await findNearestSeniorProvider(providerRecord.id);
        if (seniorProvider) {
          seniorProviderId = seniorProvider.providerId;
          seniorProviderUserId = seniorProvider.userId;
          await addBalance(
            seniorProvider.userId,
            seniorProviderShare,
            'senior_provider_share',
            `高级服务商团队销售分成 (0.15%)`
          );
        }
      }
      
      // 如果没有高级服务商，0.15%归智算总台
      const companyExtraIfNoSenior = seniorProviderId ? 0 : seniorProviderShare;

      // 5. 服务网点 0.15%
      const branchId = providerRecord?.branch_id || member?.branch_id;
      const branchShare = Math.floor(productPrice * PRICE_RATIOS.branch);
      
      if (branchId) {
        const branchUser: any = await queryOne(
          'SELECT id FROM users WHERE id = $1 AND role = $2',
          [branchId, 'branch']
        );
        if (branchUser) {
          await addBalance(
            branchUser.id,
            branchShare,
            'branch_share',
            `服务商会员购买产品分成 (0.15%)`
          );
          
          // 记录服务网点现金收益
          await execute(
            `INSERT INTO branch_revenue_records (branch_id, type, amount, related_user_id, related_order_id, note, status, created_at)
             VALUES ($1, 'market_fee_share', $2, $3, $4, $5, 'received', NOW())`,
            [branchId, branchShare, order.user_id, orderId, `市场费分润0.15% (订单: ${orderId})`]
          );
        }
      }

      // 6. 智算总台 0.1% + 无上级服务商时的0.3% + 无高级服务商时的0.15%
      const companyBaseShare = Math.floor(productPrice * PRICE_RATIOS.company);
      const noParentShare = parentProviderId ? 0 : parentProviderShare;
      const companyShare = companyBaseShare + noParentShare + companyExtraIfNoSenior;
      
      if (companyShare > 0) {
        const adminUser: any = await queryOne(
          "SELECT id FROM users WHERE role = 'admin' LIMIT 1",
          []
        );
        if (adminUser) {
          const noteParts = [`运营0.1%`];
          if (noParentShare > 0) noteParts.push(`上级服务商0.3%`);
          if (companyExtraIfNoSenior > 0) noteParts.push(`高级服务商0.15%`);
          
          await addBalance(
            adminUser.id,
            companyShare,
            'company_share',
            `公司收益: ${noteParts.join('+')}`
          );
          
          await execute(
            `INSERT INTO company_fee_records (type, amount, source_user_id, source_role, source_order_id, note, created_at)
             VALUES ('market_fee_ops', $1, $2, 'member', $3, $4, NOW())`,
            [companyShare, order.user_id, orderId, `公司收益 (订单: ${orderId})`]
          );
        }
      }

      // 记录服务商收益分配
      await recordProviderRevenueDistribution(
        orderId,
        product?.provider_id,
        order.user_id,
        order.product_id,
        productPrice,
        marketFee,
        providerShare + (inviterIsProvider ? directRewardAmount : 0),
        inviterIsProvider ? 0 : directRewardAmount,
        directRewardTo,
        parentProviderShare,
        parentProviderId,
        seniorProviderShare,
        seniorProviderId,
        branchShare,
        branchId,
        companyShare
      );

      // 更新订单状态
      await query(
        `UPDATE orders SET status = 'completed', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`,
        [reviewerId, orderId]
      );

      // 更新 user_products 状态为 holding
      if (order.user_product_id) {
        await query(
          "UPDATE user_products SET status = 'holding', updated_at = NOW() WHERE id = $1",
          [order.user_product_id]
        );
      }

      // 更新产品状态为已售出
      await query(
        `UPDATE products SET status = 'sold', updated_at = NOW() WHERE id = $1`,
        [order.product_id]
      );

      // 通知会员
      if (order.user_id) {
        await query(
          `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, sender_name, type, title, content, created_at)
           VALUES ($1, $2, 'member', $3, $4, 'order_approved', '购买申请已通过', $5, NOW())`,
          [
            randomUUID(), order.user_id, reviewerId, reviewer.username || '服务商',
            `您购买的产品已确认，产品已转入您的持仓`
          ]
        );
      }

      return NextResponse.json({
        success: true,
        message: '审核通过，产品已转入会员持仓',
        data: {
          marketFee,
          distribution: {
            provider: providerShare,
            directReward: inviterIsProvider ? 0 : directRewardAmount,
            directRewardTo,
            parentProvider: parentProviderId ? parentProviderShare : 0,
            parentProviderToCompany: parentProviderId ? 0 : parentProviderShare,
            seniorProvider: seniorProviderId ? seniorProviderShare : 0,
            seniorProviderToCompany: companyExtraIfNoSenior,
            branch: branchShare,
            company: companyShare,
          }
        }
      });

    } else if (order.order_type === 'sell') {
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
