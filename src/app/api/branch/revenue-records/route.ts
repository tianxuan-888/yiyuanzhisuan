import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 获取网点收益记录 - 直接从user_products + products统计0.1%分成
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

    // 1. 网点0.1%分成 - 从user_products(revenue_released=true)关联products计算
    // 网点的分成来自其下所有服务商的产品
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

      totalRevenue = revenueRecords.reduce((sum: number, r: any) => sum + (Number(r.branch_share) || 0), 0);
    } catch (e) {
      console.error('查询网点收益失败:', e);
    }

    // 2. 已提现金额
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

    // 格式化记录
    const records = (revenueRecords || []).map((r: any) => ({
      id: r.id,
      source: 'distribution',
      source_label: '产品分成0.1%',
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
      provider_name: r.provider_name,
      provider_unique_id: r.provider_unique_id,
      amount: Number(r.branch_share) || 0,
      branch_share: Number(r.branch_share) || 0,
      total_release: Number(r.total_release) || 0,
      member_share: Number(r.member_share) || 0,
      provider_share: Number(r.provider_share) || 0,
      direct_share: Number(r.direct_share) || 0,
      parent_share: Number(r.parent_share) || 0,
      company_share: Number(r.company_share) || 0,
      created_at: r.created_at,
    }));

    return NextResponse.json({
      success: true,
      data: {
        records,
        stats: {
          totalRevenue,
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
