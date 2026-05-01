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

    // 使用 quota_accounts 表获取额度（统一的算力额度系统）
    const quotaData = {
      total_quota: 0,      // 总额度（从quota_accounts获取）
      used_quota: 0,       // 已使用额度
      available_quota: 0,  // 可用额度
      pending_requests: 0,
    };

    try {
      // 从 quota_accounts 表获取额度数据
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
        // 已使用 = 总额度 - 可用额度
        quotaData.used_quota = Math.max(0, quotaData.total_quota - quotaData.available_quota);
      }
    } catch (dbError) {
      console.error('查询quota_accounts失败:', dbError);
    }

    // 获取待审核的服务商额度申请（来自 quota_requests 表）
    if (user.role === 'branch') {
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

    // 获取服务商的额度申请记录
    if (user.role === 'provider') {
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
