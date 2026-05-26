import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取产品模板列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let sql = 'SELECT * FROM product_templates';
    const params: string[] = [];

    if (status) {
      sql += ' WHERE status = $1';
      params.push(status);
    }

    sql += ' ORDER BY period ASC';

    const templates = await query(sql, params);

    return NextResponse.json({
      success: true,
      data: templates,
    });
  } catch (error) {
    console.error('获取产品模板失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取产品模板失败' },
      { status: 500 }
    );
  }
}

// 创建产品模板
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, code, period, total_rate, market_rate, profit_rate, min_quota } = body;

    if (!name || !code || !period || !total_rate || !market_rate || !profit_rate) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const result = await query(
      `INSERT INTO product_templates (name, code, period, total_rate, market_rate, profit_rate, min_quota, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
       RETURNING *`,
      [name, code, period, total_rate, market_rate, profit_rate, min_quota || 10000]
    );

    return NextResponse.json({
      success: true,
      data: result[0],
    });
  } catch (error) {
    console.error('创建产品模板失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建产品模板失败' },
      { status: 500 }
    );
  }
}

// 更新模板状态（启用/禁用）
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { templateId, status } = body;

    if (!templateId || !status) {
      return NextResponse.json(
        { error: '缺少模板ID或状态' },
        { status: 400 }
      );
    }

    if (!['active', 'inactive'].includes(status)) {
      return NextResponse.json(
        { error: '状态值无效，只支持 active/inactive' },
        { status: 400 }
      );
    }

    const result = await query(
      `UPDATE product_templates SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, templateId]
    );

    if (result.length === 0) {
      return NextResponse.json(
        { error: '模板不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result[0],
      message: status === 'active' ? '模板已启用' : '模板已禁用',
    });
  } catch (error) {
    console.error('更新模板状态失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '更新模板状态失败' },
      { status: 500 }
    );
  }
}
