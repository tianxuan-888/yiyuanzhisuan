import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取申请列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const applicantId = searchParams.get('applicantId');

    let sql = `
      SELECT qa.*, u.username as applicant_name, u.phone as applicant_phone
      FROM quota_applications qa
      LEFT JOIN users u ON u.id = qa.applicant_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      sql += ` AND qa.status = $${params.length + 1}`;
      params.push(status);
    }

    if (applicantId) {
      sql += ` AND qa.applicant_id = $${params.length + 1}`;
      params.push(applicantId);
    }

    sql += ` ORDER BY qa.created_at DESC`;

    const applications = await query(sql, params);

    return NextResponse.json({
      success: true,
      data: applications,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// 创建申请（服务网点发起）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { applicantId, amount, note } = body;

    if (!applicantId || !amount) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    await query(
      `INSERT INTO quota_applications (applicant_id, amount, status, note, created_at)
       VALUES ($1, $2, 'pending', $3, NOW())`,
      [applicantId, amount, note || '']
    );

    return NextResponse.json({
      success: true,
      message: '额度申请已提交',
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
