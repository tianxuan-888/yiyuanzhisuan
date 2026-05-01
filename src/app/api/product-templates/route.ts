import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取产品模板列表
export async function GET(request: NextRequest) {
  try {
    const templates = await query(
      'SELECT * FROM product_templates WHERE status = $1 ORDER BY created_at DESC',
      ['active']
    );

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

// 创建产品模板（总公司）
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
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [name, code, period, total_rate, market_rate, profit_rate, min_quota || 10000, 'active']
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
