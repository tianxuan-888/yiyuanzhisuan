import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Supabase 配置 - 必须从环境变量读取，禁止硬编码
const supabaseUrl = process.env.COZE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.COZE_SUPABASE_ANON_KEY || '';

// 创建 Supabase 客户端（延迟初始化，避免构建时崩溃）
let _supabase: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  // 仅在运行时检查（不在构建时）
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') {
    if (!supabaseUrl || !supabaseAnonKey) {
      // 构建时不报错，返回 null
      if (process.env.NODE_ENV === 'production') {
        console.warn('警告: Supabase 环境变量未配置，部分功能可能不可用');
      }
      return null;
    }
  }
  
  if (!_supabase && supabaseUrl && supabaseAnonKey) {
    _supabase = createClient(supabaseUrl, supabaseAnonKey);
  }
  return _supabase;
}

// 创建一个安全的空客户端（用于构建时）
const createSafeClient = (): SupabaseClient => {
  const safeClient = {
    from: () => ({
      select: () => ({
        eq: () => ({ data: null, error: { message: 'Supabase not configured' } }),
        single: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }),
        order: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }),
      }),
      insert: () => ({ select: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }) }),
      update: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }) }),
      delete: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }) }),
    }),
  } as unknown as SupabaseClient;
  return safeClient;
};

// 导出获取客户端的函数（兼容现有代码）
export function getSupabaseClient(): SupabaseClient {
  const client = getClient();
  return client || createSafeClient();
}

// 兼容模式：返回一个安全的代理对象
export const supabase: SupabaseClient = getClient() || createSafeClient();
