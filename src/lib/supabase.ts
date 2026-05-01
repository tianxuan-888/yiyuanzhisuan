import { createClient } from '@supabase/supabase-js';

// Supabase 配置 - 必须从环境变量读取，禁止硬编码
const supabaseUrl = process.env.COZE_SUPABASE_URL;
const supabaseAnonKey = process.env.COZE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('FATAL: COZE_SUPABASE_URL 或 COZE_SUPABASE_ANON_KEY 环境变量未设置');
}

// 创建 Supabase 客户端（延迟初始化，避免启动时崩溃）
let _supabase: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (!_supabase) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase 环境变量未配置');
    }
    _supabase = createClient(supabaseUrl, supabaseAnonKey);
  }
  return _supabase;
}

export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(_target, prop) {
    return (getClient() as any)[prop];
  },
});

// 导出获取客户端的函数（兼容现有代码）
export function getSupabaseClient() {
  return getClient();
}
