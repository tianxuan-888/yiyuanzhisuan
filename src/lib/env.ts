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
// 策略：Supabase 免费计划不暴露直连 DNS (db.xxx.supabase.co)，
// 必须使用 Pooler 地址 (aws-0-xxx.pooler.supabase.com)，配合 prepare: false
export function getDatabaseUrl(): string {
  // 1. 使用环境变量中的连接字符串（优先使用非 Pooler 的直连地址）
  const envUrl =
    process.env.DATABASE_URL ||
    process.env.PGDATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||  // Vercel Supabase 集成的非池化地址
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    '';

  // 2. 过滤掉 Vercel 内部无效地址（PGHOST=postgres）
  if (envUrl) {
    try {
      const url = new URL(envUrl.replace('postgresql://', 'http://'));
      if (url.hostname === 'postgres' || url.hostname === 'localhost') {
        console.warn(`[env] 跳过无效的数据库 URL (hostname=${url.hostname})`);
        // 继续尝试下面的方式
      } else {
        // 有效地址，直接返回（Pooler 或直连都行，pg-client 会自动适配）
        return envUrl;
      }
    } catch {
      // URL 解析失败，继续尝试
    }
  }

  // 3. 如果没有有效 URL，从 Supabase URL + 密码构造 Pooler 地址
  const supabaseUrl = getSupabaseUrl();
  if (supabaseUrl) {
    const ref = supabaseUrl.replace('https://', '').replace('http://', '').split('.')[0];
    const dbPassword = process.env.SUPABASE_DB_PASSWORD || process.env.PGPASSWORD;
    if (ref && dbPassword) {
      // 使用 Pooler 地址（直连 DNS 在免费计划上不可用）
      return `postgresql://postgres.${ref}:${dbPassword}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
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
