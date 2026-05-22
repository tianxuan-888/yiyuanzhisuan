import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 获取服务商列表（用于互转选择）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const currentProviderId = searchParams.get('currentProviderId');

    const client = getSupabaseClient();

    // 获取所有服务商（排除当前服务商自己）
    let query = client
      .from('users')
      .select('id, username, phone, provider_id, inviter_id')
      .eq('role', 'provider');

    if (currentProviderId) {
      query = query.neq('id', currentProviderId);
    }

    const { data: providers, error } = await query;

    if (error) {
      throw new Error(`查询服务商列表失败: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      data: providers || [],
    });
  } catch (error: any) {
    console.error('获取服务商列表失败:', error);
    return NextResponse.json(
      { error: error.message || '获取失败' },
      { status: 500 }
    );
  }
}
