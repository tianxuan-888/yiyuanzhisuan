import { supabase, rpcQuery, rpcExecute, isSupabaseRestMode } from './supabase-client';

export interface QueryResultRow {
  [key: string]: unknown;
}

export interface QueryResult {
  rows: QueryResultRow[];
  rowCount: number;
}

// Supabase REST API mode - no pg Pool needed
async function restQuery(sql: string): Promise<QueryResult> {
  const result = await rpcQuery<QueryResultRow>(sql);
  return { rows: result.rows, rowCount: result.rowCount };
}

async function restExecute(sql: string): Promise<QueryResult> {
  const result = await rpcExecute<QueryResultRow>(sql);
  return { rows: result.rows, rowCount: result.rowCount };
}

// Public API - same interface as before
export async function query(sql: string, params?: unknown[]): Promise<QueryResult> {
  if (params && params.length > 0) {
    let idx = 0;
    sql = sql.replace(/\$/g, () => {
      idx++;
      const val = params[idx - 1];
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'number') return String(val);
      if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
      if (val instanceof Date) return `'${val.toISOString()}'`;
      if (Array.isArray(val)) return `'${JSON.stringify(val)}'`;
      // Escape single quotes in strings
      return `'${String(val).replace(/'/g, "''")}'`;
    });
  }
  return restQuery(sql);
}

export async function queryOne(sql: string, params?: unknown[]): Promise<QueryResultRow | null> {
  const result = await query(sql, params);
  return result.rows[0] || null;
}

export async function execute(sql: string, params?: unknown[]): Promise<QueryResult> {
  if (params && params.length > 0) {
    let idx = 0;
    sql = sql.replace(/\$/g, () => {
      idx++;
      const val = params[idx - 1];
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'number') return String(val);
      if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
      if (val instanceof Date) return `'${val.toISOString()}'`;
      if (Array.isArray(val)) return `'${JSON.stringify(val)}'`;
      return `'${String(val).replace(/'/g, "''")}'`;
    });
  }
  return restExecute(sql);
}

// Transaction support - execute sequentially (no true DB transactions over REST)
export async function withTransaction<T>(
  callback: (client: { query: typeof query; execute: typeof execute }) => Promise<T>
): Promise<T> {
  // Since we can't do real transactions over REST API,
  // just execute the callback with the same query/execute functions
  return callback({ query, execute });
}

export function getPool() {
  return {
    query,
  };
}

export const pool = {
  query,
};

// Re-export for backward compatibility
export { isSupabaseRestMode };
