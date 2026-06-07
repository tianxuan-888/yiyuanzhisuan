import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 获取服务商的收益记录 - 直接从user_products + products统计
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    let providerId = searchParams.get('providerId');

    if (!providerId) {
      const authUser = authenticateRequest(request);
      if (authUser) providerId = authUser.userId;
    }

    if (!providerId) {
      return NextResponse.json({ error: '缺少 providerId 参数' }, { status: 400 });
    }

    // 查询服务商信息
    const providerUser: any = await query(
      'SELECT id, username, balance FROM users WHERE id::text = $1',
      [providerId]
    );

    if (!providerUser || providerUser.length === 0) {
      return NextResponse.json({
        success: true,
        data: { records: [], stats: { totalRevenue: 0, balance: 0, totalWithdrawn: 0, totalConverted: 0, availableRevenue: 0 } }
      });
    }

    const userId = providerUser[0].id;
    const currentBalance = Number(providerUser[0].balance) || 0;

    // 1. 服务商2%产品分成 + 直推0.25%奖励 + 上级服务商0.25%分成
    // 从user_products(revenue_released=true)关联products和users直接计算
    let distRecords: any[] = [];
    let distSelfRevenue = 0;
    let distDirectReward = 0;
    let distParentShare = 0;
    try {
      const distSql = `
        SELECT 
          up.id::text,
          p.name as product_name,
          p.code as product_code,
          p.price::float as product_price,
          p.period,
          p.total_rate::float,
          p.market_rate::float,
          p.profit_rate::float,
          up.purchase_price::float,
          m.username as member_name,
          m.phone as member_phone,
          m.unique_id as member_unique_id,
          inv.username as inviter_name,
          up.created_at,
          up.revenue_released,
          -- 服务商2%分成
          (up.purchase_price * 2.0 / 100)::float as provider_share,
          -- 直推0.25%
          (up.purchase_price * 0.25 / 100)::float as direct_reward,
          -- 上级服务商0.25%
          (up.purchase_price * 0.25 / 100)::float as parent_provider_share,
          -- 总释放5%
          (up.purchase_price * 5.0 / 100)::float as total_release,
          CASE 
            WHEN m.inviter_id IS NOT NULL AND m.inviter_id::text != prv.user_id::text THEN inv.username
            ELSE NULL
          END as actual_inviter_name
        FROM user_products up
        JOIN products p ON p.id::text = up.product_id::text
        JOIN users m ON m.id::text = up.user_id::text
        LEFT JOIN providers prv ON prv.user_id::text = p.provider_id::text
        LEFT JOIN users inv ON inv.id::text = m.inviter_id
        WHERE up.revenue_released = true
          AND p.provider_id::text = $1
        ORDER BY up.created_at DESC
      `;
      distRecords = await query(distSql, [userId]);

      // 统计服务商自身2%分成
      distSelfRevenue = distRecords.reduce((sum: number, r: any) => sum + (Number(r.provider_share) || 0), 0);

      // 统计直推0.25%奖励（服务商是会员的直推人时）
      const directRewardSql = `
        SELECT COALESCE(SUM(up.purchase_price::float * 0.25 / 100), 0) as total
        FROM user_products up
        JOIN products p ON p.id::text = up.product_id::text
        JOIN users m ON m.id::text = up.user_id::text
        WHERE up.revenue_released = true
          AND m.inviter_id::text = $1
      `;
      const directResult: any = await query(directRewardSql, [userId]);
      distDirectReward = parseFloat(String(directResult?.[0]?.total || '0'));

      // 统计上级服务商0.25%分成（当前服务商是其他服务商的上级时）
      const parentShareSql = `
        SELECT COALESCE(SUM(up.purchase_price::float * 0.25 / 100), 0) as total
        FROM user_products up
        JOIN products p ON p.id::text = up.product_id::text
        JOIN providers sub_prv ON sub_prv.user_id::text = p.provider_id::text
        WHERE up.revenue_released = true
          AND sub_prv.parent_provider_id::text = $1
      `;
      const parentResult: any = await query(parentShareSql, [userId]);
      distParentShare = parseFloat(String(parentResult?.[0]?.total || '0'));
    } catch (e) {
      console.error('查询产品分成失败:', e);
    }

    // 2. 下级服务商分成
    let subordinateRecords: any[] = [];
    let subordinateRevenue = 0;
    try {
      const subSql = `
        SELECT 
          pss.id::text,
          'subordinate' as source,
          pss.split_amount::float as amount,
          pss.order_amount::float,
          pss.split_ratio::float as split_rate,
          sp.username as subordinate_name,
          sp.phone as subordinate_phone,
          pss.subordinate_count,
          pss.product_name,
          pss.created_at
        FROM provider_subordinate_split pss
        LEFT JOIN users sp ON sp.id::text = pss.provider_id::text
        WHERE pss.upper_provider_id::text = $1
        ORDER BY pss.created_at DESC
        LIMIT 50
      `;
      subordinateRecords = await query(subSql, [userId]);

      const subSumSql = `
        SELECT COALESCE(SUM(split_amount::float), 0) as total
        FROM provider_subordinate_split
        WHERE upper_provider_id::text = $1
      `;
      const subSumResult: any = await query(subSumSql, [userId]);
      subordinateRevenue = parseFloat(String(subSumResult?.[0]?.total || '0'));
    } catch {
      // 表可能不存在
    }

    // 3. 已提现金额
    let totalWithdrawn = 0;
    try {
      const withdrawnSql = `
        SELECT COALESCE(SUM(amount::float), 0) as total
        FROM withdrawals
        WHERE user_id::text = $1 AND user_role = 'provider' AND status IN ('pending', 'transferred', 'completed')
      `;
      const withdrawnResult: any = await query(withdrawnSql, [userId]);
      totalWithdrawn = parseFloat(String(withdrawnResult?.[0]?.total || '0'));
    } catch {
      totalWithdrawn = 0;
    }

    // 4. 已转为收益金额
    let totalConverted = 0;
    try {
      const convertedSql = `
        SELECT COALESCE(SUM(amount::float), 0) as total
        FROM energy_transactions
        WHERE from_user_id::text = $1 AND to_user_id::text = $1 AND type = 'revenue_convert'
      `;
      const convertedResult: any = await query(convertedSql, [userId]);
      totalConverted = parseFloat(String(convertedResult?.[0]?.total || '0'));
    } catch {
      totalConverted = 0;
    }

    // 总收益 = 产品分成 + 直推奖励 + 上级分成 + 下级分成
    const totalRevenue = distSelfRevenue + distDirectReward + distParentShare + subordinateRevenue;

    // 可用收益 = 总收益 - 已提现 - 已转收益
    const availableRevenue = Math.max(0, totalRevenue - totalWithdrawn - totalConverted);

    // 格式化收益记录
    const allRecords = [
      ...(distRecords || []).map((r: any) => {
        const totalRelease = Number(r.purchase_price) * 5.0 / 100;
        return {
          id: r.id,
          source: 'distribution',
          source_label: '产品分成',
          product_name: r.product_name,
          product_code: r.product_code,
          product_price: Number(r.purchase_price) || 0,
          period: r.period,
          total_rate: Number(r.total_rate) || 0,
          market_rate: Number(r.market_rate) || 0,
          profit_rate: Number(r.profit_rate) || 0,
          member_name: r.member_name,
          member_phone: r.member_phone,
          member_unique_id: r.member_unique_id,
          inviter_name: r.inviter_name,
          amount: Number(r.provider_share) || 0,
          provider_share: Number(r.provider_share) || 0,
          direct_reward: Number(r.direct_reward) || 0,
          parent_provider_share: Number(r.parent_provider_share) || 0,
          total_release: totalRelease,
          created_at: r.created_at,
        };
      }),
      ...(subordinateRecords || []).map((r: any) => ({
        ...r,
        source_label: '下级分成',
        amount: Number(r.amount) || 0,
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return NextResponse.json({
      success: true,
      data: {
        records: allRecords,
        stats: {
          totalRevenue,
          balance: currentBalance,
          totalWithdrawn,
          totalConverted,
          availableRevenue,
          distSelfRevenue,
          distDirectReward,
          distParentShare,
          subordinateRevenue,
          orderCount: allRecords.length,
        },
      }
    });
  } catch (error) {
    console.error('获取服务商收益记录失败:', error);
    return NextResponse.json({
      success: true,
      data: {
        records: [],
        stats: {
          totalRevenue: 0, balance: 0,
          totalWithdrawn: 0, totalConverted: 0, availableRevenue: 0, orderCount: 0,
        },
      }
    });
  }
}
