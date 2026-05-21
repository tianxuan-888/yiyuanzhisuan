import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 获取服务商的收益记录（仅市场业务收益）
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    let providerId = searchParams.get('providerId');

    if (!providerId) {
      const authUser = authenticateRequest(request);
      if (authUser) {
        providerId = authUser.userId;
      }
    }

    if (!providerId) {
      return NextResponse.json({ error: '缺少 providerId 参数' }, { status: 400 });
    }

    // 查询服务商的用户信息
    const providerUser: any = await query(
      'SELECT id, username, balance, energy_value FROM users WHERE id::text = $1',
      [providerId]
    );

    if (!providerUser || providerUser.length === 0) {
      return NextResponse.json({
        success: true,
        data: { records: [], stats: { totalRevenue: 0, balance: 0, energyValue: 0, totalWithdrawn: 0, totalConverted: 0, availableRevenue: 0 } }
      });
    }

    const userId = providerUser[0].id;
    const currentBalance = Number(providerUser[0].balance) || 0;
    const currentEnergy = Number(providerUser[0].energy_value) || 0;

    // 1. 产品分成收益（provider_revenue_distribution）
    let distRecords: any[] = [];
    let distSelfRevenue = 0;
    let distDirectReward = 0;
    let distParentShare = 0;
    try {
      const distSql = `
        SELECT 
          prd.id::text,
          'distribution' as source,
          prd.provider_share::float as amount,
          prd.market_fee::float,
          prd.direct_reward::float,
          prd.parent_provider_share::float,
          prd.product_price::float,
          p.name as product_name,
          p.code as product_code,
          m.username as member_name,
          m.phone as member_phone,
          prd.created_at
        FROM provider_revenue_distribution prd
        LEFT JOIN products p ON p.id::text = prd.product_id::text
        LEFT JOIN users m ON m.id::text = prd.member_id::text
        WHERE prd.provider_id::text = $1
        ORDER BY prd.created_at DESC
        LIMIT 100
      `;
      distRecords = await query(distSql, [userId]);

      const distSumSql = `
        SELECT 
          COALESCE(SUM(provider_share::float), 0) as self,
          COALESCE(SUM(CASE WHEN direct_reward_to::text = $1 THEN direct_reward::float ELSE 0 END), 0) as direct,
          COALESCE(SUM(CASE WHEN parent_provider_id::text = $1 THEN parent_provider_share::float ELSE 0 END), 0) as parent
        FROM provider_revenue_distribution
        WHERE provider_id::text = $1 OR direct_reward_to::text = $1 OR parent_provider_id::text = $1
      `;
      const distSumResult: any = await query(distSumSql, [userId]);
      distSelfRevenue = parseFloat(String(distSumResult?.[0]?.self || '0'));
      distDirectReward = parseFloat(String(distSumResult?.[0]?.direct || '0'));
      distParentShare = parseFloat(String(distSumResult?.[0]?.parent || '0'));
    } catch {
      // 表可能不存在
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

    // 合并所有记录并按时间排序
    const allRecords = [
      ...(distRecords || []).map((r: any) => ({
        ...r,
        source_label: '产品分成',
        amount: Number(r.amount) || 0,
        market_fee: Number(r.market_fee) || 0,
        direct_reward: Number(r.direct_reward) || 0,
        parent_provider_share: Number(r.parent_provider_share) || 0,
        product_price: Number(r.product_price) || 0,
      })),
      ...(subordinateRecords || []).map((r: any) => ({
        ...r,
        source_label: '下级分成',
        amount: Number(r.amount) || 0,
        transaction_amount: Number(r.transaction_amount) || 0,
        split_rate: Number(r.split_rate) || 0,
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return NextResponse.json({
      success: true,
      data: {
        records: allRecords,
        stats: {
          totalRevenue,
          balance: currentBalance,
          energyValue: currentEnergy,
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
          totalRevenue: 0, balance: 0, energyValue: 0,
          totalWithdrawn: 0, totalConverted: 0, availableRevenue: 0, orderCount: 0,
        },
      }
    });
  }
}
