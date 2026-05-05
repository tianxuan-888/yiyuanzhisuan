import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 获取服务商的收益记录
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
        data: { records: [], stats: { totalRevenue: 0, energyRevenue: 0, withdrawRevenue: 0, rechargeRevenue: 0, subordinateRevenue: 0, balance: 0, energyValue: 0 } }
      });
    }

    const userId = providerUser[0].id;
    const currentBalance = Number(providerUser[0].balance) || 0;
    const currentEnergy = Number(providerUser[0].energy_value) || 0;

    // 1. 能量值收益（来自会员购买产品时的市场费分成 - energy_transactions type=transfer_in）
    const energyRevenueSql = `
      SELECT COALESCE(SUM(amount::float), 0) as total
      FROM energy_transactions
      WHERE to_user_id::text = $1 AND type = 'transfer_in'
    `;
    const energyRevenueResult: any = await query(energyRevenueSql, [userId]);
    const energyRevenue = parseFloat(String(energyRevenueResult?.[0]?.total || '0'));

    // 2. 提现到账金额（从 withdrawals 表获取已完成的提现）
    const withdrawRevenueSql = `
      SELECT COALESCE(SUM(actual_amount::float), 0) as total
      FROM withdrawals
      WHERE user_id::text = $1 AND status = 'completed'
    `;
    const withdrawRevenueResult: any = await query(withdrawRevenueSql, [userId]);
    const withdrawRevenue = parseFloat(String(withdrawRevenueResult?.[0]?.total || '0'));

    // 3. 能量值充值收益（给会员充值的记录 - 从 energy_transactions 中 type=recharge 且 from_user_id 为服务商）
    const rechargeRevenueSql = `
      SELECT COALESCE(SUM(amount::float), 0) as total
      FROM energy_transactions
      WHERE from_user_id::text = $1 AND type = 'recharge'
    `;
    const rechargeRevenueResult: any = await query(rechargeRevenueSql, [userId]);
    const rechargeRevenue = parseFloat(String(rechargeRevenueResult?.[0]?.total || '0'));

    // 4. 下级服务商分成（provider_subordinate_split）
    let subordinateRevenue = 0;
    try {
      const subordinateSql = `
        SELECT COALESCE(SUM(split_amount::float), 0) as total
        FROM provider_subordinate_split
        WHERE upper_provider_id::text = $1
      `;
      const subordinateResult: any = await query(subordinateSql, [userId]);
      subordinateRevenue = parseFloat(String(subordinateResult?.[0]?.total || '0'));
    } catch {
      subordinateRevenue = 0;
    }

    // 5. provider_revenue_distribution（如果有的话）
    let distSelfRevenue = 0;
    let distDirectReward = 0;
    let distParentShare = 0;
    try {
      const distSql = `
        SELECT 
          COALESCE(SUM(provider_share::float), 0) as self,
          COALESCE(SUM(CASE WHEN direct_reward_to::text = $1 THEN direct_reward::float ELSE 0 END), 0) as direct,
          COALESCE(SUM(CASE WHEN parent_provider_id::text = $1 THEN parent_provider_share::float ELSE 0 END), 0) as parent
        FROM provider_revenue_distribution
        WHERE provider_id::text = $1 OR direct_reward_to::text = $1 OR parent_provider_id::text = $1
      `;
      const distResult: any = await query(distSql, [userId]);
      distSelfRevenue = parseFloat(String(distResult?.[0]?.self || '0'));
      distDirectReward = parseFloat(String(distResult?.[0]?.direct || '0'));
      distParentShare = parseFloat(String(distResult?.[0]?.parent || '0'));
    } catch {
      // 表可能不存在
    }

    // 累计收益 = 能量值收益(市场费分成) + 下级分成 + 分配表收益
    // 注意：withdrawRevenue(已提现)是资金流出，rechargeRevenue(给会员充值)是能量转出，都不应计入收益
    const totalRevenue = energyRevenue + subordinateRevenue + distSelfRevenue + distDirectReward + distParentShare;

    // 6. 综合收益记录列表（从多个来源合并）
    // 来源A: 能量值转入记录
    const energyRecordsSql = `
      SELECT 
        et.id::text,
        'energy_income' as source,
        et.type,
        et.amount::float,
        et.note,
        et.created_at,
        u.username as from_username
      FROM energy_transactions et
      LEFT JOIN users u ON u.id::text = et.from_user_id::text
      WHERE et.to_user_id::text = $1 AND et.type IN ('transfer_in', 'quota_match', 'purchase')
      ORDER BY et.created_at DESC
      LIMIT 50
    `;
    const energyRecords = await query(energyRecordsSql, [userId]);

    // 来源B: 提现记录
    const withdrawRecordsSql = `
      SELECT 
        w.id::text,
        'withdraw' as source,
        'withdraw' as type,
        w.actual_amount::float as amount,
        w.note,
        w.created_at,
        NULL as from_username
      FROM withdrawals w
      WHERE w.user_id::text = $1
      ORDER BY w.created_at DESC
      LIMIT 50
    `;
    const withdrawRecords = await query(withdrawRecordsSql, [userId]);

    // 来源C: 给会员充值的记录
    const rechargeRecordsSql = `
      SELECT 
        et.id::text,
        'recharge' as source,
        'recharge' as type,
        et.amount::float,
        et.note,
        et.created_at,
        u.username as from_username
      FROM energy_transactions et
      LEFT JOIN users u ON u.id::text = et.to_user_id::text
      WHERE et.from_user_id::text = $1 AND et.type = 'recharge'
      ORDER BY et.created_at DESC
      LIMIT 50
    `;
    const rechargeRecords = await query(rechargeRecordsSql, [userId]);

    // 来源D: provider_revenue_distribution（如有）
    let distRecords: any[] = [];
    try {
      const distRecordsSql = `
        SELECT 
          prd.id::text,
          'distribution' as source,
          'distribution' as type,
          prd.provider_share::float as amount,
          prd.market_fee::float,
          prd.direct_reward::float,
          prd.parent_provider_share::float,
          p.name as product_name,
          m.username as member_name,
          m.phone as member_phone,
          prd.created_at
        FROM provider_revenue_distribution prd
        LEFT JOIN products p ON p.id::text = prd.product_id::text
        LEFT JOIN users m ON m.id::text = prd.member_id::text
        WHERE prd.provider_id::text = $1
        ORDER BY prd.created_at DESC
        LIMIT 50
      `;
      distRecords = await query(distRecordsSql, [userId]);
    } catch {
      // 表可能不存在
    }

    // 合并所有记录并按时间排序
    const allRecords = [
      ...(energyRecords || []).map((r: any) => ({
        ...r,
        source_label: '能量值收益',
        amount: Number(r.amount) || 0,
      })),
      ...(withdrawRecords || []).map((r: any) => ({
        ...r,
        source_label: '提现到账',
        amount: Number(r.amount) || 0,
      })),
      ...(rechargeRecords || []).map((r: any) => ({
        ...r,
        source_label: '会员充值',
        amount: Number(r.amount) || 0,
      })),
      ...(distRecords || []).map((r: any) => ({
        ...r,
        source_label: '产品分成',
        amount: Number(r.amount) || 0,
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return NextResponse.json({
      success: true,
      data: {
        records: allRecords,
        stats: {
          totalRevenue,
          energyRevenue,
          withdrawRevenue,
          rechargeRevenue,
          subordinateRevenue,
          distSelfRevenue,
          distDirectReward,
          distParentShare,
          balance: currentBalance,
          energyValue: currentEnergy,
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
          totalRevenue: 0, energyRevenue: 0, withdrawRevenue: 0,
          rechargeRevenue: 0, subordinateRevenue: 0, balance: 0, energyValue: 0, orderCount: 0,
        },
      }
    });
  }
}
