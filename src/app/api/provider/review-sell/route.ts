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

// 审核会员卖出申请（服务商审核，确认后总台释放5%收益）
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
          sell_price: purchasePrice,
          sell_date: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', userProductId);

      // 会员收益：只有收益部分 → energy_value（智算金），Token值随产品流转
      const currentEnergy = await queryOne('SELECT energy_value FROM users WHERE id = $1', [userProduct.user_id]);
      const currentEnergyVal = parseFloat(String(currentEnergy?.energy_value || 0));
      const newEnergyVal = Math.round((currentEnergyVal + expectedProfit) * 100) / 100;
      await execute('UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2', [newEnergyVal, userProduct.user_id]);

      // ========== 卖出时：会员获得延迟2%收益（其他3%已在购买时到账） ==========
      const productPrice = purchasePrice;
      const deferredMemberShare = Math.round(productPrice * 0.02 * 100) / 100;

      // 会员2%延迟收益到账
      if (deferredMemberShare > 0) {
        const mRow = await queryOne('SELECT energy_value FROM users WHERE id = $1', [userProduct.user_id]);
        if (mRow) {
          const newMEnergy = Math.round((parseFloat(String(mRow.energy_value)) + deferredMemberShare) * 100) / 100;
          await execute('UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2', [newMEnergy, userProduct.user_id]);
        }
      }

      // 记录释放收益
      const releaseAmount = productPrice * 0.05;
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
            userProduct.product_id, productName, productPrice, releaseAmount,
            userProduct.user_id, productUser.username || userProduct.user_id, deferredMemberShare,
            null, 0,
            null, 0,
            null, 0,
            null, 0,
            0
          ]
        );
      } catch (e) {
        console.error('记录释放收益失败:', e);
      }

      // 记录会员智算金流水
      await execute(
        `INSERT INTO energy_transactions (user_id, type, amount, note, created_at)
         VALUES ($1, 'profit_release', $2, $3, NOW())`,
        [userProduct.user_id, expectedProfit, `卖出产品收益¥${expectedProfit}到账智算金，Token值¥${purchasePrice}线下交易`]
      );

      return NextResponse.json({
        success: true,
        message: '审核通过，收益已到账智算金，5%释放收益已分配',
        data: {
          status: 'sold',
          profit: expectedProfit,
          tokenValue: purchasePrice,
          releaseAmount,
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
