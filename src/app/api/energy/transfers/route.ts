import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 获取收益转账记录接口
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');
    const userType = searchParams.get('userType'); // 'member' 或 'provider'
    const status = searchParams.get('status');

    if (!userId || !userType) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient();

    let query = client
      .from('energy_transfers')
      .select(`
        *,
        from_user:users!energy_transfers_from_user_id_fkey (
          id,
          username,
          phone,
          real_name,
          alipay_account,
          wechat_account
        ),
        to_user:users!energy_transfers_to_user_id_fkey (
          id,
          username,
          phone,
          real_name,
          alipay_account,
          wechat_account
        )
      `);

    // 根据用户类型筛选
    if (userType === 'member') {
      // 会员查看自己的转账记录
      query = query.eq('from_user_id', userId);
    } else if (userType === 'provider') {
      // 服务商查看收到的转账申请
      query = query.eq('to_user_id', userId);
    }

    // 按状态筛选
    if (status) {
      query = query.eq('status', status);
    }

    const { data: transfers, error: transfersError } = await query.order('created_at', { ascending: false });

    if (transfersError) {
      throw new Error(`查询转账记录失败: ${transfersError.message}`);
    }

    return NextResponse.json({
      success: true,
      data: transfers,
    });
  } catch (error) {
    console.error('获取转账记录失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取转账记录失败' },
      { status: 500 }
    );
  }
}
