import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';

// 释放到期产品收益 - 所有角色的收益在到期后统一到账
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ success: false, message: '无效token' }, { status: 401 });
    }

    const body = await request.json();
    const { userProductId } = body;

    if (!userProductId) {
      return NextResponse.json({ success: false, message: '缺少用户产品ID' }, { status: 400 });
    }

    // 查询用户产品
    const userProduct = await queryOne<any>(
      `SELECT up.*, p.name as product_name, p.code as product_code, p.period, p.total_rate, p.profit_rate, p.market_rate, p.provider_id as product_provider_id
       FROM user_products up
       JOIN products p ON up.product_id = p.id
       WHERE up.id = $1`,
      [userProductId]
    );

    if (!userProduct) {
      return NextResponse.json({ success: false, message: '产品不存在' }, { status: 404 });
    }

    // 验证归属
    if (userProduct.user_id !== user.userId && user.role !== 'admin') {
      return NextResponse.json({ success: false, message: '无权操作此产品' }, { status: 403 });
    }

    // 检查是否已释放
    if (userProduct.revenue_released) {
      return NextResponse.json({ success: false, message: '收益已释放，不可重复操作' }, { status: 400 });
    }

    // 检查是否到期（到期当天中午12点解锁）
    const expireDate = new Date(userProduct.expire_date);
    const now = new Date();

    if (now < expireDate) {
      const remainingMs = expireDate.getTime() - now.getTime();
      const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
      const remainingDays = Math.floor(remainingHours / 24);
      const hoursLeft = remainingHours % 24;
      return NextResponse.json({
        success: false,
        message: `产品尚未到期，还需等待${remainingDays > 0 ? remainingDays + '天' : ''}${hoursLeft}小时`,
        data: {
          code: 'NOT_EXPIRED',
          expireDate: userProduct.expire_date,
          remainingHours
        }
      }, { status: 400 });
    }

    const purchasePrice = parseFloat(userProduct.purchase_price);
    const profitRate = parseFloat(userProduct.profit_rate || 0);
    const totalRate = parseFloat(userProduct.total_rate || 0);
    const marketRate = parseFloat(userProduct.market_rate || 0);

    // === 收益分配 ===
    // 总释放 = purchase_price * total_rate / 100
    const totalReleaseAmount = purchasePrice * (totalRate / 100);

    // 各角色分配比例（基于总释放金额）
    // 会员实际到手: profit_rate / total_rate
    // 剩余: market_rate / total_rate → 分配给服务商/直推/网点/总台

    const memberProfit = purchasePrice * (profitRate / 100);  // 会员收益
    const marketPool = purchasePrice * (marketRate / 100);     // 市场费池

    // 市场费池分配（market_rate 部分）
    const providerShare = marketPool * 0.70;     // 服务商 70%
    const directShare = marketPool * 0.10;       // 直推 10%
    const parentProviderShare = marketPool * 0.10; // 上级服务商 10%
    const branchShare = marketPool * 0.05;       // 网点 5%
    const companyShare = marketPool * 0.05;       // 总台 5%

    console.log('[RELEASE REVENUE] 释放收益:', {
      userProductId,
      purchasePrice,
      memberProfit,
      marketPool,
      providerShare,
      directShare,
      branchShare,
      companyShare
    });

    // 1. 会员收益到账（写入balance）
    const memberBefore = await queryOne<any>('SELECT balance FROM users WHERE id = $1', [userProduct.user_id]);
    const memberBalanceBefore = parseFloat(memberBefore?.balance || 0);
    await execute(
      `UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2`,
      [memberProfit, userProduct.user_id]
    );
    // 记录交易
    await execute(
      `INSERT INTO transactions (user_id, type, amount, description, balance_before, balance_after)
       VALUES ($1, 'profit_release', $2, $3, $4, $5)`,
      [userProduct.user_id, memberProfit,
       `产品「${userProduct.product_name}」到期释放收益${profitRate}%`,
       memberBalanceBefore, memberBalanceBefore + memberProfit]
    );

    // 2. 服务商收益到账
    const providerId = userProduct.product_provider_id;
    if (providerId && providerShare > 0) {
      const providerBefore = await queryOne<any>('SELECT balance FROM users WHERE id = $1', [providerId]);
      const providerBalanceBefore = parseFloat(providerBefore?.balance || 0);
      await execute(
        `UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2`,
        [providerShare, providerId]
      );
      await execute(
        `INSERT INTO transactions (user_id, type, amount, description, balance_before, balance_after)
         VALUES ($1, 'provider_revenue', $2, $3, $4, $5)`,
        [providerId, providerShare,
         `会员产品到期，服务商分成70%`,
         providerBalanceBefore, providerBalanceBefore + providerShare]
      );
    }

    // 3. 直推人收益到账
    const memberUser = await queryOne<any>('SELECT inviter_id FROM users WHERE id = $1', [userProduct.user_id]);
    if (memberUser?.inviter_id && directShare > 0) {
      const directBefore = await queryOne<any>('SELECT balance FROM users WHERE id = $1', [memberUser.inviter_id]);
      const directBalanceBefore = parseFloat(directBefore?.balance || 0);
      await execute(
        `UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2`,
        [directShare, memberUser.inviter_id]
      );
      await execute(
        `INSERT INTO transactions (user_id, type, amount, description, balance_before, balance_after)
         VALUES ($1, 'direct_referral_revenue', $2, $3, $4, $5)`,
        [memberUser.inviter_id, directShare,
         `直推会员产品到期，直推分成10%`,
         directBalanceBefore, directBalanceBefore + directShare]
      );
    }

    // 4. 上级服务商收益到账
    const memberData = await queryOne<any>('SELECT provider_id FROM users WHERE id = $1', [userProduct.user_id]);
    if (memberData?.provider_id && memberData.provider_id !== providerId && parentProviderShare > 0) {
      const parentBefore = await queryOne<any>('SELECT balance FROM users WHERE id = $1', [memberData.provider_id]);
      const parentBalanceBefore = parseFloat(parentBefore?.balance || 0);
      await execute(
        `UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2`,
        [parentProviderShare, memberData.provider_id]
      );
      await execute(
        `INSERT INTO transactions (user_id, type, amount, description, balance_before, balance_after)
         VALUES ($1, 'parent_provider_revenue', $2, $3, $4, $5)`,
        [memberData.provider_id, parentProviderShare,
         `下级会员产品到期，上级服务商分成10%`,
         parentBalanceBefore, parentBalanceBefore + parentProviderShare]
      );
    }

    // 5. 网点收益到账
    if (providerId) {
      const providerData = await queryOne<any>('SELECT branch_id FROM providers WHERE user_id = $1', [providerId]);
      if (providerData?.branch_id && branchShare > 0) {
        const branchBefore = await queryOne<any>('SELECT balance FROM users WHERE id = $1', [providerData.branch_id]);
        const branchBalanceBefore = parseFloat(branchBefore?.balance || 0);
        await execute(
          `UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2`,
          [branchShare, providerData.branch_id]
        );
        await execute(
          `INSERT INTO transactions (user_id, type, amount, description, balance_before, balance_after)
           VALUES ($1, 'branch_revenue', $2, $3, $4, $5)`,
          [providerData.branch_id, branchShare,
           `服务商会员产品到期，网点分成5%`,
           branchBalanceBefore, branchBalanceBefore + branchShare]
        );
      }
    }

    // 6. 总台运营收益到账
    const adminUser = await queryOne<any>('SELECT id FROM users WHERE role = $1 LIMIT 1', ['admin']);
    if (adminUser && companyShare > 0) {
      const adminBefore = await queryOne<any>('SELECT balance FROM users WHERE id = $1', [adminUser.id]);
      const adminBalanceBefore = parseFloat(adminBefore?.balance || 0);
      await execute(
        `UPDATE users SET balance = COALESCE(balance, 0) + $1, updated_at = NOW() WHERE id = $2`,
        [companyShare, adminUser.id]
      );
      await execute(
        `INSERT INTO transactions (user_id, type, amount, description, balance_before, balance_after)
         VALUES ($1, 'company_revenue', $2, $3, $4, $5)`,
        [adminUser.id, companyShare,
         '会员产品到期，总台运营分成5%',
         adminBalanceBefore, adminBalanceBefore + companyShare]
      );
    }

    // 7. 记录会员收益到 member_revenue 表
    const holdingHours = (now.getTime() - new Date(userProduct.purchase_date).getTime()) / (1000 * 60 * 60);
    const holdingDays = Math.max(1, Math.floor(holdingHours / 24));
    await execute(
      `INSERT INTO member_revenue 
       (user_id, user_product_id, principal, profit, total_amount, converted_to_energy, status, product_name, product_code, product_period, total_rate, profit_rate, market_rate, holding_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [userProduct.user_id, userProductId, purchasePrice, memberProfit, purchasePrice + memberProfit,
       0, 'available', userProduct.product_name, userProduct.product_code, userProduct.period,
       totalRate, profitRate, marketRate, holdingDays]
    );

    // 8. 标记收益已释放
    await execute(
      `UPDATE user_products SET revenue_released = true, updated_at = NOW() WHERE id = $1`,
      [userProductId]
    );

    // 9. 通知会员
    const supabaseModule = await import('@/lib/supabase-client');
    const { getSupabase } = supabaseModule;
    const supabase = getSupabase();
    await supabase.from('notifications').insert({
      receiver_id: userProduct.user_id,
      receiver_role: 'member',
      type: 'revenue_released',
      title: '收益已释放',
      content: `产品「${userProduct.product_name}」已到期，收益¥${memberProfit.toFixed(2)}已到账智算金`,
      is_read: false
    });

    // 获取会员最新余额
    const memberAfter = await queryOne<any>('SELECT balance FROM users WHERE id = $1', [userProduct.user_id]);

    return NextResponse.json({
      success: true,
      message: `收益已释放！会员收益¥${memberProfit.toFixed(2)}已到账`,
      data: {
        memberProfit,
        providerShare,
        directShare,
        branchShare,
        companyShare,
        totalReleased: totalReleaseAmount,
        revenueReleased: true,
        userBalance: parseFloat(memberAfter?.balance || 0)
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    console.error('[RELEASE REVENUE] 异常:', error);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
