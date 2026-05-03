import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取用户能量值账户信息
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { success: false, error: '缺少用户ID' },
        { status: 400 }
      );
    }

    // 从 energy_accounts 表获取能量值余额
    const result = await query(
      `SELECT ea.*, u.username, u.role
       FROM energy_accounts ea
       JOIN users u ON u.id = ea.user_id
       WHERE ea.user_id = $1`,
      [userId]
    );

    if (result.length === 0) {
      // 用户还没有能量值账户，返回0
      return NextResponse.json({
        success: true,
        data: {
          userId: userId,
          balance: 0,
          totalIn: 0,
          totalOut: 0,
        },
      });
    }

    const account = result[0];

    return NextResponse.json({
      success: true,
      data: {
        userId: account.user_id,
        username: account.username,
        role: account.role,
        balance: Number(account.balance || 0),
        totalIn: Number(account.total_in || 0),
        totalOut: Number(account.total_out || 0),
      },
    });
  } catch (error: any) {
    console.error('获取能量值账户失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
