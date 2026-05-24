import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/storage/database/pg-client';
import { randomUUID } from 'crypto';

// 释放收益分配比例（各角色占产品价格的百分比，合计5%）
const RELEASE_SHARE_RATIOS = {
  member: 0.02,             // 会员 2%
  directReward: 0.0025,     // 直推奖励 0.25%
  provider: 0.02,           // 服务商 2%
  parentProvider: 0.0025,   // 上级服务商 0.25%
  branch: 0.001,            // 服务网点 0.1%
  company: 0.004,           // 总台运营 0.4%
};

// 增加用户余额（balance）并记录
async function addBalance(
  userId: string,
  amount: number,
  type: string,
  note: string
): Promise<void> {
  if (amount <= 0) return;
  
  await execute(
    `UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2`,
    [amount, userId]
  );
  
  await execute(
    `INSERT INTO member_revenue (id, user_id, type, amount, note, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'completed', NOW())`,
    [randomUUID(), userId, type, amount, note]
  );
}

// 释放5%收益并记录
async function releaseAndDistribute(
  orderId: string,
  productId: string,
  productPrice: number,
  memberId: string,
  providerId: string,
  member: any,
  providerRecord: any
) {
  const releaseAmount = productPrice * 0.05;

  // 1. 会员收益 2%
  const memberShare = Math.round(productPrice * RELEASE_SHARE_RATIOS.member);
  await addBalance(memberId, memberShare, 'member_share', '购买产品释放收益 (2%)');

  // 2. 直推奖励 0.25%
  let directRewardTo: string | null = null;
  const directRewardAmount = Math.round(productPrice * RELEASE_SHARE_RATIOS.directReward);
  const inviterIsProvider = member?.inviter_id && member.inviter_id === providerId;

  if (member?.inviter_id && !inviterIsProvider) {
    directRewardTo = member.inviter_id;
    await addBalance(directRewardTo!, directRewardAmount, 'direct_reward', '直推会员购买产品奖励 (0.25%)');
  } else if (inviterIsProvider && providerId) {
    await addBalance(providerId, directRewardAmount, 'direct_reward_merged', '直推奖励(0.25%)合并到服务商收益');
  }

  // 3. 服务商收益 2%
  const providerShare = Math.round(productPrice * RELEASE_SHARE_RATIOS.provider);
  if (providerId) {
    await addBalance(providerId, providerShare, 'provider_share', '会员购买产品收益分成 (2%)');
  }

  // 4. 上级服务商 0.25%
  let parentProviderId: string | null = null;
  let parentProviderUserId: string | null = null;
  const parentProviderShare = Math.round(productPrice * RELEASE_SHARE_RATIOS.parentProvider);

  if (providerRecord?.parent_provider_id) {
    parentProviderId = providerRecord.parent_provider_id;
    const parentProvider: any = await queryOne(
      'SELECT user_id FROM providers WHERE id = $1',
      [parentProviderId]
    );
    if (parentProvider?.user_id) {
      parentProviderUserId = parentProvider.user_id;
      await addBalance(parentProvider.user_id, parentProviderShare, 'parent_provider_share', '下级服务商会员购买产品分成 (0.25%)');
    }
  }

  // 5. 服务网点 0.1%
  const branchId = providerRecord?.branch_id || member?.branch_id;
  const branchShare = Math.round(productPrice * RELEASE_SHARE_RATIOS.branch);
  let distributionBranchId: string | null = null;

  if (branchId) {
    const branchUser: any = await queryOne(
      'SELECT id FROM users WHERE id = $1 AND role = $2',
      [branchId, 'branch']
    );
    if (branchUser) {
      distributionBranchId = branchUser.id;
      await addBalance(branchUser.id, branchShare, 'branch_share', '服务商会员购买产品分成 (0.1%)');
    }
  }

  // 6. 总台运营 0.4% + 无上级服务商时的0.25%
  const companyBaseShare = Math.round(productPrice * RELEASE_SHARE_RATIOS.company);
  const noParentShare = parentProviderId ? 0 : parentProviderShare;
  const companyShare = companyBaseShare + noParentShare;

  if (companyShare > 0) {
    const adminUser: any = await queryOne(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1",
      []
    );
    if (adminUser) {
      await addBalance(adminUser.id, companyShare, 'company_share', '平台运营收益');
    }
  }

  // 记录释放收益
  try {
    await execute(
      `INSERT INTO release_records 
       (product_id, product_name, product_price, release_amount, release_rate,
        member_id, member_name, member_share,
        direct_referral_id, direct_referral_share,
        provider_id, provider_share,
        parent_provider_id, parent_provider_share,
        senior_provider_id, senior_provider_share,
        branch_id, branch_share, company_share)
       VALUES ($1, $2, $3, $4, 0.05, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        productId, '', productPrice, releaseAmount,
        memberId, member?.username || memberId, memberShare,
        directRewardTo, directRewardAmount,
        providerId, providerShare,
        parentProviderUserId, parentProviderId ? parentProviderShare : 0,
        null, 0,  // 无高级服务商
        distributionBranchId, branchShare, companyShare
      ]
    );
  } catch (e) {
    console.error('记录释放收益失败:', e);
  }

  // 记录服务商收益分配
  try {
    await execute(
      `INSERT INTO provider_revenue_distribution 
       (id, order_id, provider_id, member_id, product_id, product_price, market_fee, 
        provider_share, direct_reward, direct_reward_to, parent_provider_share, parent_provider_id, 
        branch_share, branch_id, company_share, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, $12, $13, $14, 'completed', NOW())`,
      [
        randomUUID(), orderId, providerId, memberId, productId, productPrice,
        providerShare + (inviterIsProvider ? directRewardAmount : 0),
        inviterIsProvider ? 0 : directRewardAmount,
        directRewardTo,
        parentProviderId ? parentProviderShare : 0,
        parentProviderUserId,
        branchShare,
        distributionBranchId,
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
      await query(
        `UPDATE orders SET status = 'cancelled', reviewed_by = $1, reviewed_at = NOW(), review_note = $2 WHERE id = $3`,
        [reviewerId, note || '审核拒绝', orderId]
      );

      if (order.user_product_id) {
        await query(
          "UPDATE user_products SET status = 'cancelled', updated_at = NOW() WHERE id = $1",
          [order.user_product_id]
        );
      }

      if (order.product_id) {
        await query(
          "UPDATE products SET status = 'available', updated_at = NOW() WHERE id = $1",
          [order.product_id]
        );
      }

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

      const member: any = await queryOne(
        'SELECT * FROM users WHERE id = $1',
        [order.user_id]
      );

      const providerRecord: any = await queryOne(
        'SELECT * FROM providers WHERE user_id = $1',
        [product?.provider_id]
      );

      // 总台释放5%收益，按6项分配（无高级服务商）
      await releaseAndDistribute(
        orderId,
        product?.id,
        productPrice,
        order.user_id,
        product?.provider_id,
        member,
        providerRecord
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
        message: '审核通过，收益已释放，产品已转入会员持仓',
        data: {
          releaseAmount: productPrice * 0.05,
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
