import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 审核流转（服务商审核）
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { transferId, action, reviewNote } = body;

    const reviewerId = user.userId;

    if (!transferId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '无效的审核动作' }, { status: 400 });
    }

    // 查询流转记录
    const transfer = await queryOne<any>(
      'SELECT * FROM product_transfers WHERE id = $1',
      [transferId]
    );

    if (!transfer) {
      return NextResponse.json({ error: '流转记录不存在' }, { status: 404 });
    }

    if (!['awaiting_payment', 'buyer_confirmed', 'seller_confirmed'].includes(transfer.status)) {
      return NextResponse.json({ error: '该流转已被处理或状态不允许审核' }, { status: 400 });
    }

    // 查询产品信息
    const product = await queryOne<any>(
      'SELECT * FROM products WHERE id = $1',
      [transfer.product_id]
    );

    if (!product) {
      return NextResponse.json({ error: '产品不存在' }, { status: 404 });
    }

    // 验证服务商权限
    const userAny = user as { role: string; userId?: string };
    if (userAny.role === 'provider' && product.provider_id !== userAny.userId) {
      return NextResponse.json({ error: '无权审核此流转' }, { status: 403 });
    }

    // ========== 拒绝审核 ==========
    if (action === 'reject') {
      await query(
        `UPDATE product_transfers SET status = 'rejected', updated_at = NOW() WHERE id = $1`,
        [transferId]
      );

      // 恢复用户产品状态为持有中
      const sellerUserProduct = await queryOne<any>(
        "SELECT id FROM user_products WHERE product_id = $1 AND user_id = $2 AND status = 'transferring'",
        [transfer.product_id, transfer.from_user_id]
      );
      if (sellerUserProduct) {
        await query(
          "UPDATE user_products SET status = 'holding', updated_at = NOW() WHERE id = $1",
          [sellerUserProduct.id]
        );
      }

      // 恢复产品状态
      await query(
        "UPDATE products SET status = 'available', updated_at = NOW() WHERE id = $1",
        [transfer.product_id]
      );

      return NextResponse.json({ success: true, message: '流转申请已拒绝' });
    }

    // ========== 审核通过 ==========
    
    if (transfer.status !== 'seller_confirmed') {
      return NextResponse.json({ 
        error: '卖家尚未确认收款，无法审核通过',
        data: { currentStatus: transfer.status }
      }, { status: 400 });
    }

    if (!transfer.to_user_id) {
      return NextResponse.json({ error: '买家信息缺失' }, { status: 400 });
    }

    const userProduct = await queryOne<any>(
      "SELECT * FROM user_products WHERE product_id = $1 AND user_id = $2 AND status IN ('transferring', 'pending_sell')",
      [transfer.product_id, transfer.from_user_id]
    );

    if (!userProduct) {
      return NextResponse.json({ error: '持仓记录不存在' }, { status: 404 });
    }

    const transferPrice = parseFloat(transfer.transfer_price) || parseFloat(product.price);
    const profitRate = parseFloat(product.profit_rate) || 0;

    // 卖家收益 = 本金 × profit_rate%
    const sellerProfit = Math.floor(transferPrice * profitRate / 100);

    // 查询买家信息
    const buyer = await queryOne<any>(
      'SELECT id, username, provider_id, inviter_id FROM users WHERE id = $1',
      [transfer.to_user_id]
    );

    if (!buyer) {
      return NextResponse.json({ error: '买家用户不存在' }, { status: 404 });
    }

    // ========== 总台释放5%收益，按7项分配（不再扣能量值） ==========
    const releaseRate = 0.05;
    const memberShare = Math.round(transferPrice * 0.02 * 100) / 100;
    const directShare = Math.round(transferPrice * 0.003 * 100) / 100;
    const providerShare = Math.round(transferPrice * 0.02 * 100) / 100;
    const parentProviderShare = Math.round(transferPrice * 0.003 * 100) / 100;
    const seniorProviderShare = Math.round(transferPrice * 0.0015 * 100) / 100;
    const branchShare = Math.round(transferPrice * 0.0015 * 100) / 100;
    const companyShare = Math.round(transferPrice * 0.001 * 100) / 100;
    const totalReleased = transferPrice * releaseRate;

    let distributionBranchId: string | null = null;
    let distributionParentProviderId: string | null = null;
    let distributionSeniorProviderId: string | null = null;

    // 1. 会员收益2%（买家）
    if (memberShare > 0) {
      await query(
        'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
        [memberShare, transfer.to_user_id]
      );
    }

    // 2. 直推人0.3%
    if (directShare > 0 && buyer.inviter_id) {
      await query(
        'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
        [directShare, buyer.inviter_id]
      );
    }

    // 3. 服务商2%
    if (providerShare > 0 && product.provider_id) {
      await query(
        'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
        [providerShare, product.provider_id]
      );
    }

    // 4. 上级服务商0.3%
    if (parentProviderShare > 0 && product.provider_id) {
      const providerUser = await queryOne<any>(
        'SELECT provider_id FROM users WHERE id = $1',
        [product.provider_id]
      );
      if (providerUser?.provider_id) {
        distributionParentProviderId = providerUser.provider_id;
        await query(
          'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
          [parentProviderShare, providerUser.provider_id]
        );
      }
    }

    // 5. 高级服务商0.15%
    if (seniorProviderShare > 0 && product.provider_id) {
      const currentProviderUser = await queryOne<any>(
        'SELECT provider_id FROM users WHERE id = $1',
        [product.provider_id]
      );
      if (currentProviderUser?.provider_id && currentProviderUser.provider_id !== distributionParentProviderId) {
        distributionSeniorProviderId = currentProviderUser.provider_id;
        await query(
          'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
          [seniorProviderShare, currentProviderUser.provider_id]
        );
      }
    }

    // 6. 服务网点0.15%
    if (branchShare > 0 && buyer.provider_id) {
      const providerInfo = await queryOne<any>(
        'SELECT branch_id FROM providers WHERE user_id = $1',
        [buyer.provider_id]
      );
      if (providerInfo?.branch_id) {
        distributionBranchId = providerInfo.branch_id;
        await query(
          'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
          [branchShare, providerInfo.branch_id]
        );
      }
    }

    // 7. 智算平台运营0.10%
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

    // 创建释放收益记录
    await query(
      `INSERT INTO release_records 
       (product_id, product_name, product_price, release_amount, release_rate,
        member_id, member_name, member_share,
        direct_referral_id, direct_referral_share,
        provider_id, provider_share,
        parent_provider_id, parent_provider_share,
        senior_provider_id, senior_provider_share,
        branch_id, branch_share, company_share)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        product.id, product.name, transferPrice, totalReleased, releaseRate,
        transfer.to_user_id, buyer.username || transfer.to_user_id, memberShare,
        buyer.inviter_id || null, directShare,
        product.provider_id, providerShare,
        distributionParentProviderId, distributionParentProviderId ? parentProviderShare : 0,
        distributionSeniorProviderId, distributionSeniorProviderId ? seniorProviderShare : 0,
        distributionBranchId, branchShare, companyShare
      ]
    );

    // ========== 产品转移 ==========
    // 更新流转状态为 completed
    await query(
      `UPDATE product_transfers SET status = 'completed', updated_at = NOW() WHERE id = $1`,
      [transferId]
    );

    // 更新卖家的用户产品状态为 transferred
    await query(
      "UPDATE user_products SET status = 'transferred', updated_at = NOW() WHERE id = $1",
      [userProduct.id]
    );

    // 为买家创建新的用户产品记录（不收市场费）
    const expectedProfit = Math.floor(transferPrice * profitRate / 100);
    const periodDays = product.period || 7;

    await query(
      `INSERT INTO user_products 
       (user_id, product_id, purchase_price, purchase_date, expire_date, expected_profit, market_fee, status, created_at)
       VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '1 day' * $4, $5, 0, 'holding', NOW())`,
      [transfer.to_user_id, transfer.product_id, transferPrice, periodDays, expectedProfit]
    );

    // 更新产品状态为已售出
    await query(
      "UPDATE products SET status = 'sold', updated_at = NOW() WHERE id = $1",
      [transfer.product_id]
    );

    // 发放收益给卖方（线上收益部分）
    if (sellerProfit > 0) {
      await query(
        'UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2',
        [sellerProfit, transfer.from_user_id]
      );

      await query(
        `INSERT INTO transactions (user_id, order_id, type, amount, created_at)
         VALUES ($1, NULL, 'sell_profit', $2, NOW())`,
        [transfer.from_user_id, sellerProfit]
      );
    }

    // 记录流转完成日志
    await query(
      `INSERT INTO transactions (user_id, order_id, type, amount, created_at)
       VALUES ($1, NULL, 'transfer_out', $2, NOW())`,
      [transfer.from_user_id, transferPrice]
    );

    // 记录买家购买日志
    await query(
      `INSERT INTO transactions (user_id, order_id, type, amount, created_at)
       VALUES ($1, NULL, 'transfer_in', $2, NOW())`,
      [transfer.to_user_id, transferPrice]
    );

    // 通知卖家流转完成
    await query(
      `INSERT INTO notifications (receiver_id, receiver_role, type, title, content, related_id, status, created_at)
       VALUES ($1, 'member', 'transfer_completed', '流转完成', $2, $3, 'unread', NOW())`,
      [
        transfer.from_user_id,
        `产品 ${product.name} 流转已完成，收益 ¥${sellerProfit} 已到账`,
        transferId
      ]
    );

    // 通知买家流转完成
    await query(
      `INSERT INTO notifications (receiver_id, receiver_role, type, title, content, related_id, status, created_at)
       VALUES ($1, 'member', 'transfer_completed', '流转完成', $2, $3, 'unread', NOW())`,
      [
        transfer.to_user_id,
        `产品 ${product.name} 流转已完成，您已获得产品持仓`,
        transferId
      ]
    );

    return NextResponse.json({
      success: true,
      message: '流转审核通过，产品已转移，收益已释放',
      data: {
        transferId,
        fromUser: transfer.from_user_id,
        toUser: transfer.to_user_id,
        productName: product.name,
        transferPrice,
        sellerProfit,
        releaseAmount: totalReleased,
      }
    });
  } catch (error) {
    console.error('审核流转失败:', error);
    const errorMessage = error instanceof Error ? error.message : '审核流转失败';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
