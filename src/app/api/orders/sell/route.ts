import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute, getSupabase } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';
import { addEnergyValue } from '@/lib/energy-utils';

/**
 * 会员卖出产品
 * 新逻辑：卖出时分配5%收益到各角色账户
 * - 解锁只是标记可出售，不分配收益
 * - 会员卖出时才按5%比例分配收益给各角色
 */
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const body = await request.json();
    const { userId, userProductId } = body;

    if (!userId || !userProductId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const dbUser = await queryOne<any>('SELECT * FROM users WHERE id = $1', [userId]);
    if (!dbUser) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

    const userProduct = await queryOne<any>(
      'SELECT * FROM user_products WHERE id = $1 AND user_id = $2',
      [userProductId, userId]
    );
    if (!userProduct) return NextResponse.json({ error: '持仓不存在' }, { status: 404 });
    if (userProduct.status !== 'holding') {
      return NextResponse.json({ error: '产品状态不允许出售' }, { status: 400 });
    }

    // 查询产品信息
    const product = await queryOne<any>(
      'SELECT * FROM products WHERE id = $1',
      [userProduct.product_id]
    );

    // 持仓时间锁检查 - 如果收益已释放（网点已解锁），则跳过时间锁
    const expireDate = new Date(userProduct.expire_date);
    const now = new Date();

    if (!userProduct.revenue_released && now < expireDate) {
      const remainingMs = expireDate.getTime() - now.getTime();
      const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
      const remainingDays = Math.floor(remainingHours / 24);
      const hoursLeft = remainingHours % 24;
      return NextResponse.json({
        success: false,
        error: '持仓时间不足',
        data: {
          code: 'HOLD_TIME_LOCK',
          message: `${product?.period || 7}天产品需到期后才能出售，还需等待${remainingDays > 0 ? remainingDays + '天' : ''}${hoursLeft}小时`,
          canSell: false,
          expireDate: userProduct.expire_date,
        },
      }, { status: 400 });
    }

    // === 核心：卖出时分配5%收益 ===
    // 防止重复分配：检查revenue_distributed字段
    const alreadyDistributed = userProduct.revenue_distributed === true;

    if (!alreadyDistributed) {
      const purchasePrice = parseFloat(userProduct.purchase_price);
      const productPrice = parseFloat(product?.price) || purchasePrice;
      const productName = product?.name || '未知产品';

      // 5%智算金分配
      const memberShare = Math.round(productPrice * 0.02 * 100) / 100;    // 2%
      const providerShare = Math.round(productPrice * 0.02 * 100) / 100;  // 2%
      const directReward = Math.round(productPrice * 0.0025 * 100) / 100; // 0.25%
      const parentShare = Math.round(productPrice * 0.0025 * 100) / 100;  // 0.25%
      const branchShare = Math.round(productPrice * 0.001 * 100) / 100;   // 0.1%
      const companyShare = Math.round(productPrice * 0.004 * 100) / 100;  // 0.4%

      console.log(`[SELL] 分配5%收益: ${productName} ¥${productPrice}, 会员+${memberShare}, 服务商+${providerShare}, 直推+${directReward}, 上级+${parentShare}, 网点+${branchShare}, 公司+${companyShare}`);

      // 1. 会员 2% → energy_value（智算金）
      await addEnergyValue(userId, memberShare, `出售收益-会员${dbUser.username}(${productName})`, userId, 'profit_release');

      // 2. 服务商 2%
      const providerId = product?.provider_id || userProduct.seller_id;
      if (providerShare > 0 && providerId) {
        const providerUser = await queryOne<any>('SELECT username FROM users WHERE id = $1', [providerId]);
        await addEnergyValue(providerId, providerShare, `出售收益-服务商${providerUser?.username || ''}(${productName})`, userId, 'provider_share');
      }

      // 3. 直推人 0.25%
      let actualDirectRewardTo: string | null = null;
      const member = await queryOne<any>('SELECT inviter_id FROM users WHERE id = $1', [userId]);
      const inviterUser = member?.inviter_id ? await queryOne<any>('SELECT id, username, role FROM users WHERE id = $1', [member.inviter_id]) : null;

      if (directReward > 0 && inviterUser) {
        // 检查直推人是否是服务商
        const inviterIsProvider = await queryOne<any>('SELECT id FROM providers WHERE user_id = $1', [inviterUser.id]);
        if (!inviterIsProvider) {
          // 直推人是会员 → 给直推人
          await addEnergyValue(inviterUser.id, directReward, `出售收益-直推${inviterUser.username}(${productName})`, userId, 'direct_reward');
          actualDirectRewardTo = inviterUser.id;
        } else if (providerId) {
          // 直推人是服务商 → 归服务商
          await addEnergyValue(providerId, directReward, `出售收益-直推归服务商(${productName})`, userId, 'provider_share');
          actualDirectRewardTo = providerId;
        }
      } else if (directReward > 0 && providerId) {
        // 无直推 → 归服务商
        await addEnergyValue(providerId, directReward, `出售收益-无直推归服务商(${productName})`, userId, 'provider_share');
        actualDirectRewardTo = providerId;
      }

      // 4. 上级服务商 0.25%（无上级时归网点）
      const providerInfo = await queryOne<any>('SELECT branch_id, parent_provider_id, user_id FROM providers WHERE user_id = $1', [providerId]);
      let actualParentProviderId: string | null = null;

      if (providerInfo?.parent_provider_id && parentShare > 0) {
        const parentProvider = await queryOne<any>('SELECT user_id FROM providers WHERE id = $1', [providerInfo.parent_provider_id]);
        if (parentProvider?.user_id) {
          actualParentProviderId = providerInfo.parent_provider_id;
          const parentUser = await queryOne<any>('SELECT username FROM users WHERE id = $1', [parentProvider.user_id]);
          await addEnergyValue(parentProvider.user_id, parentShare, `出售收益-上级服务商${parentUser?.username || ''}(${productName})`, userId, 'upstream_provider_share');
        }
      }

      // 5. 服务网点 0.1%（+无上级时0.25%归网点）
      const noParentExtra = actualParentProviderId ? 0 : parentShare;
      const branchTotalShare = branchShare + noParentExtra;
      if (providerInfo?.branch_id && branchTotalShare > 0) {
        await addEnergyValue(providerInfo.branch_id, branchTotalShare, `出售收益-网点(${productName})`, userId, 'branch_share');
      }

      // 6. 公司运营 0.4%
      if (companyShare > 0) {
        const adminUser = await queryOne<any>("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
        if (adminUser) {
          await addEnergyValue(adminUser.id, companyShare, `出售收益-公司运营(${productName})`, userId, 'company_share');
        }
      }

      // 7. 写入中间记录表
      try {
        // member_revenue
        const holdingHours = (now.getTime() - new Date(userProduct.purchase_date).getTime()) / (1000 * 60 * 60);
        const holdingDays = Math.max(1, Math.floor(holdingHours / 24));
        await execute(
          `INSERT INTO member_revenue 
           (user_id, user_product_id, principal, profit, total_amount, converted_to_energy, status, product_name, product_code, product_period, total_rate, profit_rate, market_rate, holding_days)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [userId, userProductId, purchasePrice, memberShare, purchasePrice + memberShare,
           0, 'completed', product?.name || '未知产品', product?.code || '', product?.period || 1,
           product?.total_rate || 0, product?.profit_rate || 0, product?.market_rate || 0, holdingDays]
        );
      } catch (e: any) {
        console.error('[SELL] 写入member_revenue失败:', e?.message);
      }

      try {
        // provider_revenue_distribution
        const supabase = getSupabase();
        await supabase.from('provider_revenue_distribution').insert({
          id: `prd-${userProductId}-${Date.now()}`,
          product_id: userProduct.product_id,
          user_product_id: userProductId,
          provider_id: providerId || '',
          member_id: userId,
          member_inviter_id: member?.inviter_id || null,
          product_price: productPrice,
          market_fee: productPrice * (Number(product?.market_rate) || 5) / 100,
          provider_share: providerShare + (actualDirectRewardTo === providerId ? directReward : 0),
          direct_reward: directReward,
          direct_reward_to: actualDirectRewardTo,
          parent_provider_share: actualParentProviderId ? parentShare : 0,
          parent_provider_id: actualParentProviderId,
          branch_share: branchTotalShare,
          branch_id: providerInfo?.branch_id || '',
          company_share: companyShare,
          status: 'completed',
          created_at: new Date().toISOString()
        });
      } catch (e: any) {
        console.error('[SELL] 写入provider_revenue_distribution失败:', e?.message);
      }

      try {
        // release_records
        await execute(
          `INSERT INTO release_records 
           (product_id, product_name, product_price, release_amount, release_rate, member_id, member_name, member_share,
            direct_referral_id, direct_referral_share, provider_id, provider_name, provider_share,
            parent_provider_id, parent_provider_share, branch_id, branch_share, company_share, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())`,
          [
            userProduct.product_id, productName, productPrice, productPrice * 0.05, 5,
            userId, dbUser.username, memberShare,
            member?.inviter_id || null, directReward,
            providerId || '', '', providerShare,
            actualParentProviderId, actualParentProviderId ? parentShare : 0,
            providerInfo?.branch_id || '', branchTotalShare,
            companyShare
          ]
        );
      } catch (e: any) {
        console.error('[SELL] 写入release_records失败:', e?.message);
      }

      try {
        // branch_revenue_records
        if (providerInfo?.branch_id) {
          await execute(
            `INSERT INTO branch_revenue_records 
             (branch_id, product_id, product_name, product_price, member_id, member_name, provider_id, provider_name, branch_share, company_share, total_amount, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
            [providerInfo.branch_id, userProduct.product_id, productName, productPrice,
             userId, dbUser.username, providerId || '', '', branchTotalShare, companyShare,
             productPrice * 0.05, 'completed']
          );
        }
      } catch (e: any) {
        console.error('[SELL] 写入branch_revenue_records失败:', e?.message);
      }

      // 标记收益已分配（防重复）
      await execute(
        `UPDATE user_products SET revenue_distributed = true, updated_at = NOW() WHERE id = $1`,
        [userProductId]
      );

      console.log(`[SELL] 5%收益分配完成: ${productName} ¥${productPrice}`);
    } else {
      console.log(`[SELL] 收益已分配过，跳过: userProductId=${userProductId}`);
    }

    // 如果还没解锁，也标记解锁
    if (!userProduct.revenue_released) {
      await execute(
        `UPDATE user_products SET revenue_released = true, updated_at = NOW() WHERE id = $1`,
        [userProductId]
      );
    }

    const purchasePrice = parseFloat(userProduct.purchase_price);

    // 创建卖出订单
    const orderResult = await query(
      `INSERT INTO orders 
       (user_id, user_product_id, product_id, order_type, amount, status, review_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, userProductId, userProduct.product_id, 'sell', purchasePrice, 'pending', 
       `出售产品: ${product?.name || '未知产品'}，Token值¥${purchasePrice}待匹配成功后由新持有人线下支付`]
    );

    // 更新用户产品状态为"售卖中"
    await execute(
      `UPDATE user_products SET status = 'pending_sell', updated_at = NOW() WHERE id = $1`,
      [userProductId]
    );

    // 产品回到服务商 - 状态改为 pending_match（待匹配）
    await execute(
      `UPDATE products SET status = 'pending_match', previous_holder_id = $1, updated_at = NOW() WHERE id = $2`,
      [userId, userProduct.product_id]
    );

    // 通知服务商
    if (dbUser.provider_id) {
      const supabase = getSupabase();
      await supabase.from('notifications').insert({
        receiver_id: dbUser.provider_id,
        receiver_role: 'provider',
        type: 'sell_request',
        title: '会员卖出申请',
        content: `会员 ${dbUser.username} 申请卖出产品 ${product?.name || '未知产品'}，Token值¥${purchasePrice}`,
        is_read: false
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        order: orderResult?.[0] || null,
        message: '卖出申请已提交，5%收益已分配到各角色账户',
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    console.error('[SELL] 卖出失败:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
