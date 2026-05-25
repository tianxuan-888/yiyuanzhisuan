import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// GET - 获取按服务网点分组的用户数据（智算中心专用）
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();

    // 获取所有用户
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, username, role, real_name, phone, branch_id, provider_id, balance, created_at, is_active')
      .order('created_at', { ascending: false });

    if (usersError) {
      throw usersError;
    }

    // 按服务网点分组
    const branches = users?.filter(u => u.role === 'branch') || [];
    const providers = users?.filter(u => u.role === 'provider') || [];
    const members = users?.filter(u => u.role === 'member') || [];
    const admins = users?.filter(u => u.role === 'admin') || [];

    // 为每个服务网点分组服务商和会员
    const branchesWithStats = branches.map(branch => {
      const branchProviders = providers.filter(p => p.branch_id === branch.id);
      const branchMembers = members.filter(m => m.branch_id === branch.id);

      // 为每个服务商统计会员
      const providersWithMembers = branchProviders.map(provider => {
        const providerMembers = members.filter(m => m.provider_id === provider.id);

        return {
          ...provider,
          member_count: providerMembers.length,
          members: providerMembers.map(m => ({
            id: m.id,
            username: m.username,
            real_name: m.real_name,
            phone: m.phone,
            
            balance: m.balance,
            created_at: m.created_at,
          })),
        };
      });

      return {
        ...branch,
        provider_count: branchProviders.length,
        member_count: branchMembers.length,
        providers: providersWithMembers,
        members: branchMembers.map(m => ({
          id: m.id,
          username: m.username,
          real_name: m.real_name,
          phone: m.phone,
          provider_id: m.provider_id,
          provider_name: providers.find(p => p.id === m.provider_id)?.real_name,
          
          balance: m.balance,
          created_at: m.created_at,
        })),
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        admins,
        branches: branchesWithStats,
        summary: {
          total_branches: branches.length,
          total_providers: providers.length,
          total_members: members.length,
          total_admins: admins.length,
        },
      },
    });
  } catch (error) {
    console.error('获取分组数据失败:', error);
    return NextResponse.json({
      success: false,
      error: '获取分组数据失败'
    }, { status: 500 });
  }
}
