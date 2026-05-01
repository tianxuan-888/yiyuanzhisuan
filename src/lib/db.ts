import { Pool } from 'pg';

// PostgreSQL 连接配置 - 纯环境变量驱动，禁止硬编码
function getPoolConfig() {
  // 优先使用 PGDATABASE_URL 连接字符串
  const DATABASE_URL = process.env.PGDATABASE_URL || process.env.DATABASE_URL;

  if (DATABASE_URL) {
    const match = DATABASE_URL.match(/postgresql:\/\/([^:@]+):([^@]+)@([^:]+):(\d+)\/(\w+)/);
    if (match) {
      console.log('[db] Using DATABASE_URL connection');
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
