import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 获取额度申请列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const requesterType = searchParams.get('requesterType');
    const parentId = searchParams.get('parentId');
    const requesterId = searchParams.get('requesterId');

    const client = getSupabaseClient();

    let query = client
      .from('quota_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }
    if (requesterType) {
      query = query.eq('requester_type', requesterType);
    }
    if (parentId) {
      query = query.eq('parent_id', parentId);
    }
    if (requesterId) {
      query = query.eq('requester_id', requesterId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('查询额度申请失败:', error.message);
      return NextResponse.json({
        success: true,
        data: [],
      });
    }

    // 补充申请人用户信息
    let enrichedData = data || [];
    if (enrichedData.length > 0) {
      const requesterIds = [...new Set(enrichedData.map((r: any) => r.requester_id))];
      const { data: users } = await client
        .from('users')
        .select('id, username, real_name, phone, role')
        .in('id', requesterIds);

      const userMap = new Map((users || []).map((u: any) => [u.id, u]));
      enrichedData = enrichedData.map((r: any) => ({
        ...r,
        requester_name: userMap.get(r.requester_id)?.real_name || userMap.get(r.requester_id)?.username || '未知',
        requester_phone: userMap.get(r.requester_id)?.phone || '',
        requester_role: userMap.get(r.requester_id)?.role || r.requester_type,
      }));
    }

    return NextResponse.json({
      success: true,
      data: enrichedData,
    });
  } catch (error) {
    console.error('获取额度申请列表失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取申请列表失败' },
      { status: 500 }
    );
  }
}

// 提交额度申请
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { requesterId, requesterType, parentId, requestedAmount } = body;

    if (!requesterId || !requesterType || !requestedAmount) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    if (requesterType === 'provider' && requestedAmount < 5000) {
      return NextResponse.json(
        { error: '服务商申请额度最低5,000元' },
        { status: 400 }
      );
    }

    if (!['branch', 'provider'].includes(requesterType)) {
      return NextResponse.json(
        { error: '无效的申请者类型' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient();

    // 检查是否有待审核的申请
    const { data: existingRequest, error: checkError } = await client
      .from('quota_requests')
      .select('id')
      .eq('requester_id', requesterId)
      .eq('status', 'pending')
      .maybeSingle();

    if (checkError) {
      console.error('检查申请状态失败:', checkError.message);
    }

    if (existingRequest) {
      return NextResponse.json(
        { error: '您已有待审核的额度申请，请等待审核' },
        { status: 400 }
      );
    }

    // 分公司申请配比20%能量值
    const energyRatio = requesterType === 'branch' ? 0.2 : 0;
    const multiplier = 1.0; // 额度本身不变

    // 获取申请人信息
    const { data: requester } = await client
      .from('users')
      .select('id, username, real_name, role')
      .eq('id', requesterId)
      .single();

    // 创建申请
    const { data: newRequest, error: createError } = await client
      .from('quota_requests')
      .insert({
        requester_id: requesterId,
        requester_type: requesterType,
        parent_id: parentId || null,
        requested_amount: requestedAmount,
        multiplier,
        status: 'pending',
      })
      .select()
      .single();

    if (createError) {
      console.error('创建申请失败:', createError.message);
      return NextResponse.json(
        { error: '申请提交失败，请稍后重试' },
        { status: 500 }
      );
    }

    // 创建通知给审批人
    if (parentId) {
      const notifyAmount = Math.floor(requestedAmount * multiplier);
      const title = requesterType === 'branch' 
        ? '分公司额度申请' 
        : '服务商额度申请';
      const content = requesterType === 'branch'
        ? `分公司【${requester?.real_name || requester?.username}】申请额度 ¥${requestedAmount.toLocaleString()}，将配比 ¥${Math.floor(requestedAmount * energyRatio).toLocaleString()} 能量值`
        : `服务商【${requester?.real_name || requester?.username}】申请额度 ¥${requestedAmount.toLocaleString()}`;

      await client
        .from('notifications')
        .insert({
          user_id: parentId,
          type: 'quota_request',
          title,
          content,
          is_read: false,
        });
    }

    return NextResponse.json({
      success: true,
      data: newRequest,
      message: '额度申请已提交，请等待审核',
    });
  } catch (error) {
    console.error('提交额度申请失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '提交申请失败' },
      { status: 500 }
    );
  }
}
