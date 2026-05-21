'use client';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 类型定义
export interface User {
  id: string;
  username: string;
  phone: string | null;
  role: 'admin' | 'branch' | 'provider' | 'member';
  provider_id: string | null;
  branch_id: string | null;
  inviter_id: string | null;
  energy_value: number;
  balance: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Provider {
  id: string;
  user_id: string;
  quota: number;
  used_quota: number;
  total_sales: number;
  split_count: number;
  is_active: boolean;
  created_at: string;
  branch_id: string | null;
}

export interface Product {
  id: string;
  name: string;
  code: string;
  price: number;
  period: number;
  total_rate: number;
  market_rate: number;
  profit_rate: number;
  provider_id: string;
  status: 'available' | 'sold' | 'transferred' | 'pending_transfer';
  created_at: string;
}

// API 函数
export async function fetchBranches() {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'branch')
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    return { success: true, data };
  } catch (error: any) {
    console.error('获取服务网点列表失败:', error);
    return { success: false, error: error.message };
  }
}

export async function fetchProviders() {
  try {
    const { data, error } = await supabase
      .from('providers')
      .select(`
        *,
        user:users!providers_user_id_fkey(*)
      `)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    return { success: true, data };
  } catch (error: any) {
    console.error('获取服务商列表失败:', error);
    return { success: false, error: error.message };
  }
}

export async function fetchMembers() {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'member')
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    return { success: true, data };
  } catch (error: any) {
    console.error('获取会员列表失败:', error);
    return { success: false, error: error.message };
  }
}

export async function fetchMembersByProvider(providerId: string) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'member')
      .eq('provider_id', providerId)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    return { success: true, data };
  } catch (error: any) {
    console.error('获取服务商下会员列表失败:', error);
    return { success: false, error: error.message };
  }
}

export async function fetchProvidersByBranch(branchId: string) {
  try {
    const { data, error } = await supabase
      .from('providers')
      .select(`
        *,
        user:users!providers_user_id_fkey(*)
      `)
      .eq('branch_id', branchId)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    return { success: true, data };
  } catch (error: any) {
    console.error('获取服务网点下服务商列表失败:', error);
    return { success: false, error: error.message };
  }
}

export async function fetchAllProviders() {
  try {
    const { data, error } = await supabase
      .from('providers')
      .select(`
        *,
        user:users!providers_user_id_fkey(*)
      `)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    return { success: true, data };
  } catch (error: any) {
    console.error('获取服务商列表失败:', error);
    return { success: false, error: error.message };
  }
}

export async function fetchPlatformStats() {
  try {
    // 获取各角色数量
    const [branchCount, providerCount, memberCount] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact' }).eq('role', 'branch'),
      supabase.from('providers').select('id', { count: 'exact' }),
      supabase.from('users').select('id', { count: 'exact' }).eq('role', 'member'),
    ]);

    // 获取总销售额
    const { data: products } = await supabase
      .from('products')
      .select('price')
      .eq('status', 'sold');

    const totalSales = products?.reduce((sum, p) => sum + p.price, 0) || 0;

    // 获取待处理提现
    const { count: pendingWithdrawalCount } = await supabase
      .from('withdrawals')
      .select('id', { count: 'exact' })
      .eq('status', 'pending');

    // 获取会员总余额
    const { data: members } = await supabase
      .from('users')
      .select('balance, energy_value')
      .eq('role', 'member');

    const totalMemberBalance = members?.reduce((sum, m) => sum + (m.balance || 0), 0) || 0;
    const totalEnergyValue = members?.reduce((sum, m) => sum + (m.energy_value || 0), 0) || 0;

    return {
      success: true,
      data: {
        branch_count: branchCount.count || 0,
        provider_count: providerCount.count || 0,
        member_count: memberCount.count || 0,
        total_sales: totalSales,
        pending_withdrawal_count: pendingWithdrawalCount || 0,
        member_balance: totalMemberBalance,
        total_energy_value: totalEnergyValue,
      }
    };
  } catch (error: any) {
    console.error('获取平台统计失败:', error);
    return { success: false, error: error.message };
  }
}

export async function fetchProviderMembers(providerId: string) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select(`
        *,
        user_products(id, purchase_price, status),
        transactions(amount, type, created_at)
      `)
      .eq('role', 'member')
      .eq('provider_id', providerId);
    
    if (error) throw error;
    return { success: true, data };
  } catch (error: any) {
    console.error('获取服务商会员列表失败:', error);
    return { success: false, error: error.message };
  }
}
