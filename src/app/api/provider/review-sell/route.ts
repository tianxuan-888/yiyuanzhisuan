import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { getSupabaseUrl, getSupabaseServiceRoleKey } from '@/lib/env';
import { execute, queryOne } from '@/lib/pg-client';

function getAdminSupabase() {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) throw new Error('Missing Supabase configuration');
  return createClient(url, key);
}

// 审核会员卖出申请
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }
    const providerId = authUser.userId;
    const body = await request.json();
    const { userProductId, action } = body;

    if (!userProductId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }
    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '无效的操作类型' }, { status: 400 });
    }

    const client = getAdminSupabase();

    // 查询用户产品
    const { data: userProduct, error: productError } = await client
      .from('user_products')
      .select('*')
      .eq('id', userProductId)
      .eq('status', 'pending_sell')
      .maybeSingle();

    if (productError) throw new Error(`查询产品失败: ${productError.message}`);
    if (!userProduct) return NextResponse.json({ error: '产品不存在或不在待审核状态' }, { status: 404 });

    // 查询用户信息
    const { data: productUser, error: userError } = await client
      .from('users')
      .select('id, provider_id, username, balance, inviter_id')
      .eq('id', userProduct.user_id)
      .maybeSingle();

    if (userError || !productUser) throw new Error('查询用户失败');
    if (productUser.provider_id !== providerId) {
      return NextResponse.json({ error: '无权审核此产品' }, { status: 403 });
    }

    if (action === 'approve') {
      const purchasePrice = parseFloat(userProduct.purchase_price);
      const expectedProfit = parseFloat(userProduct.expected_profit);
      const marketFee = parseFloat(userProduct.market_fee || '0');
      const totalReturn = purchasePrice + expectedProfit;

      // 查询产品信息
      const { data: productInfo } = await client
        .from('products')
        .select('id, name, period, profit_rate')
        .eq('id', userProduct.product_id)
        .maybeSingle();

      const productName = productInfo?.name || '未知产品';
      const productPeriod = productInfo?.period || 0;

      // 更新产品状态
      await client
        .from('user_products')
        .update({
          status: 'sold',
          sell_price: totalReturn,
          sell_date: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', userProductId);

      // 会员收益：本金 + 实际到手收益 → balance
      const currentBalance = parseFloat(productUser.balance || '0');
      const newBalance = Math.round((currentBalance + totalReturn) * 100) / 100;
      await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newBalance, userProduct.user_id]);

      // ========== 市场费5方分配（写入balance，不是energy_value）==========
      if (marketFee > 0) {
        const providerShare = Math.round(marketFee * 0.70 * 100) / 100; // 70% 服务商
        const directReward = Math.round(marketFee * 0.10 * 100) / 100; // 10% 直推人
        const parentShare = Math.round(marketFee * 0.10 * 100) / 100;  // 10% 上级服务商
        const branchShare = Math.round(marketFee * 0.05 * 100) / 100;  // 5% 分公司
        const companyShare = Math.round(marketFee * 0.05 * 100) / 100; // 5% 总公司

        // 1. 服务商70% → balance
        if (providerShare > 0) {
          const provRow = await queryOne('SELECT balance FROM users WHERE id = $1', [providerId]);
          if (provRow) {
            const newProvBal = Math.round((parseFloat(String(provRow.balance)) + providerShare) * 100) / 100;
            await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newProvBal, providerId]);
          }
        }

        // 2. 直推人10% → balance
        if (directReward > 0 && productUser.inviter_id) {
          const invRow = await queryOne('SELECT balance FROM users WHERE id = $1', [productUser.inviter_id]);
          if (invRow) {
            const newInvBal = Math.round((parseFloat(String(invRow.balance)) + directReward) * 100) / 100;
            await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newInvBal, productUser.inviter_id]);
          }
        }

        // 3. 上级服务商10% → balance（没有上级则给当前服务商）
        if (parentShare > 0) {
          const { data: provUser } = await client.from('users').select('inviter_id').eq('id', providerId).maybeSingle();
          const parentProviderId = provUser?.inviter_id || providerId;
          const ppRow = await queryOne('SELECT balance FROM users WHERE id = $1', [parentProviderId]);
          if (ppRow) {
            const newPPBal = Math.round((parseFloat(String(ppRow.balance)) + parentShare) * 100) / 100;
            await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newPPBal, parentProviderId]);
          }
        }

        // 4. 分公司5% → balance
        if (branchShare > 0) {
          const { data: provData } = await client.from('providers').select('branch_id').eq('user_id', providerId).maybeSingle();
          if (provData?.branch_id) {
            const brRow = await queryOne('SELECT balance FROM users WHERE id = $1', [provData.branch_id]);
            if (brRow) {
              const newBrBal = Math.round((parseFloat(String(brRow.balance)) + branchShare) * 100) / 100;
              await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newBrBal, provData.branch_id]);
            }
          }
        }

        // 5. 总公司5% → balance
        if (companyShare > 0) {
          const { data: adminUser } = await client.from('users').select('id').eq('role', 'admin').limit(1).maybeSingle();
          if (adminUser) {
            const adRow = await queryOne('SELECT balance FROM users WHERE id = $1', [adminUser.id]);
            if (adRow) {
              const newAdBal = Math.round((parseFloat(String(adRow.balance)) + companyShare) * 100) / 100;
              await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newAdBal, adminUser.id]);
            }
          }
        }

        // 记录分配明细
        await client.from('provider_revenue_distribution').insert({
          id: crypto.randomUUID(),
          order_id: userProduct.order_id || null,
          product_id: userProduct.product_id,
          provider_id: providerId,
          member_id: userProduct.user_id,
          member_inviter_id: productUser.inviter_id,
          product_price: purchasePrice,
          market_fee: marketFee,
          provider_share: providerShare,
          direct_reward: directReward,
          direct_reward_to: productUser.inviter_id,
          parent_provider_share: parentShare,
          parent_provider_id: providerId,
          branch_share: branchShare,
          company_share: companyShare,
          status: 'completed',
        });
      }

      // 记录会员收益明细
      const revenueId = crypto.randomUUID();
      await client.from('member_revenue').insert({
        id: revenueId,
        user_id: userProduct.user_id,
        order_id: userProduct.order_id || null,
        user_product_id: userProductId,
        principal: purchasePrice,
        profit: expectedProfit,
        total_amount: totalReturn,
        converted_to_energy: 0,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await client.from('revenue_details').insert([
        {
          id: crypto.randomUUID(),
          user_id: userProduct.user_id,
          revenue_id: revenueId,
          type: 'principal_in',
          amount: purchasePrice,
          balance_before: currentBalance,
          balance_after: currentBalance + purchasePrice,
          description: `卖出${productPeriod}天产品「${productName}」本金返还`,
          related_id: userProduct.product_id,
          created_at: new Date().toISOString(),
        },
        {
          id: crypto.randomUUID(),
          user_id: userProduct.user_id,
          revenue_id: revenueId,
          type: 'profit_in',
          amount: expectedProfit,
          balance_before: currentBalance + purchasePrice,
          balance_after: newBalance,
          description: `持有${productPeriod}天产品「${productName}」到期收益`,
          related_id: userProduct.product_id,
          created_at: new Date().toISOString(),
        },
      ]);

      await client.from('transactions').insert({
        id: crypto.randomUUID(),
        user_id: userProduct.user_id,
        type: 'profit',
        amount: totalReturn,
        balance_before: currentBalance,
        balance_after: newBalance,
        description: `卖出${productPeriod}天产品「${productName}」，本金¥${purchasePrice}+收益¥${expectedProfit}`,
        created_at: new Date().toISOString(),
      });

      return NextResponse.json({
        success: true,
        message: '审核通过，产品已卖出',
        data: {
          status: 'sold',
          total_return: totalReturn,
          principal: purchasePrice,
          profit: expectedProfit,
        },
      });
    } else {
      // 拒绝
      await client
        .from('user_products')
        .update({ status: 'holding', updated_at: new Date().toISOString() })
        .eq('id', userProductId);

      return NextResponse.json({
        success: true,
        message: '已拒绝卖出申请',
        data: { status: 'holding' },
      });
    }
  } catch (error) {
    console.error('审核卖出失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '审核卖出失败' },
      { status: 500 }
    );
  }
}
