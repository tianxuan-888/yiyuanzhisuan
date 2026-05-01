import { Pool, PoolClient } from 'pg';

// 延迟初始化连接池
let pool: Pool | null = null;

// 解析连接字符串
function getPoolConfig() {
  const DATABASE_URL = process.env.PGDATABASE_URL || process.env.DATABASE_URL;
  
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
  
  // 默认配置（运行时必须设置环境变量）
  return {
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'postgres',
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
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
