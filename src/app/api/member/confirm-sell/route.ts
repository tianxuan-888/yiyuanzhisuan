import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest } from '@/lib/auth';
import { execute, queryOne } from '@/lib/pg-client';

// 会员确认卖出收款（会员确认收到买家线下付款后执行）
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const userId = authUser.userId;
    const body = await request.json();
    const { orderId } = body;

    if (!orderId) return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });

    const client = getSupabaseClient();

    // 查询订单
    const { data: order } = await client.from('orders').select('*').eq('id', orderId).maybeSingle();
    if (!order) return NextResponse.json({ error: '订单不存在' }, { status: 404 });
    if (order.order_type !== 'sell') return NextResponse.json({ error: '非卖出订单' }, { status: 400 });
    if (order.status !== 'awaiting_payment') return NextResponse.json({ error: '订单状态不允许确认' }, { status: 400 });

    // 查询用户产品
    const { data: userProduct } = await client
      .from('user_products')
      .select('*, products(*)')
      .eq('id', order.user_product_id)
      .maybeSingle();

    if (!userProduct) return NextResponse.json({ error: '用户产品不存在' }, { status: 404 });

    // 计算收益
    const purchasePrice = parseFloat(userProduct.purchase_price || '0');
    const expectedProfit = parseFloat(userProduct.expected_profit || '0');
    const marketFee = parseFloat(userProduct.market_fee || '0');
    const totalReturn = purchasePrice + expectedProfit;

    // 会员收益：本金 + 实际到手收益 → balance
    const userRow = await queryOne('SELECT balance, inviter_id, provider_id FROM users WHERE id = $1', [userId]);
    const currentBalance = parseFloat(String(userRow?.balance)) || 0;
    const newBalance = Math.round((currentBalance + totalReturn) * 100) / 100;
    await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newBalance, userId]);

    // 更新订单状态
    await client.from('orders').update({ status: 'completed', reviewed_at: new Date().toISOString() }).eq('id', orderId);

    // 更新用户产品状态
    await client.from('user_products').update({ status: 'sold', sell_price: totalReturn, sell_date: new Date().toISOString() }).eq('id', order.user_product_id);

    // ========== 市场费5方分配（写入balance，不是energy_value）==========
    const distributionResult: Record<string, number> = {};

    if (marketFee > 0) {
      const providerShare = Math.round(marketFee * 0.70 * 100) / 100;
      const directReward = Math.round(marketFee * 0.10 * 100) / 100;
      const parentShare = Math.round(marketFee * 0.10 * 100) / 100;
      const branchShare = Math.round(marketFee * 0.05 * 100) / 100;
      const companyShare = Math.round(marketFee * 0.05 * 100) / 100;

      const inviterId = userRow?.inviter_id;
      const provId = userRow?.provider_id;

      // 1. 服务商70% → balance
      if (providerShare > 0 && provId) {
        const provRow = await queryOne('SELECT balance FROM users WHERE id = $1', [provId]);
        if (provRow) {
          const newProvBal = Math.round((parseFloat(String(provRow.balance)) + providerShare) * 100) / 100;
          await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newProvBal, provId]);
        }
      }
      distributionResult.provider = providerShare;

      // 2. 直推人10% → balance
      if (directReward > 0 && inviterId) {
        const invRow = await queryOne('SELECT balance FROM users WHERE id = $1', [inviterId]);
        if (invRow) {
          const newInvBal = Math.round((parseFloat(String(invRow.balance)) + directReward) * 100) / 100;
          await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newInvBal, inviterId]);
        }
      }
      distributionResult.direct = directReward;

      // 3. 上级服务商10% → balance（无上级则归总公司）
      let parentProviderId: string | null = null;
      if (parentShare > 0 && provId) {
        const { data: provData } = await client.from('providers').select('parent_provider_id').eq('user_id', provId).maybeSingle();
        parentProviderId = provData?.parent_provider_id || null;
        
        if (parentProviderId) {
          const ppRow = await queryOne('SELECT balance FROM users WHERE id = $1', [parentProviderId]);
          if (ppRow) {
            const newPPBal = Math.round((parseFloat(String(ppRow.balance)) + parentShare) * 100) / 100;
            await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newPPBal, parentProviderId]);
          }
        } else {
          // 无上级服务商，10%归分公司（分公司承担了第一代服务商的培养职责）
          if (provId) {
            const provInfo = await queryOne('SELECT branch_id FROM providers WHERE user_id = $1', [provId]);
            if (provInfo?.branch_id) {
              const brRow = await queryOne('SELECT balance FROM users WHERE id = $1', [provInfo.branch_id]);
              if (brRow) {
                const newBrBal = Math.round((parseFloat(String(brRow.balance)) + parentShare) * 100) / 100;
                await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newBrBal, provInfo.branch_id]);
              }
            }
          }
        }
      }
      distributionResult.parentProvider = parentShare;

      // 4. 分公司5% → balance
      if (branchShare > 0 && provId) {
        const { data: provData } = await client.from('providers').select('branch_id').eq('user_id', provId).maybeSingle();
        if (provData?.branch_id) {
          const brRow = await queryOne('SELECT balance FROM users WHERE id = $1', [provData.branch_id]);
          if (brRow) {
            const newBrBal = Math.round((parseFloat(String(brRow.balance)) + branchShare) * 100) / 100;
            await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newBrBal, provData.branch_id]);
          }
        }
      }
      distributionResult.branch = branchShare;

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
      distributionResult.company = companyShare;

      // 记录分配明细
      await client.from('provider_revenue_distribution').insert({
        id: crypto.randomUUID(),
        order_id: orderId,
        product_id: userProduct.product_id,
        provider_id: provId,
        member_id: userId,
        member_inviter_id: inviterId,
        product_price: purchasePrice,
        market_fee: marketFee,
        provider_share: providerShare,
        direct_reward: directReward,
        direct_reward_to: inviterId,
        parent_provider_share: parentShare,
        parent_provider_id: parentProviderId || null,
        branch_share: branchShare,
        company_share: companyShare,
        status: 'completed',
      });
    }

    // 记录会员交易流水
    await client.from('transactions').insert({
      user_id: userId,
      order_id: orderId,
      type: 'sell_profit',
      amount: totalReturn,
      balance: newBalance,
      description: `卖出产品，本金¥${purchasePrice}+收益¥${expectedProfit}`,
    });

    return NextResponse.json({
      success: true,
      message: '收益已到账',
      data: {
        user: { beforeBalance: currentBalance, afterBalance: newBalance },
        profit: { totalProfit: expectedProfit, cashAmount: totalReturn },
        distribution: distributionResult,
      },
    });
  } catch (error) {
    console.error('确认卖出收益失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '确认失败' },
      { status: 500 }
    );
  }
}
