import { Pool, PoolClient } from 'pg';
import { getDatabaseUrl } from './env';

// 延迟初始化连接池
let pool: Pool | null = null;

// 解析连接字符串
function getPoolConfig() {
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
      database: url.pathname.slice(1), // 去掉开头的 /
      ssl: { rejectUnauthorized: false },
      // Supabase Pooler (PgBouncer) 不支持预处理语句，必须禁用
      ...(isPooler ? { prepare: false } : {}),
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };
  }
  
  // 回退：使用分离的环境变量（排除 Vercel 自动注入的无效 PGHOST）
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  const host = process.env.PGHOST;
  const port = process.env.PGPORT;
  const database = process.env.PGDATABASE;

  // Vercel 会自动注入 PGHOST=postgres（内部地址），这不能用于连接外部 Supabase
  const isValidHost = host && host !== 'postgres' && host !== 'localhost';

  if (user && password && isValidHost && database) {
    return {
      user,
      password,
      host,
      port: parseInt(port || '5432'),
      database,
      ssl: { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };
  }

  // 没有配置任何数据库连接信息，给出明确报错
  console.error('❌ 数据库未配置！请设置环境变量 PGDATABASE_URL 或 PGUSER/PGPASSWORD/PGHOST/PGDATABASE');
  throw new Error('数据库连接信息未配置，请设置 PGDATABASE_URL 环境变量');
}

// 获取连接池（延迟初始化）
function getPool(): Pool {
  if (!pool) {
    pool = new Pool(getPoolConfig());
    pool.on('error', (err) => {
      console.error('[pg-client] 连接错误:', err.message);
    });
  }
  return pool;
}

export { getPool };

// 导出 pool 以兼容旧代码
export { getPool as pool };

/**
 * 执行 SQL 查询
 */
export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const client = await getPool().connect();
  try {
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

/**
 * 执行 SQL 查询并返回单行
 */
export async function queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * 执行带事务的 SQL
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 执行 SQL（别名）
 */
export const execute = query;
