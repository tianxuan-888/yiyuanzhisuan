import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute, getSupabase } from '@/lib/supabase-client';
import { addEnergyValue } from '@/lib/energy-utils';

/**
 * 网点代卖 - 强制卖出会员产品
 * 新逻辑：卖出时分配5%收益（与会员卖出一致）
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { branchId, userProductIds, userId: operatorId } = body;

    if (!branchId || !userProductIds || !Array.isArray(userProductIds) || userProductIds.length === 0) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    let soldCount = 0;
    const errors: string[] = [];

    for (const upId of userProductIds) {
      try {
        // 查询用户产品
        const up = await queryOne<any>(
          'SELECT * FROM user_products WHERE id = $1',
          [upId]
        );
        if (!up) { errors.push(`${upId}: 持仓不存在`); continue; }
        if (up.status === 'pending_sell') { errors.push(`${upId}: 已在售卖中`); continue; }
        if (up.status === 'sold') { errors.push(`${upId}: 已售出`); continue; }

        // 查询产品
        const product = await queryOne<any>(
          'SELECT * FROM products WHERE id = $1',
          [up.product_id]
        );

        // 查询会员
        const member = await queryOne<any>(
          'SELECT * FROM users WHERE id = $1',
          [up.user_id]
        );

        if (!member) { errors.push(`${upId}: 会员不存在`); continue; }

        // === 卖出时分配5%收益（与会员卖出逻辑一致）===
        const alreadyDistributed = up.revenue_distributed === true;

        if (!alreadyDistributed) {
          const purchasePrice = parseFloat(up.purchase_price);
          const productPrice = parseFloat(product?.price) || purchasePrice;
          const productName = product?.name || '未知产品';

          const memberShare = Math.round(productPrice * 0.02 * 100) / 100;
          const providerShare = Math.round(productPrice * 0.02 * 100) / 100;
          const directReward = Math.round(productPrice * 0.0025 * 100) / 100;
          const parentShare = Math.round(productPrice * 0.0025 * 100) / 100;
          const branchShare = Math.round(productPrice * 0.001 * 100) / 100;
          const companyShare = Math.round(productPrice * 0.004 * 100) / 100;

          console.log(`[FORCE-SELL] 分配5%收益: ${productName} ¥${productPrice}`);

          // 1. 会员 2%
          await addEnergyValue(up.user_id, memberShare, `网点代售收益-会员${member.username}(${productName})`, up.user_id, 'profit_release');

          // 2. 服务商 2%
          const providerId = product?.provider_id || up.seller_id;
          if (providerShare > 0 && providerId) {
            const providerUser = await queryOne<any>('SELECT username FROM users WHERE id = $1', [providerId]);
            await addEnergyValue(providerId, providerShare, `网点代售收益-服务商${providerUser?.username || ''}(${productName})`, up.user_id, 'provider_share');
          }

          // 3. 直推人 0.25%
          let actualDirectRewardTo: string | null = null;
          const memberInfo = await queryOne<any>('SELECT inviter_id FROM users WHERE id = $1', [up.user_id]);
          const inviterUser = memberInfo?.inviter_id ? await queryOne<any>('SELECT id, username, role FROM users WHERE id = $1', [memberInfo.inviter_id]) : null;

          if (directReward > 0 && inviterUser) {
            const inviterIsProvider = await queryOne<any>('SELECT id FROM providers WHERE user_id = $1', [inviterUser.id]);
            if (!inviterIsProvider) {
              await addEnergyValue(inviterUser.id, directReward, `网点代售收益-直推${inviterUser.username}(${productName})`, up.user_id, 'direct_reward');
              actualDirectRewardTo = inviterUser.id;
            } else if (providerId) {
              await addEnergyValue(providerId, directReward, `网点代售收益-直推归服务商(${productName})`, up.user_id, 'provider_share');
              actualDirectRewardTo = providerId;
            }
          } else if (directReward > 0 && providerId) {
            await addEnergyValue(providerId, directReward, `网点代售收益-无直推归服务商(${productName})`, up.user_id, 'provider_share');
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
              await addEnergyValue(parentProvider.user_id, parentShare, `网点代售收益-上级服务商${parentUser?.username || ''}(${productName})`, up.user_id, 'upstream_provider_share');
            }
          }

          // 5. 服务网点 0.1% + 无上级时0.25%归网点
          const noParentExtra = actualParentProviderId ? 0 : parentShare;
          const branchTotalShare = branchShare + noParentExtra;
          if (providerInfo?.branch_id && branchTotalShare > 0) {
            await addEnergyValue(providerInfo.branch_id, branchTotalShare, `网点代售收益-网点(${productName})`, up.user_id, 'branch_share');
          }

          // 6. 公司运营 0.4%
          if (companyShare > 0) {
            const adminUser = await queryOne<any>("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
            if (adminUser) {
              await addEnergyValue(adminUser.id, companyShare, `网点代售收益-公司运营(${productName})`, up.user_id, 'company_share');
            }
          }

          // 7. 写入中间记录
          try {
            const supabase = getSupabase();
            await supabase.from('provider_revenue_distribution').insert({
              id: `prd-${upId}-${Date.now()}`,
              product_id: up.product_id,
              user_product_id: upId,
              provider_id: providerId || '',
              member_id: up.user_id,
              member_inviter_id: memberInfo?.inviter_id || null,
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
            console.error('[FORCE-SELL] 写入provider_revenue_distribution失败:', e?.message);
          }

          try {
            await execute(
              `INSERT INTO release_records 
               (product_id, product_name, product_price, release_amount, release_rate, member_id, member_name, member_share,
                direct_referral_id, direct_referral_share, provider_id, provider_name, provider_share,
                parent_provider_id, parent_provider_share, branch_id, branch_share, company_share, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())`,
              [
                up.product_id, productName, productPrice, productPrice * 0.05, 5,
                up.user_id, member.username, memberShare,
                memberInfo?.inviter_id || null, directReward,
                providerId || '', '', providerShare,
                actualParentProviderId, actualParentProviderId ? parentShare : 0,
                providerInfo?.branch_id || '', branchTotalShare,
                companyShare
              ]
            );
          } catch (e: any) {
            console.error('[FORCE-SELL] 写入release_records失败:', e?.message);
          }

          // 标记收益已分配
          await execute(
            `UPDATE user_products SET revenue_distributed = true, updated_at = NOW() WHERE id = $1`,
            [upId]
          );

          console.log(`[FORCE-SELL] 5%收益分配完成: ${productName} ¥${productPrice}`);
        }

        // 如果还没解锁也标记
        if (!up.revenue_released) {
          await execute(
            `UPDATE user_products SET revenue_released = true, updated_at = NOW() WHERE id = $1`,
            [upId]
          );
        }

        // 更新状态为"售卖中"
        await execute(
          `UPDATE user_products SET status = 'pending_sell', updated_at = NOW() WHERE id = $1`,
          [upId]
        );

        // 产品状态改为"待匹配"
        await execute(
          `UPDATE products SET status = 'pending_match', previous_holder_id = $1, updated_at = NOW() WHERE id = $2`,
          [up.user_id, up.product_id]
        );

        soldCount++;
      } catch (e: any) {
        console.error(`[FORCE-SELL] 处理${upId}失败:`, e?.message);
        errors.push(`${upId}: ${e?.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `成功卖出${soldCount}个产品`,
      soldCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    console.error('[FORCE-SELL] 失败:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
