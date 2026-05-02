/**
 * Supabase 客户端 - 供 API 路由使用
 * 
 * 使用 service_role key 绕过 RLS（Row Level Security）
 * 因为 API 路由都是服务端操作，不需要受行级安全策略限制
 * 
 * 统一从 @/lib/supabase-client 获取客户端实例
 */
import { getSupabase } from '@/lib/supabase-client';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 获取 Supabase 客户端（service_role 权限，绕过 RLS）
 * 兼容现有代码中 import { getSupabaseClient } 的用法
 */
export function getSupabaseClient(): SupabaseClient {
  return getSupabase();
}

// 兼容旧代码中直接使用 supabase 的用法
export const supabase: SupabaseClient = getSupabase();
