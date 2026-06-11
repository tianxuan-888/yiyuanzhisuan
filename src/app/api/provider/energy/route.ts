import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';

// 获取服务商的智算金和余额信息
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const userId = authUser.userId;

    // 查询用户的智算金和余额
    const user: any = await queryOne(
      'SELECT id, energy_value, balance, points FROM users WHERE id::text = $1',
      [userId]
    );

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    const energyValue = Number(user.energy_value) || 0;
    const balance = Number(user.balance) || 0;
    const points = Number(user.points) || 0;

    // 查询收益构成
    // 先查出当前用户的 providers.id（parent_provider_id 存的是 providers.id，不是 user_id）
    const myProviderRecord: any = await queryOne(
      'SELECT id::text as provider_record_id FROM providers WHERE user_id::text = $1',
      [userId]
    );
    const myProviderRecordId = myProviderRecord?.provider_record_id || null;

    let businessReward = 0;
    let directReward = 0;
    let cultivateReward = 0;
    try {
      const distSum: any = await query(
        `SELECT 
          COALESCE(SUM(provider_share::float), 0) as business,
          COALESCE(SUM(CASE WHEN direct_reward_to::text = $1 THEN direct_reward::float ELSE 0 END), 0) as direct,
          COALESCE(SUM(CASE WHEN parent_provider_id::text = $2 THEN parent_provider_share::float ELSE 0 END), 0) as parent
        FROM provider_revenue_distribution
        WHERE provider_id::text = $1 OR direct_reward_to::text = $1 OR parent_provider_id::text = $2`,
        [userId, myProviderRecordId]
      );
      if (distSum && distSum.length > 0) {
        businessReward = parseFloat(String(distSum[0].business || '0'));
        directReward = parseFloat(String(distSum[0].direct || '0'));
        cultivateReward = parseFloat(String(distSum[0].parent || '0'));
      }
    } catch {
      // 表可能不存在
    }

    // 查询服务商额度信息
    let quota = 0;
    let usedQuota = 0;
    let totalSales = 0;
    try {
      const providerInfo: any = await queryOne(
        'SELECT quota, used_quota, total_sales FROM providers WHERE user_id::text = $1',
        [userId]
      );
      if (providerInfo) {
        quota = Number(providerInfo.quota) || 0;
        usedQuota = Number(providerInfo.used_quota) || 0;
        totalSales = Number(providerInfo.total_sales) || 0;
      }
    } catch {
      // providers表可能不存在
    }

    // 收益记录（包括作为直接服务商 + 作为上级服务商的分成记录）
    let records: any[] = [];
    try {
      const distRecords: any = await query(
        `SELECT 
          prd.id::text,
          prd.provider_share::float as amount,
          p.name as product_name,
          p.code as product_code,
          m.username as member_name,
          prd.created_at,
          prd.parent_provider_share::float,
          CASE WHEN prd.parent_provider_id::text = $2 THEN 'upstream_share' ELSE 'provider_share' END as record_type
        FROM provider_revenue_distribution prd
        LEFT JOIN products p ON p.id::text = prd.product_id::text
        LEFT JOIN users m ON m.id::text = prd.member_id::text
        WHERE prd.provider_id::text = $1 OR prd.parent_provider_id::text = $2
        ORDER BY prd.created_at DESC
        LIMIT 100`,
        [userId, myProviderRecordId]
      );
      records = (distRecords || []).map((r: any) => ({
        ...r,
        amount: r.record_type === 'upstream_share' ? Number(r.parent_provider_share) || 0 : Number(r.amount) || 0,
        recordType: r.record_type,
        recordTypeLabel: r.record_type === 'upstream_share' ? '下级服务商分成(0.25%)' : '服务商分成(2%)',
      }));
    } catch {
      // 表可能不存在
    }

    return NextResponse.json({
      success: true,
      data: {
        balance,
        energyValue,
        points,
        revenue: balance,
        quota,
        usedQuota,
        totalSales,
        breakdown: {
          businessReward,
          directReward,
          cultivateReward,
        },
        stats: {
          totalRevenue: businessReward + directReward + cultivateReward,
          businessReward,
          directReward,
          cultivateReward,
        },
        records,
      }
    });
  } catch (error) {
    console.error('获取服务商智算金信息失败:', error);
    return NextResponse.json({
      success: true,
      data: {
        balance: 0, energyValue: 0, points: 0, revenue: 0,
        quota: 0, usedQuota: 0, totalSales: 0,
        breakdown: { businessReward: 0, directReward: 0, cultivateReward: 0 },
        stats: { totalRevenue: 0, businessReward: 0, directReward: 0, cultivateReward: 0 },
        records: [],
      }
    });
  }
}
