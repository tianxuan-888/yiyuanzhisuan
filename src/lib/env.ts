/**
 * 统一环境变量读取
 * 兼容多种命名格式：COZE_ 前缀 / NEXT_PUBLIC_ 前缀 / 无前缀
 * 
 * 优先级：COZE_ 前缀 > NEXT_PUBLIC_ 前缀 > 无前缀
 */

// Supabase URL
export function getSupabaseUrl(): string {
  return (
    process.env.COZE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  );
}

// Supabase Anon Key
export function getSupabaseAnonKey(): string {
  return (
    process.env.COZE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    ''
  );
}

// Supabase Service Role Key
export function getSupabaseServiceRoleKey(): string {
  return (
    process.env.COZE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_JWT_SECRET ||
    ''
  );
}

// PostgreSQL 连接字符串
export function getDatabaseUrl(): string {
  return (
    process.env.PGDATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    ''
  );
}

// JWT 密钥
export function getJwtSecret(): string {
  return (
    process.env.JWT_SECRET ||
    'jiyuan-zhike-default-secret-change-in-production'
  );
}
