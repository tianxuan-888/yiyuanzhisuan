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

// 获取分配给服务网点的算力模板
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'branch'])) {
      return NextResponse.json({ error: '无权查看' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');

    // 智算总台可以查看所有分配记录
    // 服务网点只能查看自己的分配记录
    let sql = `
      SELECT qa.*, pt.name as template_name, pt.code as template_code, 
             pt.period, pt.total_rate, pt.market_rate, pt.profit_rate,
             u.username as branch_name, u.phone as branch_phone
      FROM quota_allocations qa
      LEFT JOIN product_templates pt ON qa.template_id = pt.id
      LEFT JOIN users u ON qa.branch_id = u.id
      WHERE qa.provider_id IS NULL  -- 只查服务网点级别（未分配给服务商）
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (user.role === 'branch' && !branchId) {
      // 服务网点查看自己的分配
      sql += ` AND qa.branch_id = $${paramIndex++}`;
      params.push(user.userId);
    } else if (branchId) {
      sql += ` AND qa.branch_id = $${paramIndex++}`;
      params.push(branchId);
    }

    sql += ` ORDER BY qa.created_at DESC`;

    const allocations = await query(sql, params);

    // 同时返回模板列表（智算总台创建的所有模板）
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

// 授权算力模板给服务网点（智算总台操作，纯授权不涉及额度）
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin'])) {
      return NextResponse.json({ error: '只有智算总台可以授权模板' }, { status: 403 });
    }

    const body = await request.json();
    const { templateId, branchId } = body;

    if (!templateId || !branchId) {
      return NextResponse.json(
        { error: '缺少必要参数（模板ID和服务网点ID）' },
        { status: 400 }
      );
    }

    // 验证模板存在
    const template = await queryOne<{ id: string; name: string; period: number; total_rate: number; market_rate: number; profit_rate: number }>(
      'SELECT id, name, period, total_rate, market_rate, profit_rate FROM product_templates WHERE id = $1 AND status = $2',
      [templateId, 'active']
    );

    if (!template) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 });
    }

    // 验证服务网点存在
    const branch = await queryOne<{ id: string; username: string }>(
      'SELECT id, username FROM users WHERE id = $1 AND role = $2',
      [branchId, 'branch']
    );

    if (!branch) {
      return NextResponse.json({ error: '服务网点不存在' }, { status: 404 });
    }

    // 检查是否已授权过该模板给该服务网点
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM quota_allocations 
       WHERE template_id = $1 AND branch_id = $2 AND provider_id IS NULL`,
      [templateId, branchId]
    );

    if (existing) {
      return NextResponse.json({
        success: true,
        message: `该服务网点已获得「${template.name}」模板授权`,
        data: { templateId, branchId, alreadyAuthorized: true },
      });
    }

    // 创建授权记录（模板授权，额度为0，不涉及额度分配）
    await query(
      `INSERT INTO quota_allocations (template_id, branch_id, quota_amount, used_amount, status)
       VALUES ($1, $2, 0, 0, 'active')`,
      [templateId, branchId]
    );

    return NextResponse.json({
      success: true,
      message: `已成功授权「${template.name}」模板给 ${branch.username}，服务网点可使用该模板为服务商生成产品`,
      data: {
        templateId,
        branchId,
        templateName: template.name,
        branchName: branch.username,
      },
    });
  } catch (error) {
    console.error('授权模板失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '授权模板失败' },
      { status: 500 }
    );
  }
}
