import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取用户额度信息
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const role = searchParams.get('role');

    if (!userId) {
      return NextResponse.json(
        { error: '缺少用户ID' },
        { status: 400 }
      );
    }

    // 使用 PostgreSQL 直接查询用户信息
    const usersResult = await query(
      `SELECT id, username, role, branch_id FROM users WHERE id = $1`,
      [userId]
    );

    if (!usersResult || usersResult.length === 0) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 400 }
      );
    }

    const user = usersResult[0];

    const quotaData: {
      total_quota: number;
      used_quota: number;
      available_quota: number;
      pending_requests: number;
      allocations?: unknown[];
    } = {
      total_quota: 0,
      used_quota: 0,
      available_quota: 0,
      pending_requests: 0,
    };

    if (user.role === 'provider') {
      // 服务商：从 quota_allocations 汇总计算额度（最可靠的数据源）
      try {
        const allocResult = await query(
          `SELECT 
            COALESCE(SUM(quota_amount), 0)::float as total_allocated,
            COALESCE(SUM(used_amount), 0)::float as total_used
           FROM quota_allocations 
           WHERE provider_id = $1`,
          [userId]
        );
        
        if (allocResult && allocResult.length > 0) {
          quotaData.total_quota = allocResult[0].total_allocated || 0;
          quotaData.used_quota = allocResult[0].total_used || 0;
          quotaData.available_quota = Math.max(0, quotaData.total_quota - quotaData.used_quota);
        }
      } catch (e) {
        console.error('从quota_allocations汇总额度失败:', e);
        // fallback: 尝试从 providers 表读取
        try {
          const providerResult = await query(
            `SELECT CAST(quota AS FLOAT) as quota_float, CAST(used_quota AS FLOAT) as used_quota_float 
             FROM providers WHERE user_id = $1`,
            [userId]
          );
          if (providerResult && providerResult.length > 0) {
            quotaData.total_quota = providerResult[0].quota_float || 0;
            quotaData.used_quota = providerResult[0].used_quota_float || 0;
            quotaData.available_quota = Math.max(0, quotaData.total_quota - quotaData.used_quota);
          }
        } catch (e2) {
          console.error('从providers表fallback读取额度失败:', e2);
        }
      }

      // 获取分配记录列表
      try {
        const allocList = await query(
          `SELECT qa.*, pt.name as template_name, pt.period, pt.total_rate
           FROM quota_allocations qa
           LEFT JOIN product_templates pt ON qa.template_id = pt.id
           WHERE qa.provider_id = $1
           ORDER BY qa.created_at DESC`,
          [userId]
        );
        quotaData.allocations = allocList || [];
      } catch (e) {
        console.error('获取分配记录失败:', e);
      }

      // 获取服务商的额度申请记录
      try {
        const requestsResult = await query(
          `SELECT qr.*, u.username as requester_name
           FROM quota_requests qr
           LEFT JOIN users u ON qr.requester_id = u.id
           WHERE qr.requester_id = $1
           ORDER BY qr.created_at DESC
           LIMIT 50`,
          [userId]
        );
        
        return NextResponse.json({
          success: true,
          data: {
            ...quotaData,
            requests: requestsResult || []
          },
        });
      } catch (e) {
        console.error('查询服务商额度申请记录失败:', e);
      }

    } else if (user.role === 'branch') {
      // 分公司：从 quota_accounts 表获取额度
      try {
        const accountsResult = await query(
          `SELECT balance::float as balance_float, total_in::float as total_in_float 
           FROM quota_accounts 
           WHERE user_id = $1`,
          [userId]
        );
        
        if (accountsResult && accountsResult.length > 0) {
          const account = accountsResult[0];
          quotaData.total_quota = account.total_in_float || 0;
          quotaData.available_quota = account.balance_float || 0;
          quotaData.used_quota = Math.max(0, quotaData.total_quota - quotaData.available_quota);
        }
      } catch (dbError) {
        console.error('查询quota_accounts失败:', dbError);
      }

      // 获取待审核的服务商额度申请
      try {
        const pendingResult = await query(
          `SELECT COUNT(*) as count FROM quota_requests 
           WHERE parent_id = $1 AND requester_type = 'provider' AND status = 'pending'`,
          [userId]
        );
        quotaData.pending_requests = Number(pendingResult[0]?.count || 0);
      } catch (e) {
        console.error('查询待审核申请失败:', e);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        ...quotaData,
        requests: []
      },
    });
  } catch (error) {
    console.error('获取用户额度失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取额度失败' },
      { status: 500 }
    );
  }
}
