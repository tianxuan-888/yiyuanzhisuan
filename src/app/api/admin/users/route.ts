import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取用户列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role');

    let sql = `
      SELECT id, username, role, real_name, phone, balance, 
             provider_id, branch_id, inviter_id, is_active, created_at 
      FROM users 
      WHERE is_active = true
    `;
    
    if (role) {
      sql += ` AND role = '${role}'`;
    }
    
    sql += ' ORDER BY created_at DESC';

    const result = await query(sql);
    console.log('[admin/users] Raw result:', JSON.stringify(result).substring(0, 200));

    // 处理不同的返回格式
    let users = [];
    if (result && typeof result === 'object') {
      if (Array.isArray(result)) {
        users = result;
      } else if ('rows' in result) {
        users = (result as any).rows || [];
      } else if ('data' in result) {
        users = (result as any).data || [];
      } else {
        // 如果是其他格式，尝试获取所有值
        users = Object.values(result).filter(v => v && typeof v === 'object');
      }
    }

    return NextResponse.json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error('获取用户列表失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    );
  }
}
