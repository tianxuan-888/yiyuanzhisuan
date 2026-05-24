import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest } from '@/lib/auth';
import { execute, queryOne } from '@/lib/pg-client';

// 会员确认卖出收款（会员确认收到买家线下付款后执行）
// 智算金（balance）= 5%释放收益，Token值随产品流转（线下交易）
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

    // Token值 = 产品价格（随产品流转，线下交易处理）
    // 收益 = 预期收益（进智算金balance）
    const purchasePrice = parseFloat(userProduct.purchase_price || '0');
    const expectedProfit = parseFloat(userProduct.expected_profit || '0');

    // 会员收益 → 智算金（balance），只有收益部分，不含Token值
    const userRow = await queryOne('SELECT balance, inviter_id, provider_id FROM users WHERE id = $1', [userId]);
    const currentBalance = parseFloat(String(userRow?.balance)) || 0;
    const newBalance = Math.round((currentBalance + expectedProfit) * 100) / 100;
    await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newBalance, userId]);

    // 更新订单状态
    await client.from('orders').update({ status: 'completed', reviewed_at: new Date().toISOString() }).eq('id', orderId);

    // 更新用户产品状态
    await client.from('user_products').update({ status: 'sold', sell_price: purchasePrice, sell_date: new Date().toISOString() }).eq('id', order.user_product_id);

    // ========== 总台释放5%收益，按7项分配 ==========
    const productPrice = purchasePrice;
    const releaseAmount = productPrice * 0.05;
    const distributionResult: Record<string, number> = {};

    const memberShare = Math.round(productPrice * 0.02 * 100) / 100;
    const directReward = Math.round(productPrice * 0.0025 * 100) / 100;
    const providerShare = Math.round(productPrice * 0.02 * 100) / 100;
    const parentShare = Math.round(productPrice * 0.0025 * 100) / 100;
    const branchShare = Math.round(productPrice * 0.001 * 100) / 100;
    const companyShare = Math.round(productPrice * 0.004 * 100) / 100;

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

    // 2. 直推人0.25% → balance
    if (directReward > 0 && inviterId) {
      const invRow = await queryOne('SELECT balance FROM users WHERE id = $1', [inviterId]);
      if (invRow) {
        const newInvBal = Math.round((parseFloat(String(invRow.balance)) + directReward) * 100) / 100;
        await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newInvBal, inviterId]);
      }
    }
    distributionResult.direct = directReward;

    // 3. 下级服务商0.25% → balance（无上级则归总台运营）
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

    // 4. 服务商2% → balance
    if (providerShare > 0 && provId) {
      const provRow = await queryOne('SELECT balance FROM users WHERE id = $1', [provId]);
      if (provRow) {
        const newProvBal = Math.round((parseFloat(String(provRow.balance)) + providerShare) * 100) / 100;
        await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newProvBal, provId]);
      }
    }
    distributionResult.provider = providerShare;

    // 5. 服务网点0.1% → balance
    let distributionBranchId: string | null = null;
    if (branchShare > 0 && provId) {
      const { data: provData } = await client.from('providers').select('branch_id').eq('user_id', provId).maybeSingle();
      if (provData?.branch_id) {
        distributionBranchId = provData.branch_id;
        const brRow = await queryOne('SELECT balance FROM users WHERE id = $1', [provData.branch_id]);
        if (brRow) {
          const newBrBal = Math.round((parseFloat(String(brRow.balance)) + branchShare) * 100) / 100;
          await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newBrBal, provData.branch_id]);
        }
      }
    }
    distributionResult.branch = branchShare;

    // 6. 总台运营0.4%（+无上级服务商时的0.25%）→ balance
    const noParentExtra = parentProviderId ? 0 : parentShare;
    const finalCompanyShare = companyShare + noParentExtra;
    if (finalCompanyShare > 0) {
      const { data: adminUser } = await client.from('users').select('id').eq('role', 'admin').limit(1).maybeSingle();
      if (adminUser) {
        const adRow = await queryOne('SELECT balance FROM users WHERE id = $1', [adminUser.id]);
        if (adRow) {
          const newAdBal = Math.round((parseFloat(String(adRow.balance)) + finalCompanyShare) * 100) / 100;
          await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newAdBal, adminUser.id]);
        }
      }
    }
    distributionResult.company = companyShare;

    // 记录释放收益
    try {
      await execute(
        `INSERT INTO release_records 
         (product_id, product_name, product_price, release_amount, release_rate,
          member_id, member_name, member_share,
          direct_referral_id, direct_referral_share,
          provider_id, provider_share,
          parent_provider_id, parent_provider_share,
          branch_id, branch_share, company_share)
         VALUES ($1, $2, $3, $4, 0.05, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          userProduct.product_id, userProduct.products?.name || '', productPrice, releaseAmount,
          userId, userRow?.username || userId, memberShare,
          inviterId || null, directReward,
          provId, providerShare,
          parentProviderId, parentProviderId ? parentShare : 0,
          distributionBranchId, branchShare, finalCompanyShare
        ]
      );
    } catch (e) {
      console.error('记录释放收益失败:', e);
    }

    // 记录会员交易流水
    await client.from('transactions').insert({
      user_id: userId,
      order_id: orderId,
      type: 'sell_profit',
      amount: expectedProfit,
      balance: newBalance,
      description: `卖出产品收益¥${expectedProfit}到账智算金，Token值¥${purchasePrice}线下交易`,
    });

    return NextResponse.json({
      success: true,
      message: `收益¥${expectedProfit}已到账智算金，5%释放收益已分配`,
      data: {
        user: { beforeBalance: currentBalance, afterBalance: newBalance },
        profit: { totalProfit: expectedProfit },
        tokenValue: purchasePrice,
        releaseAmount,
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
