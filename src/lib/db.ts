import { Pool } from 'pg';
import { getDatabaseUrl } from './env';

// PostgreSQL 连接配置 - 纯环境变量驱动，禁止硬编码
function getPoolConfig() {
  // 优先使用统一的数据库URL获取函数（兼容多种环境变量名）
  const DATABASE_URL = getDatabaseUrl();

  if (DATABASE_URL) {
    // 兼容多种 URL 格式（带查询参数等）
    const url = new URL(DATABASE_URL.replace('postgresql://', 'http://'));
    const isPooler = url.hostname.includes('pooler.supabase.com');

    return {
      user: url.username,
      password: decodeURIComponent(url.password),
      host: url.hostname,
      port: parseInt(url.port || '5432'),
      database: url.pathname.slice(1),
      ssl: { rejectUnauthorized: false },
      // Supabase Pooler (PgBouncer) 不支持预处理语句，必须禁用
      ...(isPooler ? { prepare: false } : {}),
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };
  }

  // 回退：使用分离的环境变量
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  const host = process.env.PGHOST;
  const port = process.env.PGPORT;
  const database = process.env.PGDATABASE;

  if (user && password && host && database) {
    console.log('[db] Using PGUSER/PGHOST environment variables');
    return {
      user,
      password,
      host,
      port: parseInt(port || '5432'),
      database,
      ssl: { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };
  }

  // 没有配置任何数据库连接信息，给出明确报错
  console.error('❌ 数据库未配置！请设置环境变量 PGDATABASE_URL 或 PGUSER/PGPASSWORD/PGHOST/PGDATABASE');
  throw new Error('数据库连接信息未配置，请设置 PGDATABASE_URL 环境变量');
}

const pool = new Pool(getPoolConfig());

// 添加连接错误处理
pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client', err);
});

/**
 * 执行 SQL 查询
 */
export async function query(text: string, params?: any[]) {
  const client = await pool.connect();
  try {
    // 每次查询设置 schema
    await client.query(`SET search_path TO public`);
    const result = await client.query(text, params);
    return result.rows;
  } finally {
    client.release();
  }
}
