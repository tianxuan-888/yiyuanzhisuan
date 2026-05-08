import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 买家购买流转产品
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, transferId } = body;

    if (!userId || !transferId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (user.role !== 'admin' && user.userId !== userId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    // 查询流转记录
    const transfer = await queryOne<any>(
      'SELECT * FROM product_transfers WHERE id = $1',
      [transferId]
    );

    if (!transfer) {
      return NextResponse.json({ error: '流转记录不存在' }, { status: 404 });
    }

    // 验证流转状态
    if (transfer.status !== 'pending') {
      return NextResponse.json({ error: '该流转已结束或已有买家' }, { status: 400 });
    }

    // 验证是否过期
    if (transfer.expires_at && new Date(transfer.expires_at) < new Date()) {
      return NextResponse.json({ error: '该流转已过期' }, { status: 400 });
    }

    // 验证不能购买自己的流转
    if (transfer.from_user_id === userId) {
      return NextResponse.json({ error: '不能购买自己发布的流转' }, { status: 400 });
    }

    // 查询产品信息
    const product = await queryOne<any>(
      'SELECT * FROM products WHERE id = $1',
      [transfer.product_id]
    );

    if (!product) {
      return NextResponse.json({ error: '产品不存在' }, { status: 404 });
    }

    // ========== 计算市场费（从产品market_rate读取） ==========
    const marketRate = parseFloat(product.market_rate) || 0;
    const transferPrice = parseFloat(transfer.transfer_price) || parseFloat(product.price);
    const marketFee = Math.floor(transferPrice * marketRate / 100);

    // 计算买家预期收益（从产品profit_rate读取）
    const profitRate = parseFloat(product.profit_rate) || 0;
    const expectedProfit = Math.floor(transferPrice * profitRate / 100);

    // 查询买家能量值余额
    const buyer = await queryOne<any>(
      'SELECT id, username, energy_value, provider_id, inviter_id FROM users WHERE id = $1',
      [userId]
    );

    if (!buyer) {
      return NextResponse.json({ error: '买家用户不存在' }, { status: 404 });
    }

    // 验证买家能量值是否足够支付市场费
    if (marketFee > 0 && parseFloat(buyer.energy_value) < marketFee) {
      return NextResponse.json({
        error: `能量值不足，需要 ${marketFee} 能量值支付市场费`,
        data: {
          required: marketFee,
          current: parseFloat(buyer.energy_value),
          shortfall: marketFee - parseFloat(buyer.energy_value),
        }
      }, { status: 400 });
    }

    // ========== 扣除买家能量值 ==========
    if (marketFee > 0) {
      await query(
        'UPDATE users SET energy_value = GREATEST(0, energy_value - $1), updated_at = NOW() WHERE id = $2',
        [marketFee, userId]
      );

      // 记录能量值流水
      await query(
        `INSERT INTO energy_transactions (type, amount, from_user_id, to_user_id, description, created_at)
         VALUES ('transfer_out', $1, $2, NULL, $3, NOW())`,
        [marketFee, userId, `购买流转产品 ${product.name} 支付市场费 ${marketFee}`]
      );
    }

    // ========== 市场费按比例分成到各角色balance ==========
    if (marketFee > 0) {
      // 分配比例：服务商70% 直推10% 上级服务商10% 分公司5% 总公司5%
      const providerShare = Math.floor(marketFee * 0.70);
      const directReferralShare = Math.floor(marketFee * 0.10);
      const upstreamProviderShare = Math.floor(marketFee * 0.10);
      const branchShare = Math.floor(marketFee * 0.05);
      const companyShare = Math.floor(marketFee * 0.05);

      // 1. 服务商获得70%
      if (providerShare > 0 && product.provider_id) {
        await query(
          'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
          [providerShare, product.provider_id]
        );
      }

      // 2. 直推人获得10%（买家的推荐人）
      if (directReferralShare > 0 && buyer.inviter_id) {
        await query(
          'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
          [directReferralShare, buyer.inviter_id]
        );
      }

      // 3. 上级服务商获得10%（服务商的上级服务商）
      if (upstreamProviderShare > 0 && product.provider_id) {
        const providerUser = await queryOne<any>(
          'SELECT provider_id FROM users WHERE id = $1',
          [product.provider_id]
        );
        if (providerUser?.provider_id) {
          await query(
            'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
            [upstreamProviderShare, providerUser.provider_id]
          );
        }
      }

      // 4. 分公司获得5%
      if (branchShare > 0 && buyer.provider_id) {
        const providerInfo = await queryOne<any>(
          'SELECT branch_id FROM providers WHERE user_id = $1',
          [buyer.provider_id]
        );
        if (providerInfo?.branch_id) {
          await query(
            'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
            [branchShare, providerInfo.branch_id]
          );
        }
      }

      // 5. 总公司获得5%
      if (companyShare > 0) {
        const adminUser = await queryOne<any>(
          "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
        );
        if (adminUser) {
          await query(
            'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
            [companyShare, adminUser.id]
          );
        }
      }

      // 记录市场费分配
      await query(
        `INSERT INTO provider_revenue_distribution 
         (provider_id, user_id, order_type, total_market_fee, provider_amount, direct_referral_amount, upstream_provider_amount, branch_amount, company_amount, created_at)
         VALUES ($1, $2, 'transfer', $3, $4, $5, $6, $7, $8, NOW())`,
        [
          product.provider_id, userId, marketFee,
          providerShare, directReferralShare, upstreamProviderShare,
          branchShare, companyShare
        ]
      );
    }

    // ========== 更新流转记录状态 ==========
    await query(
      `UPDATE product_transfers 
       SET to_user_id = $1, status = 'awaiting_payment', market_fee = $2, expected_profit = $3, updated_at = NOW()
       WHERE id = $4`,
      [userId, marketFee, expectedProfit, transferId]
    );

    return NextResponse.json({
      success: true,
      message: '购买申请已提交，请线下付款给卖家',
      data: {
        transferId,
        transferPrice,
        marketFee,
        expectedProfit,
        profitRate,
        marketRate,
        sellerId: transfer.from_user_id,
        // 卖家信息用于线下付款
        sellerInfo: await getSellerInfo(transfer.from_user_id),
      }
    });
  } catch (error) {
    console.error('购买流转失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

async function getSellerInfo(sellerId: string) {
  const seller = await queryOne<any>(
    'SELECT id, username, phone, real_name, alipay_account FROM users WHERE id = $1',
    [sellerId]
  );
  if (!seller) return null;
  return {
    username: seller.username,
    phone: seller.phone,
    realName: seller.real_name,
    alipayAccount: seller.alipay_account,
  };
}
