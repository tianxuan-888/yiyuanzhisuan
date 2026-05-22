import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

/**
 * 获取服务商数据总览
 * GET /api/provider/overview
 */
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || user.role !== 'provider') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const providerId = user.userId;

    // 获取服务商基本信息
    const providers = await query(
      'SELECT id, username, phone, balance FROM users WHERE id = $1',
      [providerId]
    );

    if (providers.length === 0) {
      return NextResponse.json({ error: '服务商不存在' }, { status: 404 });
    }

    const provider = providers[0];

    // 获取直属会员数量
    const membersResult = await query(
      'SELECT COUNT(*) as count FROM users WHERE provider_id = $1 AND role = $2',
      [providerId, 'member']
    );
    const memberCount = parseInt(membersResult[0]?.count || '0');

    // 获取会员累计投资金额（从订单表）
    const investmentResult = await query(
      `SELECT COALESCE(SUM(up.purchase_price), 0) as total 
       FROM user_products up 
       JOIN users u ON up.user_id = u.id 
       WHERE u.provider_id = $1`,
      [providerId]
    );
    const totalInvestment = parseFloat(investmentResult[0]?.total || '0');

    // 获取产品销售统计
    const productStats = await query(
      `SELECT 
        COUNT(*) as total_products,
        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available_products,
        SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold_products
       FROM products WHERE provider_id = $1`,
      [providerId]
    );

    // 获取服务商额度
    const quotaResult = await query(
      'SELECT quota, used_quota FROM providers WHERE user_id = $1',
      [providerId]
    );

    return NextResponse.json({
      success: true,
      data: {
        provider: {
          id: provider.id,
          username: provider.username,
          phone: provider.phone,
          balance: provider.balance,
        },
        stats: {
          memberCount,
          totalInvestment,
          totalProducts: parseInt(productStats[0]?.total_products || '0'),
          availableProducts: parseInt(productStats[0]?.available_products || '0'),
          soldProducts: parseInt(productStats[0]?.sold_products || '0'),
          quota: quotaResult[0]?.quota || 0,
          usedQuota: quotaResult[0]?.used_quota || 0,
        }
      }
    });
  } catch (error) {
    console.error('获取服务商总览失败:', error);
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}
