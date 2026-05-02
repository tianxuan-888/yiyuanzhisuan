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
// 优先使用直连地址，自动从 Supabase URL 构造直连 DATABASE_URL
export function getDatabaseUrl(): string {
  // 1. 优先使用 SUPABASE_DB_PASSWORD 构造直连地址（最可靠）
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  const supabaseUrl = getSupabaseUrl();
  if (dbPassword && supabaseUrl) {
    const ref = supabaseUrl.replace('https://', '').replace('http://', '').split('.')[0];
    if (ref) {
      return `postgresql://postgres:${dbPassword}@db.${ref}.supabase.co:5432/postgres`;
    }
  }

  // 2. 使用环境变量中的连接字符串
  const envUrl =
    process.env.DATABASE_URL ||
    process.env.PGDATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    '';

  // 3. 如果是 Pooler 地址，自动转换为直连地址
  if (envUrl && envUrl.includes('pooler.supabase.com')) {
    const ref = envUrl.match(/postgres\.([a-z0-9]+):/)?.[1];
    const password = envUrl.match(/:([^@]+)@/)?.[1];
    if (ref && password) {
      return `postgresql://postgres:${password}@db.${ref}.supabase.co:5432/postgres`;
    }
  }

  return envUrl;
}

// JWT 密钥
export function getJwtSecret(): string {
  return (
    process.env.JWT_SECRET ||
    'jiyuan-zhike-default-secret-change-in-production'
  );
}
