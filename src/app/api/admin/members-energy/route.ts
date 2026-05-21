import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const supabase = getSupabaseClient();

interface Member {
  id: string;
  username: string;
  phone: string;
  real_name?: string;
  provider_id?: string;
  created_at: string;
}

interface EnergyAccount {
  user_id: string;
  balance: number;
  total_in: number;
  total_out: number;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get('keyword');

    // 获取所有会员
    const { data: members, error: membersError } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'member')
      .order('created_at', { ascending: false });

    if (membersError) {
      console.error('获取会员列表失败:', membersError);
      return NextResponse.json(
        { success: false, error: `获取会员列表失败: ${membersError.message}` },
        { status: 500 }
      );
    }

    const membersData = (members || []) as Member[];

    // 获取所有收益账户
    const memberIds = membersData.map(m => m.id);
    let energyAccounts: Record<string, EnergyAccount> = {};
    
    if (memberIds.length > 0) {
      const { data: eaData } = await supabase
        .from('energy_accounts')
        .select('*')
        .in('user_id', memberIds);

      (eaData || []).forEach((ea: EnergyAccount) => {
        energyAccounts[ea.user_id] = ea;
      });
    }

    // 获取服务商信息
    const providerIds: string[] = [...new Set(membersData.map(m => m.provider_id).filter(Boolean) as string[])];
    let providers: Record<string, any> = {};
    
    if (providerIds.length > 0) {
      const { data: providerData } = await supabase
        .from('users')
        .select('id, username, real_name')
        .in('id', providerIds);

      const providersList = (providerData || []) as Array<{ id: string; username: string; real_name?: string }>;
      providersList.forEach(p => {
        providers[p.id] = p;
      });
    }

    // 处理数据
    let result = membersData.map(m => {
      const ea = energyAccounts[m.id] || { balance: 0, total_in: 0, total_out: 0 };
      const provider = providers[m.provider_id || ''] || {};
      
      return {
        id: m.id,
        username: m.username,
        phone: m.phone,
        real_name: m.real_name,
        provider_id: m.provider_id,
        provider_name: provider.real_name || provider.username || '-',
        balance: ea.balance || 0,
        total_in: ea.total_in || 0,
        total_out: ea.total_out || 0,
        created_at: m.created_at,
      };
    });

    // 如果有关键词搜索
    if (keyword) {
      result = result.filter(m => 
        m.username?.includes(keyword) || 
        m.phone?.includes(keyword) ||
        m.real_name?.includes(keyword)
      );
    }

    // 计算统计数据
    const totalEnergy = result.reduce((sum, m) => sum + Number(m.balance || 0), 0);
    const totalRecharge = result.reduce((sum, m) => sum + Number(m.total_in || 0), 0);
    const totalTransferOut = result.reduce((sum, m) => sum + Number(m.total_out || 0), 0);

    return NextResponse.json({
      success: true,
      data: result,
      stats: {
        totalEnergy,
        totalRecharge,
        totalTransferOut,
        memberCount: result.length,
      },
    });
  } catch (error) {
    console.error('服务器错误:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
