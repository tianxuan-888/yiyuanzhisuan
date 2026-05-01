import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 发送通知
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      userId, 
      type, 
      title, 
      content, 
      amount, 
      relatedId 
    } = body;

    if (!userId || !type || !title) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const result = await query(
      `INSERT INTO notifications (receiver_id, type, title, content, amount, related_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, type, title, content, amount, relatedId]
    );

    return NextResponse.json({
      success: true,
      data: result[0],
    });
  } catch (error) {
    console.error('发送通知失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '发送通知失败' },
      { status: 500 }
    );
  }
}

// 获取通知列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const limit = searchParams.get('limit') || '50';

    const conditions: string[] = [];
    const params: any[] = [];

    if (userId) {
      conditions.push(`receiver_id = $${params.length + 1}`);
      params.push(userId);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const notifications = await query(
      `SELECT * FROM notifications 
       ${whereClause}
       ORDER BY created_at DESC 
       LIMIT ${parseInt(limit)}`,
      params
    );

    return NextResponse.json({
      success: true,
      data: notifications,
    });
  } catch (error) {
    console.error('获取通知列表失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '获取通知列表失败' },
      { status: 500 }
    );
  }
}
