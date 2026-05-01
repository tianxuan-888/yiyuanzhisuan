import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取分公司的能量值发放记录
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const branchId = searchParams.get('branchId');

    if (!branchId) {
      return NextResponse.json(
        { success: false, error: '缺少分公司ID' },
        { status: 400 }
      );
    }

    // 查询该分公司收到的所有 transfer_in 记录（来自总公司的发放）
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
    console.error('获取能量值记录失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '获取记录失败' },
      { status: 500 }
    );
  }
}

// 分公司向总公司申请能量值（只记录申请，不实际转账）
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

    // 验证是分公司
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
        { success: false, error: '只有分公司才能申请能量值' },
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
        { success: false, error: '最低申请金额为 50 能量值' },
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

    // 发送通知给总公司（通知需要人工审核）
    const notifId = crypto.randomUUID();
    await query(
      `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, type, title, content, related_id, created_at)
       VALUES ($1, '00000000-0000-0000-0000-000000000001', 'admin', $2, 'energy_request_pending', '新的能量值申请', $3, $4, NOW())`,
      [
        notifId,
        branchId,
        `分公司 ${branch[0].username} 申请能量值 ${applyAmount.toLocaleString()}，请前往审核。`,
        requestId
      ]
    );

    return NextResponse.json({
      success: true,
      message: `能量值申请已提交，等待总公司审核`,
      data: {
        requestId,
        amount: applyAmount,
        status: 'pending'
      }
    });
  } catch (error) {
    console.error('分公司申请能量值失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '申请失败' },
      { status: 500 }
    );
  }
}
