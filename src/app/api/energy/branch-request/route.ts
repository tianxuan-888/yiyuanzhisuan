import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 服务网点向智算总台申请能量值
export async function POST(request: NextRequest) {
  try {
    // 获取认证用户
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ success: false, error: '未登录，请先登录' }, { status: 401 });
    }

    const body = await request.json();
    let { branchId, amount, note } = body;

    // 如果没有传branchId，使用当前登录用户的ID
    if (!branchId) {
      branchId = authUser.userId;
    }

    if (!amount) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const requestAmount = parseFloat(amount);
    if (isNaN(requestAmount) || requestAmount < 50) {
      return NextResponse.json(
        { success: false, error: '申请金额最低为50能量值' },
        { status: 400 }
      );
    }

    // 验证是服务网点
    const branchResult = await query(
      'SELECT id, username, role FROM users WHERE id = $1',
      [branchId]
    );

    if (!branchResult || branchResult.length === 0) {
      return NextResponse.json(
        { success: false, error: '用户不存在' },
        { status: 404 }
      );
    }

    if (branchResult[0].role !== 'branch') {
      return NextResponse.json(
        { success: false, error: '只有服务网点才能申请能量值' },
        { status: 403 }
      );
    }

    // 【修改】申请时不检查智算总台余额，只在审核时检查
    // 直接创建申请记录，等待智算总台审核
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO energy_branch_requests 
       (id, branch_id, amount, note, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW(), NOW())`,
      [id, branchId, requestAmount, note || null]
    );

    // 获取服务网点用户名
    const branchName = branchResult[0].username;

    return NextResponse.json({
      success: true,
      message: '能量值申请已提交，等待智算总台审核',
      data: {
        requestId: id,
        branchId: branchId,
        branchName: branchName,
        amount: requestAmount,
        note: note || '',
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('服务网点申请能量值失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '申请失败' },
      { status: 500 }
    );
  }
}

// 获取服务网点能量值申请记录
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    const status = searchParams.get('status'); // pending, approved, rejected, all

    let sql = `
      SELECT r.*, u.username as branch_name, u.phone as branch_phone
      FROM energy_branch_requests r
      JOIN users u ON u.id = r.branch_id
    `;
    const params: any[] = [];
    const conditions: string[] = [];

    if (branchId) {
      params.push(branchId);
      conditions.push(`r.branch_id = $${params.length}`);
    }

    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`r.status = $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY r.created_at DESC LIMIT 100';

    const records = await query(sql, params);

    // 计算统计（处理异常数据格式）
    const stats = {
      pending: { count: 0, amount: 0 },
      approved: { count: 0, amount: 0 },
      rejected: { count: 0, amount: 0 },
      total: { count: 0, amount: 0 },
    };

    records.forEach((r: any) => {
      // 尝试多种方式解析 amount，处理异常数据格式
      let amount = 0;
      if (r.amount) {
        if (typeof r.amount === 'number') {
          amount = r.amount;
        } else if (typeof r.amount === 'string') {
          // 尝试提取数字部分（处理 "{100000 -2 false finite true}" 格式）
          const match = r.amount.match(/(-?\d+\.?\d*)/);
          if (match) {
            amount = parseFloat(match[1]) || 0;
          }
        }
      }
      stats.total.count++;
      stats.total.amount += amount;
      
      if (r.status === 'pending') {
        stats.pending.count++;
        stats.pending.amount += amount;
      } else if (r.status === 'approved') {
        stats.approved.count++;
        stats.approved.amount += amount;
      } else if (r.status === 'rejected') {
        stats.rejected.count++;
        stats.rejected.amount += amount;
      }
    });

    // 格式化返回数据（处理异常数据格式）
    const formattedRecords = records.map((r: any) => {
      // 尝试多种方式解析 amount
      let amount = 0;
      if (r.amount) {
        if (typeof r.amount === 'number') {
          amount = r.amount;
        } else if (typeof r.amount === 'string') {
          // 尝试提取数字部分
          const match = r.amount.match(/(-?\d+\.?\d*)/);
          if (match) {
            amount = parseFloat(match[1]) || 0;
          }
        }
      }
      return {
        id: r.id,
        branchId: r.branch_id,
        branchName: r.branch_name,
        branchPhone: r.branch_phone,
        amount: amount,
        note: r.note || '',
        status: r.status,
        reviewerId: r.reviewer_id,
        reviewerNote: r.reviewer_note || '',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        reviewedAt: r.reviewed_at,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        records: formattedRecords,
        stats,
      },
    });
  } catch (error) {
    console.error('获取能量值申请记录失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    );
  }
}
