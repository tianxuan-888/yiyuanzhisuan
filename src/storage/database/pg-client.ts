import { Pool, PoolClient } from 'pg';
import { getDatabaseUrl } from '@/lib/env';

// 延迟初始化连接池
let pool: Pool | null = null;

// 解析连接字符串
function getPoolConfig() {
  const DATABASE_URL = getDatabaseUrl();
  
  if (DATABASE_URL) {
    const urlMatch = DATABASE_URL.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(\w+)/);
    if (urlMatch) {
      return {
        user: urlMatch[1],
        password: urlMatch[2],
        host: urlMatch[3],
        port: parseInt(urlMatch[4]),
        database: urlMatch[5],
        ssl: { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      };
    }
  }
  
  // 回退：使用分离的环境变量
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  const host = process.env.PGHOST;
  const port = process.env.PGPORT;
  const database = process.env.PGDATABASE;

  if (user && password && host && database) {
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
 * 执行 SQL（别名）
 */
export const execute = query;

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
