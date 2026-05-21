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

    // ========== 市场费7方分配（按产品价格比例，写入balance）==========
    // 会员2% + 直推0.3% + 服务商2% + 上级服务商0.3% + 高级服务商0.15% + 服务网点0.15% + 智算平台运营0.10% = 5%
    const distributionResult: Record<string, number> = {};

    if (marketFee > 0) {
      const memberShare = Math.round(purchasePrice * 0.02 * 100) / 100;
      const directReward = Math.round(purchasePrice * 0.003 * 100) / 100;
      const providerShare = Math.round(purchasePrice * 0.02 * 100) / 100;
      const parentShare = Math.round(purchasePrice * 0.003 * 100) / 100;
      const seniorShare = Math.round(purchasePrice * 0.0015 * 100) / 100;
      const branchShare = Math.round(purchasePrice * 0.0015 * 100) / 100;
      const companyShare = Math.round(purchasePrice * 0.001 * 100) / 100;

      const inviterId = userRow?.inviter_id;
      const provId = userRow?.provider_id;

      // 1. 会员2% → balance
      if (memberShare > 0) {
        const mRow = await queryOne('SELECT balance FROM users WHERE id = $1', [userId]);
        if (mRow) {
          const newMBal = Math.round((parseFloat(String(mRow.balance)) + memberShare) * 100) / 100;
          await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newMBal, userId]);
        }
      }
      distributionResult.member = memberShare;

      // 2. 直推人0.3% → balance
      if (directReward > 0 && inviterId) {
        const invRow = await queryOne('SELECT balance FROM users WHERE id = $1', [inviterId]);
        if (invRow) {
          const newInvBal = Math.round((parseFloat(String(invRow.balance)) + directReward) * 100) / 100;
          await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newInvBal, inviterId]);
        }
      }
      distributionResult.direct = directReward;

      // 3. 上级服务商0.3% → balance（无上级则归智算平台运营）
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
        }
      }
      distributionResult.parentProvider = parentShare;

      // 4. 高级服务商0.15% → balance（向上查找最近的高级服务商，无则归智算平台运营）
      let seniorProviderId: string | null = null;
      if (seniorShare > 0 && provId) {
        const provInfo2 = await queryOne('SELECT id, parent_provider_id FROM providers WHERE user_id = $1', [provId]);
        if (provInfo2?.parent_provider_id) {
          let currentProviderId = provInfo2.parent_provider_id;
          let depth = 0;
          while (currentProviderId && depth < 20) {
            const sp: any = await queryOne('SELECT id, user_id, parent_provider_id, is_senior FROM providers WHERE id = $1', [currentProviderId]);
            if (!sp) break;
            if (sp.is_senior) {
              seniorProviderId = sp.user_id;
              const spRow = await queryOne('SELECT balance FROM users WHERE id = $1', [sp.user_id]);
              if (spRow) {
                const newSPBal = Math.round((parseFloat(String(spRow.balance)) + seniorShare) * 100) / 100;
                await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newSPBal, sp.user_id]);
              }
              break;
            }
            currentProviderId = sp.parent_provider_id;
            depth++;
          }
        }
      }
      distributionResult.seniorProvider = seniorShare;

      // 5. 服务商2% → balance
      if (providerShare > 0 && provId) {
        const provRow = await queryOne('SELECT balance FROM users WHERE id = $1', [provId]);
        if (provRow) {
          const newProvBal = Math.round((parseFloat(String(provRow.balance)) + providerShare) * 100) / 100;
          await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newProvBal, provId]);
        }
      }
      distributionResult.provider = providerShare;

      // 6. 服务网点0.15% → balance
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

      // 7. 智算平台运营0.10%（+无上级服务商时的0.3% + 无高级服务商时的0.15%）→ balance
      const noParentExtra = parentProviderId ? 0 : parentShare;
      const noSeniorExtra = seniorProviderId ? 0 : seniorShare;
      const finalCompanyShare = companyShare + noParentExtra + noSeniorExtra;
      if (finalCompanyShare > 0) {
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

      // 记录分配明细（使用 execute(SQL) 避免 REST API insert 静默失败）
      const distId = crypto.randomUUID();
      const provBranchInfo = await queryOne('SELECT branch_id FROM providers WHERE user_id = $1', [provId]);
      const branchId = provBranchInfo?.branch_id || null;
      await execute(
        `INSERT INTO provider_revenue_distribution 
          (id, order_id, product_id, provider_id, member_id, member_inviter_id, product_price,
           market_fee, provider_share, direct_reward, direct_reward_to,
           parent_provider_id, parent_provider_share, branch_id, branch_share, company_share, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())`,
        [
          distId, orderId, userProduct.product_id,
          provId, userId, inviterId || null,
          purchasePrice, marketFee, providerShare, directReward,
          inviterId || null,
          parentProviderId || null, parentShare,
          branchId, branchShare, companyShare, 'completed',
        ]
      );
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
