import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

/**
 * 获取网点收益记录
 * 网点收益来源：
 * 1. 产品分成0.1% - 每笔解锁的产品都有
 * 2. 无上级服务商分成0.25% - 当服务商没有上级服务商时，上级0.25%归网点
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    let branchId = searchParams.get('branchId');

    if (!branchId) {
      const authUser = authenticateRequest(request);
      if (authUser) branchId = authUser.userId;
    }

    if (!branchId) {
      return NextResponse.json({ error: '缺少 branchId 参数' }, { status: 400 });
    }

    // 查网点信息
    const branchUser: any = await query(
      'SELECT id, username, balance FROM users WHERE id::text = $1',
      [branchId]
    );

    if (!branchUser || branchUser.length === 0) {
      return NextResponse.json({
        success: true,
        data: { records: [], stats: { totalRevenue: 0, balance: 0, totalWithdrawn: 0, availableRevenue: 0 } }
      });
    }

    const userId = branchUser[0].id;
    const currentBalance = Number(branchUser[0].balance) || 0;

    // 1. 查询该网点下所有服务商的parent_provider_id情况
    let providersWithoutParent: Set<string> = new Set();
    try {
      const providerCheck: any = await query(
        `SELECT user_id::text FROM providers WHERE branch_id::text = $1 AND (parent_provider_id IS NULL OR parent_provider_id = '')`,
        [userId]
      );
      for (const p of providerCheck || []) {
        providersWithoutParent.add(p.user_id);
      }
    } catch (e) {
      console.error('查询服务商上级信息失败:', e);
    }

    // 2. 从user_products(revenue_released=true)关联products计算收益
    let revenueRecords: any[] = [];
    let totalRevenue = 0;
    try {
      const sql = `
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
          pv.username as provider_name,
          pv.unique_id as provider_unique_id,
          pv.id::text as provider_id,
          up.created_at,
          -- 网点0.1%分成
          (up.purchase_price::float * 0.1 / 100)::float as branch_share,
          -- 总释放5%
          (up.purchase_price::float * 5.0 / 100)::float as total_release,
          -- 会员2%
          (up.purchase_price::float * 2.0 / 100)::float as member_share,
          -- 服务商2%
          (up.purchase_price::float * 2.0 / 100)::float as provider_share,
          -- 直推0.25%
          (up.purchase_price::float * 0.25 / 100)::float as direct_share,
          -- 上级0.25%
          (up.purchase_price::float * 0.25 / 100)::float as parent_share,
          -- 公司0.4%
          (up.purchase_price::float * 0.4 / 100)::float as company_share
        FROM user_products up
        JOIN products p ON p.id::text = up.product_id::text
        JOIN users m ON m.id::text = up.user_id::text
        LEFT JOIN users pv ON pv.id::text = p.provider_id
        WHERE up.revenue_released = true
          AND p.provider_id IN (
            SELECT user_id::text FROM providers WHERE branch_id::text = $1
          )
        ORDER BY up.created_at DESC
      `;
      revenueRecords = await query(sql, [userId]);
    } catch (e) {
      console.error('查询网点收益失败:', e);
    }

    // 3. 生成记录：每笔解锁产生0.1%记录 + 无上级服务商时额外产生0.25%记录
    const records: any[] = [];
    let totalBranchShare = 0;     // 0.1%总额
    let totalUpstreamShare = 0;   // 上级归网点0.25%总额

    for (const r of revenueRecords || []) {
      const branchShare = Number(r.branch_share) || 0;
      const parentShare = Number(r.parent_share) || 0;
      const hasNoParentProvider = providersWithoutParent.has(r.provider_id);

      // 记录1: 产品分成0.1%
      records.push({
        id: `${r.id}-branch`,
        type: 'market_fee_share',
        source_label: '产品分成0.1%',
        product_name: r.product_name,
        product_code: r.product_code,
        product_price: Number(r.purchase_price) || 0,
        period: r.period,
        member_name: r.member_name,
        member_phone: r.member_phone,
        member_unique_id: r.member_unique_id,
        provider_name: r.provider_name,
        provider_unique_id: r.provider_unique_id,
        amount: branchShare,
        branch_share: branchShare,
        total_release: Number(r.total_release) || 0,
        member_share: Number(r.member_share) || 0,
        provider_share: Number(r.provider_share) || 0,
        direct_share: Number(r.direct_share) || 0,
        parent_share: Number(r.parent_share) || 0,
        company_share: Number(r.company_share) || 0,
        status: 'completed',
        created_at: r.created_at,
      });
      totalBranchShare += branchShare;

      // 记录2: 无上级服务商，0.25%归网点
      if (hasNoParentProvider && parentShare > 0) {
        records.push({
          id: `${r.id}-upstream`,
          type: 'provider_upstream',
          source_label: '无上级服务商分成(归网点0.25%)',
          product_name: r.product_name,
          product_code: r.product_code,
          product_price: Number(r.purchase_price) || 0,
          period: r.period,
          member_name: r.member_name,
          member_phone: r.member_phone,
          member_unique_id: r.member_unique_id,
          provider_name: r.provider_name,
          provider_unique_id: r.provider_unique_id,
          amount: parentShare,
          branch_share: parentShare,
          total_release: Number(r.total_release) || 0,
          member_share: Number(r.member_share) || 0,
          provider_share: Number(r.provider_share) || 0,
          direct_share: Number(r.direct_share) || 0,
          parent_share: Number(r.parent_share) || 0,
          company_share: Number(r.company_share) || 0,
          status: 'completed',
          created_at: r.created_at,
        });
        totalUpstreamShare += parentShare;
      }
    }

    totalRevenue = totalBranchShare + totalUpstreamShare;

    // 4. 已提现金额
    let totalWithdrawn = 0;
    try {
      const withdrawnSql = `
        SELECT COALESCE(SUM(amount::float), 0) as total
        FROM withdrawals
        WHERE user_id::text = $1 AND user_role = 'branch' AND status IN ('pending', 'transferred', 'completed')
      `;
      const withdrawnResult: any = await query(withdrawnSql, [userId]);
      totalWithdrawn = parseFloat(String(withdrawnResult?.[0]?.total || '0'));
    } catch {
      totalWithdrawn = 0;
    }

    // 可用收益 = 总收益 - 已提现
    const availableRevenue = Math.max(0, totalRevenue - totalWithdrawn);

    return NextResponse.json({
      success: true,
      data: {
        records,
        stats: {
          totalRevenue,
          totalBranchShare,
          totalUpstreamShare,
          balance: currentBalance,
          totalWithdrawn,
          availableRevenue,
          orderCount: records.length,
        },
      }
    });
  } catch (error) {
    console.error('获取网点收益记录失败:', error);
    return NextResponse.json({
      success: true,
      data: {
        records: [],
        stats: {
          totalRevenue: 0, balance: 0,
          totalWithdrawn: 0, availableRevenue: 0, orderCount: 0,
        },
      }
    });
  }
}
