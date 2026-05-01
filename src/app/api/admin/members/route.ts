import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

const supabase = getSupabaseClient();

// 允许管理员更新的字段白名单
const ALLOWED_UPDATE_FIELDS = new Set([
  'phone',
  'real_name',
  'alipay_account',
  'is_active',
]);

export async function GET(request: NextRequest) {
  try {
    // 鉴权：仅管理员和分公司可访问
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'branch'])) {
      return NextResponse.json({ error: '无权访问' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const vipLevel = searchParams.get('vipLevel');
    const keyword = searchParams.get('keyword');

    let query = supabase
      .from('users')
      .select('id, username, phone, real_name, alipay_account, role, energy_value, balance, points, provider_id, branch_id, inviter_id, is_active, created_at, updated_at')
      .eq('role', 'member');

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (vipLevel && vipLevel !== 'all') {
      query = query.eq('vip_level', vipLevel);
    }

    // 关键词搜索在数据库层面完成
    if (keyword) {
      query = query.or(`username.ilike.%${keyword}%,phone.ilike.%${keyword}%,real_name.ilike.%${keyword}%`);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('获取会员列表失败:', error);
      return NextResponse.json({ success: false, error: `获取会员列表失败: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: data || [],
    });
  } catch (error) {
    console.error('服务器错误:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    // 鉴权：仅管理员可修改
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { memberId, updates } = body;

    if (!memberId || !updates || typeof updates !== 'object') {
      return NextResponse.json({ success: false, error: '参数无效' }, { status: 400 });
    }

    // 过滤：只允许白名单字段
    const safeUpdates: Record<string, unknown> = {};
    for (const key of Object.keys(updates)) {
      if (ALLOWED_UPDATE_FIELDS.has(key)) {
        safeUpdates[key] = updates[key];
      }
    }

    if (Object.keys(safeUpdates).length === 0) {
      return NextResponse.json({ success: false, error: '没有可更新的字段' }, { status: 400 });
    }

    safeUpdates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('users')
      .update(safeUpdates as any)
      .eq('id', memberId)
      .eq('role', 'member') // 额外限制只能修改会员
      .select()
      .single();

    if (error) {
      console.error('更新会员失败:', error);
      return NextResponse.json({ success: false, error: '更新会员失败' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data,
      message: '会员信息更新成功',
    });
  } catch (error) {
    console.error('服务器错误:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
