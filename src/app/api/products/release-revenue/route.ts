import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';

// 释放到期产品收益 - 到期当天中午12:00后自动释放，所有角色收益统一到账
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ success: false, message: '无效token' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, userProductId } = body;

    // 支持两种模式：
    // 1. 传 userProductId → 释放单个产品
    // 2. 传 userId → 批量释放该用户所有到期未释放的产品
    if (!userId && !userProductId) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 });
    }

    // 验证操作权限
    if (userId && user.role !== 'admin' && user.userId !== userId) {
      return NextResponse.json({ success: false, message: '无权操作' }, { status: 403 });
    }

    const now = new Date();

    // 获取待释放的产品列表
    let productsToRelease: any[] = [];

    if (userProductId) {
      // 单个产品模式
      const userProduct = await queryOne<any>(
        `SELECT up.*, p.name as product_name, p.code as product_code, p.period, p.total_rate, p.profit_rate, p.market_rate, p.provider_id as product_provider_id
         FROM user_products up
         JOIN products p ON up.product_id = p.id
         WHERE up.id = $1`,
        [userProductId]
      );
      if (userProduct) {
        productsToRelease = [userProduct];
      }
    } else {
      // 批量模式：查找该用户所有到期未释放的产品
      productsToRelease = await query(
        `SELECT up.*, p.name as product_name, p.code as product_code, p.period, p.total_rate, p.profit_rate, p.market_rate, p.provider_id as product_provider_id
         FROM user_products up
         JOIN products p ON up.product_id = p.id
         WHERE up.user_id = $1 AND up.revenue_released = false AND up.status IN ('holding', 'transferred', 'pending_sell', 'sold')`,
        [userId]
      );
    }

    if (productsToRelease.length === 0) {
      return NextResponse.json({ success: true, message: '没有待释放的产品', data: { released: 0 } });
    }

    // 过滤出真正到期的产品（到期当天中午12:00后）
    const expiredProducts = productsToRelease.filter((up: any) => {
      if (!up.expire_date) return false;
      const expireDate = new Date(up.expire_date);
      const unlockTime = new Date(expireDate);
      unlockTime.setHours(12, 0, 0, 0);
      return now >= unlockTime;
    });

    if (expiredProducts.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: '暂无到期产品需要释放收益', 
        data: { released: 0 } 
      });
    }

    let totalMemberProfit = 0;
    const releasedProducts: string[] = [];

    for (const userProduct of expiredProducts) {
      // 跳过已释放的
      if (userProduct.revenue_released) continue;

      const purchasePrice = parseFloat(userProduct.purchase_price);
      const profitRate = parseFloat(userProduct.profit_rate || 0);
      const totalRate = parseFloat(userProduct.total_rate || 0);
      const marketRate = parseFloat(userProduct.market_rate || 0);

      // 查找服务商和网点信息
      const providerId = userProduct.product_provider_id;
      let providerData: any = null;
      let branchId: string | null = null;
      if (providerId) {
        providerData = await queryOne<any>('SELECT branch_id FROM providers WHERE user_id = $1', [providerId]);
        branchId = providerData?.branch_id || null;
      }

      const memberProfit = purchasePrice * (profitRate / 100);
      const marketPool = purchasePrice * (marketRate / 100);

      // 收益分配（按用户确认的5%分配逻辑，各角色占产品价格的固定百分比）
      // 合计5%：会员2% + 服务商2% + 直推0.25% + 上级服务商0.25% + 网点0.1% + 公司0.4%
      const memberShare = purchasePrice * 0.02;        // 会员 2%
      const providerShare = purchasePrice * 0.02;      // 服务商 2%
      const directShare = purchasePrice * 0.0025;      // 直推 0.25%
      const parentProviderShare = purchasePrice * 0.0025; // 上级服务商 0.25%
      const branchShare = purchasePrice * 0.001;       // 网点 0.1%
      const companyShare = purchasePrice * 0.004;      // 总台 0.4%

      console.log('[RELEASE REVENUE] 释放收益:', {
        userProductId: userProduct.id,
        purchasePrice,
        memberProfit,
        marketPool,
        providerShare,
        directShare,
        branchShare,
        companyShare
      });

      // 1. 会员收益到账 = profit_rate收益 + 市场费池40%返还（写入energy_value智算金）
      const memberTotalGain = memberProfit + memberShare;
      await execute(
        `UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2`,
        [memberTotalGain, userProduct.user_id]
      );
      // 写入energy_transactions明细 - 收益部分
      await execute(
        `INSERT INTO energy_transactions (user_id, type, amount, note, created_at)
         VALUES ($1, 'profit_release', $2, $3, NOW())`,
        [userProduct.user_id, memberProfit,
         `产品「${userProduct.product_name}」到期释放收益${profitRate}%`]
      );
      // 写入energy_transactions明细 - 市场费返还部分
      if (memberShare > 0) {
        await execute(
          `INSERT INTO energy_transactions (user_id, type, amount, note, created_at)
           VALUES ($1, 'market_fee_return', $2, $3, NOW())`,
          [userProduct.user_id, memberShare,
           `产品「${userProduct.product_name}」市场费返还2%`]

        );
      }

      // 2. 服务商收益到账（写入energy_value智算金）
      if (providerId && providerShare > 0) {
        await execute(
          `UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2`,
          [providerShare, providerId]
        );
        await execute(
          `INSERT INTO energy_transactions (user_id, type, amount, note, created_at)
           VALUES ($1, 'provider_revenue', $2, $3, NOW())`,
          [providerId, providerShare, '会员产品到期，服务商分成2%']
        );
      }

      // 3. 直推人收益到账（写入energy_value智算金）
      const memberUser = await queryOne<any>('SELECT inviter_id, username, real_name FROM users WHERE id = $1', [userProduct.user_id]);
      if (memberUser?.inviter_id && directShare > 0) {
        await execute(
          `UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2`,
          [directShare, memberUser.inviter_id]
        );
        await execute(
          `INSERT INTO energy_transactions (user_id, type, amount, note, created_at)
           VALUES ($1, 'direct_referral_revenue', $2, $3, NOW())`,
          [memberUser.inviter_id, directShare, '直推会员产品到期，直推分成0.25%']
        );
      }

      // 4. 上级服务商收益到账（写入energy_value智算金）
      const memberData = await queryOne<any>('SELECT provider_id FROM users WHERE id = $1', [userProduct.user_id]);
      if (memberData?.provider_id && memberData.provider_id !== providerId && parentProviderShare > 0) {
        await execute(
          `UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2`,
          [parentProviderShare, memberData.provider_id]
        );
        await execute(
          `INSERT INTO energy_transactions (user_id, type, amount, note, created_at)
           VALUES ($1, 'parent_provider_revenue', $2, $3, NOW())`,
          [memberData.provider_id, parentProviderShare, '下级会员产品到期，上级服务商分成0.25%']
        );
      }

      // 5. 网点收益到账（写入energy_value智算金）
      if (branchId && branchShare > 0) {
          await execute(
            `UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2`,
            [branchShare, branchId]
          );
          await execute(
            `INSERT INTO energy_transactions (user_id, type, amount, note, created_at)
             VALUES ($1, 'branch_revenue', $2, $3, NOW())`,
            [branchId, branchShare, '服务商会员产品到期，网点分成0.1%']
          );
      }

      // 6. 总台运营收益到账（写入energy_value智算金）
      const adminUser = await queryOne<any>('SELECT id FROM users WHERE role = $1 LIMIT 1', ['admin']);
      if (adminUser && companyShare > 0) {
        await execute(
          `UPDATE users SET energy_value = COALESCE(energy_value, 0) + $1, updated_at = NOW() WHERE id = $2`,
          [companyShare, adminUser.id]
        );
        await execute(
          `INSERT INTO energy_transactions (user_id, type, amount, note, created_at)
           VALUES ($1, 'company_revenue', $2, $3, NOW())`,
          [adminUser.id, companyShare, '会员产品到期，总台运营分成0.4%']
        );
      }

      // 7. 记录会员收益到 member_revenue 表
      const holdingHours = (now.getTime() - new Date(userProduct.purchase_date).getTime()) / (1000 * 60 * 60);
      const holdingDays = Math.max(1, Math.floor(holdingHours / 24));
      await execute(
        `INSERT INTO member_revenue 
         (user_id, user_product_id, principal, profit, total_amount, converted_to_energy, status, product_name, product_code, product_period, total_rate, profit_rate, market_rate, holding_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [userProduct.user_id, userProduct.id, purchasePrice, memberTotalGain, purchasePrice + memberTotalGain,
         0, 'available', userProduct.product_name, userProduct.product_code, userProduct.period,
         totalRate, profitRate, marketRate, holdingDays]
      );

      // 8. 写入 release_records 表（总公司收益记录）
      await execute(
        `INSERT INTO release_records 
         (product_id, product_name, product_price, release_amount, release_rate,
          member_id, member_name, member_share, direct_referral_id, direct_referral_share,
          provider_id, provider_share, parent_provider_id, parent_provider_share,
          branch_id, branch_share, company_share, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())`,
        [
          userProduct.product_id,
          userProduct.product_name,
          purchasePrice,
          marketPool,
          marketRate,
          userProduct.user_id,
          memberUser?.username || memberUser?.real_name || '',
          memberTotalGain,
          memberUser?.inviter_id || null,
          directShare,
          providerId || null,
          providerShare,
          null,
          parentProviderShare,
          branchId,
          branchShare,
          companyShare
        ]
      );

      // 9. 写入 provider_revenue_distribution 表（总公司财务报表数据来源）
      await execute(
        `INSERT INTO provider_revenue_distribution 
         (provider_id, member_id, product_id, product_name, product_price, purchase_price, 
          market_rate, market_fee, provider_share, direct_referral_share, parent_provider_share, 
          branch_share, company_share, member_profit, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'completed', NOW())`,
        [
          providerId || null,
          userProduct.user_id,
          userProduct.product_id,
          userProduct.product_name,
          purchasePrice,
          purchasePrice,
          marketRate,
          marketPool,
          providerShare,
          directShare,
          parentProviderShare,
          branchShare,
          companyShare,
          memberTotalGain
        ]
      );

      // 10. 标记收益已释放
      await execute(
        `UPDATE user_products SET revenue_released = true, updated_at = NOW() WHERE id = $1`,
        [userProduct.id]
      );

      // 9. 通知会员
      try {
        const supabaseModule = await import('@/lib/supabase-client');
        const { getSupabase } = supabaseModule;
        const supabase = getSupabase();
        await supabase.from('notifications').insert({
          receiver_id: userProduct.user_id,
          receiver_role: 'member',
          type: 'revenue_released',
          title: '收益已释放',
          content: `产品「${userProduct.product_name}」已到期，收益¥${memberTotalGain.toFixed(2)}已到账智算金`,
          is_read: false
        });
      } catch (e) {
        console.error('[RELEASE REVENUE] 通知发送失败:', e);
      }

      totalMemberProfit += memberProfit;
      releasedProducts.push(userProduct.id);
    }

    // 获取会员最新余额
    const memberAfter = await queryOne<any>('SELECT energy_value FROM users WHERE id = $1', [userId || expiredProducts[0]?.user_id]);

    return NextResponse.json({
      success: true,
      message: `已释放${releasedProducts.length}个产品的收益，会员收益合计¥${totalMemberProfit.toFixed(2)}已到账`,
      data: {
        released: releasedProducts.length,
        totalMemberProfit,
        revenueReleased: true,
        userEnergyValue: parseFloat(memberAfter?.energy_value || 0)
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    console.error('[RELEASE REVENUE] 异常:', error);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
