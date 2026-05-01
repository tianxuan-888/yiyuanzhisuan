import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 查询单条记录的辅助函数
async function queryOne<T>(sql: string, params: any[] = []): Promise<T | null> {
  const result = await query<T>(sql, params);
  if (Array.isArray(result) && result.length > 0) {
    return result[0];
  }
  return null;
}

// 获取分配给分公司的算力模板
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'branch'])) {
      return NextResponse.json({ error: '无权查看' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');

    // 总公司可以查看所有分配记录
    // 分公司只能查看自己的分配记录
    let sql = `
      SELECT qa.*, pt.name as template_name, pt.code as template_code, 
             pt.period, pt.total_rate, pt.market_rate, pt.profit_rate,
             u.username as branch_name, u.phone as branch_phone
      FROM quota_allocations qa
      LEFT JOIN product_templates pt ON qa.template_id = pt.id
      LEFT JOIN users u ON qa.branch_id = u.id
      WHERE qa.provider_id IS NULL  -- 只查分公司级别（未分配给服务商）
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (user.role === 'branch' && !branchId) {
      // 分公司查看自己的分配
      sql += ` AND qa.branch_id = $${paramIndex++}`;
      params.push(user.userId);
    } else if (branchId) {
      sql += ` AND qa.branch_id = $${paramIndex++}`;
      params.push(branchId);
    }

    sql += ` ORDER BY qa.created_at DESC`;

    const allocations = await query(sql, params);

    // 同时返回模板列表（总公司创建的所有模板）
    const templates = await query(
      'SELECT * FROM product_templates WHERE status = $1 ORDER BY created_at DESC',
      ['active']
    );

    return NextResponse.json({
      success: true,
      data: {
        allocations,
        templates,
      },
    });
  } catch (error) {
    console.error('获取分配记录失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取分配记录失败' },
      { status: 500 }
    );
  }
}

// 分配算力模板给分公司（总公司操作）
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin'])) {
      return NextResponse.json({ error: '只有总公司可以分配模板' }, { status: 403 });
    }

    const body = await request.json();
    const { templateId, branchId, quotaAmount } = body;

    if (!templateId || !branchId || !quotaAmount) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const quota = parseFloat(quotaAmount);
    if (quota < 10000) {
      return NextResponse.json(
        { error: '最小分配额度为10000' },
        { status: 400 }
      );
    }

    // 验证模板存在
    const template = await queryOne<{ id: string; name: string }>(
      'SELECT id, name FROM product_templates WHERE id = $1 AND status = $2',
      [templateId, 'active']
    );

    if (!template) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 });
    }

    // 验证分公司存在
    const branch = await queryOne<{ id: string; username: string }>(
      'SELECT id, username FROM users WHERE id = $1 AND role = $2',
      [branchId, 'branch']
    );

    if (!branch) {
      return NextResponse.json({ error: '分公司不存在' }, { status: 404 });
    }

    // 检查是否已有相同的分配记录
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM quota_allocations 
       WHERE template_id = $1 AND branch_id = $2 AND provider_id IS NULL`,
      [templateId, branchId]
    );

    if (existing) {
      // 更新额度
      await query(
        `UPDATE quota_allocations 
         SET quota_amount = $1, used_amount = 0, status = 'active', updated_at = NOW()
         WHERE id = $2`,
        [quota, existing.id]
      );
    } else {
      // 创建新分配
      await query(
        `INSERT INTO quota_allocations (template_id, branch_id, quota_amount, used_amount, status)
         VALUES ($1, $2, $3, 0, 'active')`,
        [templateId, branchId, quota]
      );
    }

    return NextResponse.json({
      success: true,
      message: `已成功分配 ${quota.toLocaleString()} 额度给 ${branch.username}`,
      data: {
        templateId,
        branchId,
        quotaAmount: quota,
      },
    });
  } catch (error) {
    console.error('分配模板失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '分配模板失败' },
      { status: 500 }
    );
  }
}
