import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 会员发起充值申请
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { memberId, providerId, amount, note } = body;

    // 参数验证
    if (!memberId || !providerId || !amount) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    if (amount < 50) {
      return NextResponse.json(
        { error: '最低充值金额为50能量值' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient();
    const now = new Date().toISOString();

    // 创建充值申请
    const { data, error } = await client
      .from('energy_recharge_requests')
      .insert({
        member_id: memberId,
        provider_id: providerId,
        amount,
        note: note || null,
        status: 'pending',
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`创建充值申请失败: ${error.message}`);
    }

    // 创建通知给服务商
    await client
      .from('notifications')
      .insert({
        user_id: providerId,
        type: 'recharge_request',
        title: '新的充值申请',
        content: `会员发起充值申请，金额：${amount} 能量值`,
        is_read: false,
        created_at: now,
      });

    return NextResponse.json({
      success: true,
      data,
      message: '充值申请已提交，请等待服务商审核',
    });
  } catch (error) {
    console.error('创建充值申请失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建失败' },
      { status: 500 }
    );
  }
}

// 获取会员的充值申请记录
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('memberId');
    const status = searchParams.get('status');

    if (!memberId) {
      return NextResponse.json(
        { error: '会员ID不能为空' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient();
    let query = client
      .from('energy_recharge_requests')
      .select('*, provider:provider_id(id, username)')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`查询充值申请失败: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      data: data || [],
    });
  } catch (error) {
    console.error('查询充值申请失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '查询失败' },
      { status: 500 }
    );
  }
}
