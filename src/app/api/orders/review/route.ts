import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/lib/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { addEnergy, deductEnergy, transferEnergy } from '@/lib/energy-util';
import { randomUUID } from 'crypto';

// 能量值分配比例（总计100%）
const REVENUE_SHARE_RATIOS = {
  provider: 0.70,
  directReward: 0.10,
  parentProvider: 0.10,
  branch: 0.05,
  company: 0.05,
};

const SUBORDINATE_SPLIT_RATIOS = {
  oneProvider: 0.003,
  threePlusProviders: 0.005,
};

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
  branchShare: number,
  branchId: string | null,
  companyShare: number
) {
  await query(
    `INSERT INTO provider_revenue_distribution 
     (id, order_id, provider_id, member_id, product_id, product_price, market_fee, provider_share, direct_reward, direct_reward_to, parent_provider_share, parent_provider_id, branch_share, branch_id, company_share, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'completed', NOW())`,
    [
      randomUUID(), orderId, providerId, memberId, productId, productPrice,
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
  let subordinateCount = 0;
  
  try {
    const subProviders: any[] = await query(
      'SELECT COUNT(*) as count FROM providers WHERE parent_provider_id = $1',
      [providerId]
    );
    subordinateCount = parseInt(subProviders?.[0]?.count || '0');
  } catch {
    try {
      let providerUserId = providerId;
      const providerById: any = await queryOne(
        'SELECT user_id FROM providers WHERE id = $1',
        [providerId]
      );
      if (providerById?.user_id) {
        providerUserId = providerById.user_id;
      } else {
        const providerByUserId: any = await queryOne(
          'SELECT user_id FROM providers WHERE user_id = $1',
          [providerId]
        );
        if (providerByUserId?.user_id) {
          providerUserId = providerByUserId.user_id;
        }
      }
      if (providerUserId) {
        const subUsers: any[] = await query(
          "SELECT COUNT(*) as count FROM users WHERE role = 'provider' AND provider_id = $1",
          [providerUserId]
        );
        subordinateCount = parseInt(subUsers?.[0]?.count || '0');
      }
    } catch (e2) {
      console.error('计算下级分成失败:', e2);
      subordinateCount = 0;
    }
  }
  
  let splitRatio = 0;
  let splitAmount = 0;
  
  if (subordinateCount >= 3) {
    splitRatio = SUBORDINATE_SPLIT_RATIOS.threePlusProviders;
    splitAmount = Math.floor(productPrice * splitRatio);
  } else if (subordinateCount >= 1) {
    splitRatio = SUBORDINATE_SPLIT_RATIOS.oneProvider;
    splitAmount = Math.floor(productPrice * splitRatio);
  }
  
  return { splitAmount, splitRatio, subordinateCount };
}

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
  
  try {
    const result = await addEnergy(
      upperProviderUserId,
      splitAmount,
      'subordinate_split',
      { note: `下级服务商(${subordinateCount}个)会员购买 ${productName} 交易额分成 (${(splitRatio * 100).toFixed(1)}%)` }
    );
    
    if (!result.success) {
      console.error('下级分成能量值发放失败:', result.error);
    }
    
    await query(
      `INSERT INTO provider_subordinate_split 
       (id, order_id, provider_id, upper_provider_id, product_name, order_amount, split_ratio, split_amount, subordinate_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [randomUUID(), orderId, providerId, upperProviderId, productName, splitAmount / splitRatio, splitRatio, splitAmount, subordinateCount]
    );
  } catch (error) {
    console.error('记录下级分成失败:', error);
  }
}

export async function POST(request: NextRequest) {
  try {
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

    if (!reviewer || !authorizeRole({ ...reviewer, userId: reviewer.id, username: reviewer.username || '' }, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作此订单' }, { status: 403 });
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

      // 退还能量值（购买时已扣除的市场费）
      const energyCost = Number(order.energy_cost) || 0;
      if (energyCost > 0 && order.user_id) {
        await addEnergy(
          order.user_id,
          energyCost,
          'refund',
          { note: `购买被拒绝，退还市场费 ${energyCost}` }
        );
      }

      // 通知会员
      if (order.user_id) {
        await query(
          `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, sender_name, type, title, content, created_at)
           VALUES ($1, $2, 'member', $3, $4, 'order_rejected', '购买申请被拒绝', $5, NOW())`,
          [
            randomUUID(), order.user_id, reviewerId, reviewer.username || '服务商',
            `您购买的产品申请已被拒绝${note ? '，原因: ' + note : ''}，已退还 ${energyCost} 能量值`
          ]
        );
      }

      return NextResponse.json({ success: true, message: '订单已拒绝，能量值已退还' });
    }

    // ========== 批准订单 ==========
    if (order.order_type === 'buy') {
      const product: any = await queryOne(
        'SELECT * FROM products WHERE id = $1',
        [order.product_id]
      );

      // 市场费已在购买时扣除，这里直接使用订单中记录的 energy_cost
      const marketFee = Number(order.energy_cost) || 0;

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

      // 直推奖励
      let directRewardTo: string | null = null;
      let directRewardAmount = Math.floor(marketFee * REVENUE_SHARE_RATIOS.directReward);
      const inviterIsProvider = member?.inviter_id && member.inviter_id === providerRecord?.user_id;
      
      if (member?.inviter_id && !inviterIsProvider) {
        directRewardTo = member.inviter_id;
      }

      // 上级服务商
      let parentProviderId: string | null = null;
      if (providerRecord?.parent_provider_id) {
        parentProviderId = providerRecord.parent_provider_id;
      }

      // 分公司ID
      const branchId = providerRecord?.branch_id || member?.branch_id;

      // ===== 按比例分配能量值 =====
      const baseProviderShare = Math.floor(marketFee * REVENUE_SHARE_RATIOS.provider);
      const providerShare = inviterIsProvider ? baseProviderShare + directRewardAmount : baseProviderShare;
      const parentProviderShare = Math.floor(marketFee * REVENUE_SHARE_RATIOS.parentProvider);
      const branchShare = Math.floor(marketFee * REVENUE_SHARE_RATIOS.branch);
      const companyBaseShare = Math.floor(marketFee * REVENUE_SHARE_RATIOS.company);
      const companyShare = parentProviderId ? companyBaseShare : companyBaseShare + parentProviderShare;

      // 给服务商增加能量值
      if (providerRecord?.user_id) {
        await addEnergy(
          providerRecord.user_id,
          providerShare,
          'provider_share',
          { note: directRewardAmount > 0 
            ? `会员购买产品收益分成 (70%) + 直推奖励 (10%)`
            : `会员购买产品收益分成 (70%)` }
        );
      }

      // 直推奖励
      if (directRewardTo && directRewardAmount > 0) {
        await addEnergy(
          directRewardTo,
          directRewardAmount,
          'direct_reward',
          { note: `直推会员购买产品奖励 (10%)` }
        );
      }

      // 上级服务商
      if (parentProviderId) {
        const parentProvider: any = await queryOne(
          'SELECT user_id FROM providers WHERE id = $1',
          [parentProviderId]
        );
        if (parentProvider?.user_id) {
          await addEnergy(
            parentProvider.user_id,
            parentProviderShare,
            'parent_provider_share',
            { note: `下级服务商会员购买产品分成 (10%)` }
          );
        }
      }

      // 分公司
      if (branchId) {
        const branchUser: any = await queryOne(
          'SELECT id FROM users WHERE id = $1 AND role = $2',
          [branchId, 'branch']
        );
        if (branchUser) {
          await addEnergy(
            branchUser.id,
            branchShare,
            'branch_share',
            { note: `服务商会员购买产品分成 (5%)` }
          );
        }
      }

      // 公司运营
      const adminUser: any = await queryOne(
        "SELECT id FROM users WHERE role = 'admin' LIMIT 1",
        []
      );
      if (adminUser) {
        const companyEnergyNote = parentProviderId 
          ? `公司运营收益 (5%)` 
          : `公司运营收益 (5%) + 上级服务商分成 (10%)`;
        await addEnergy(
          adminUser.id,
          companyShare,
          'company_share',
          { note: companyEnergyNote }
        );
      }

      // 记录现金收益
      if (branchId) {
        let branchRevenueTotal = 0;
        await execute(
          `INSERT INTO branch_revenue_records (branch_id, type, amount, related_user_id, related_order_id, note, status, created_at)
           VALUES ($1, 'market_fee_share', $2, $3, $4, $5, 'received', NOW())`,
          [branchId, branchShare, order.user_id, orderId, `市场费5%分润 (订单: ${orderId})`]
        );
        branchRevenueTotal += branchShare;
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
      if (companyShare > 0) {
        const companyNote = parentProviderId 
          ? `公司运营收益5% (订单: ${orderId})`
          : `公司运营收益5% + 上级服务商分成10% (订单: ${orderId})`;
        await execute(
          `INSERT INTO company_fee_records (type, amount, source_user_id, source_role, source_order_id, note, created_at)
           VALUES ('market_fee_ops', $1, $2, 'member', $3, $4, NOW())`,
          [companyShare, order.user_id, orderId, companyNote]
        );
      }

      // 记录服务商收益分配
      await recordProviderRevenueDistribution(
        orderId,
        product?.provider_id,
        order.user_id,
        order.product_id,
        product?.price || order.amount,
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

      // 计算并发放下级分成
      const subordinateSplit = await calculateSubordinateSplit(
        product?.provider_id,
        Number(product?.price),
        product?.name || '产品'
      );
      
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
            directReward: inviterIsProvider ? directRewardAmount : 0,
            directRewardTo,
            parentProvider: parentProviderId ? parentProviderShare : 0,
            parentProviderToCompany: parentProviderId ? 0 : parentProviderShare,
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
