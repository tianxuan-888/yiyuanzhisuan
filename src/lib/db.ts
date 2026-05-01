import { Pool } from 'pg';

// PostgreSQL 连接配置 - 统一使用 PGDATABASE_URL
const PGDATABASE_URL = process.env.PGDATABASE_URL;

function getPoolConfig() {
  if (PGDATABASE_URL) {
    const match = PGDATABASE_URL.match(/postgresql:\/\/([^:@]+):([^@]+)@([^:]+):(\d+)\/(\w+)/);
    if (match) {
      console.log('[db] Using PGDATABASE_URL connection');
      return {
        user: match[1],
        password: match[2],
        host: match[3],
        port: parseInt(match[4]),
        database: match[5],
        ssl: { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      };
    }
  }
  
  // 回退：使用 Supabase 直连
  console.log('[db] FALLBACK to Supabase direct connection');
  return {
    user: 'postgres',
    password: 'kOitcf2zZH7FM2To',
    host: 'db.yhpuqkngvdmjokkrfumu.supabase.co',
    port: 5432,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  };
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
