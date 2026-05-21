import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取服务网点的收益发放记录
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const branchId = searchParams.get('branchId');

    if (!branchId) {
      return NextResponse.json(
        { success: false, error: '缺少服务网点ID' },
        { status: 400 }
      );
    }

    // 查询该服务网点收到的所有 transfer_in 记录（来自智算总台的发放）
    const records = await query(
      `SELECT 
        et.id,
        et.type,
        et.amount,
        et.energy_before,
        et.energy_after,
        et.note,
        et.status,
        et.created_at,
        et.from_user_id as admin_id
       FROM energy_transactions et
       WHERE et.user_id::text = $1
         AND et.type = 'transfer_in'
       ORDER BY et.created_at DESC`,
      [branchId]
    );

    return NextResponse.json({
      success: true,
      data: records,
    });
  } catch (error) {
    console.error('获取收益记录失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '获取记录失败' },
      { status: 500 }
    );
  }
}

// 服务网点向智算总台申请收益（只记录申请，不实际转账）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { branchId, amount, note } = body;

    // 参数验证
    if (!branchId || !amount) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 验证是服务网点
    const branch = await query<{
      id: string;
      username: string;
      role: string;
    }>(
      'SELECT id, username, role FROM users WHERE id = $1',
      [branchId]
    );

    if (!branch || branch.length === 0) {
      return NextResponse.json(
        { success: false, error: '用户不存在' },
        { status: 404 }
      );
    }

    if (branch[0].role !== 'branch') {
      return NextResponse.json(
        { success: false, error: '只有服务网点才能申请收益' },
        { status: 403 }
      );
    }

    const applyAmount = parseFloat(amount);
    if (isNaN(applyAmount) || applyAmount <= 0) {
      return NextResponse.json(
        { success: false, error: '申请金额必须大于0' },
        { status: 400 }
      );
    }

    // 验证最低申请金额
    if (applyAmount < 50) {
      return NextResponse.json(
        { success: false, error: '最低申请金额为 50 收益' },
        { status: 400 }
      );
    }

    // 只创建申请记录，不检查余额和执行转账
    const requestId = crypto.randomUUID();
    await query(
      `INSERT INTO quota_requests (
        id, 
        requester_id, 
        requester_type, 
        parent_id, 
        requested_amount, 
        status, 
        created_at, 
        updated_at
      ) VALUES ($1, $2, 'branch', $3, $4, 'pending', NOW(), NOW())`,
      [requestId, branchId, '00000000-0000-0000-0000-000000000001', applyAmount]
    );

    // 发送通知给智算总台（通知需要人工审核）
    const notifId = crypto.randomUUID();
    await query(
      `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, type, title, content, related_id, created_at)
       VALUES ($1, '00000000-0000-0000-0000-000000000001', 'admin', $2, 'energy_request_pending', '新的收益申请', $3, $4, NOW())`,
      [
        notifId,
        branchId,
        `服务网点 ${branch[0].username} 申请收益 ${applyAmount.toLocaleString()}，请前往审核。`,
        requestId
      ]
    );

    return NextResponse.json({
      success: true,
      message: `收益申请已提交，等待智算总台审核`,
      data: {
        requestId,
        amount: applyAmount,
        status: 'pending'
      }
    });
  } catch (error) {
    console.error('服务网点申请收益失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '申请失败' },
      { status: 500 }
    );
  }
}
