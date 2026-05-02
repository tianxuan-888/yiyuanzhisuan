import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  // 收集所有数据库相关的环境变量（脱敏密码）
  const envInfo: Record<string, string> = {};
  
  const dbEnvKeys = [
    'DATABASE_URL',
    'PGDATABASE_URL',
    'POSTGRES_URL',
    'POSTGRES_PRISMA_URL',
    'POSTGRES_URL_NON_POOLING',
    'COZE_SUPABASE_URL',
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_DB_PASSWORD',
    'PGHOST',
    'PGPORT',
    'PGUSER',
    'PGDATABASE',
    'PGPASSWORD',
  ];

  for (const key of dbEnvKeys) {
    const value = process.env[key];
    if (value) {
      // 脱敏：隐藏密码部分
      envInfo[key] = value.replace(/:([^@]{2})[^@]+@/, ':$1****@');
    }
  }

  // 动态导入 getDatabaseUrl 以检查解析结果
  try {
    const { getDatabaseUrl } = await import('@/lib/env');
    const resolvedUrl = getDatabaseUrl();
    envInfo['__RESOLVED_DATABASE_URL__'] = resolvedUrl
      ? resolvedUrl.replace(/:([^@]{2})[^@]+@/, ':$1****@')
      : '(empty)';
    
    // 解析连接信息
    if (resolvedUrl) {
      try {
        const url = new URL(resolvedUrl.replace('postgresql://', 'http://'));
        envInfo['__PARSED_HOST__'] = url.hostname;
        envInfo['__PARSED_PORT__'] = url.port || '5432';
        envInfo['__PARSED_USER__'] = url.username;
        envInfo['__PARSED_DB__'] = url.pathname.slice(1);
      } catch {
        envInfo['__PARSE_ERROR__'] = 'Failed to parse URL';
      }
    }
  } catch (e: any) {
    envInfo['__GETURL_ERROR__'] = e.message;
  }

  return NextResponse.json({ success: true, env: envInfo });
}
