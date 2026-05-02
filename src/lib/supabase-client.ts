/**
 * Supabase REST API 兼容层
 * 替代 PostgreSQL 直连，通过 Supabase JS Client 执行数据库操作
 * 
 * 提供与原 pg-client 相同的接口：query, queryOne, execute, withTransaction, pool
 * 让所有现有 API 路由无需修改即可使用
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.COZE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.COZE_SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[supabase-client] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
}

// 单例 Supabase 客户端
let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _supabase;
}

/**
 * 查询接口返回类型
 * 使用 any 类型兼容原始 pg 库的返回行为
 */
export interface QueryResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[];
  rowCount: number;
  command: string;
}

/**
 * 兼容客户端 - 模拟 pg Client 接口
 */
class CompatClient {
  private supabase: SupabaseClient;

  constructor(supabase?: SupabaseClient) {
    this.supabase = supabase || getSupabase();
  }

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    return executeSql(this.supabase, sql, params);
  }
}

/**
 * 执行 SQL 语句
 * 优先使用 Supabase JS Client 直接操作表，对复杂 SQL 使用 REST API rpc
 */
async function executeSql(supabase: SupabaseClient, sql: string, params?: unknown[]): Promise<QueryResult> {
  // 替换参数占位符 $1, $2, ... 为实际值
  let finalSql = sql;
  if (params && params.length > 0) {
    for (let i = 0; i < params.length; i++) {
      const placeholder = new RegExp('\\$' + (i + 1), 'g');
      const value = params[i];
      if (value === null || value === undefined) {
        finalSql = finalSql.replace(placeholder, 'NULL');
      } else if (Array.isArray(value)) {
        // PostgreSQL 数组格式: '{val1,val2,val3}'::type[]
        // 检测上下文是 ANY($N) 还是 IN ($N) 来决定格式
        const arrayValues = value.map(v => {
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number') return String(v);
          if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
          const escaped = String(v).replace(/'/g, "''");
          return '"' + escaped + '"';
        });
        // 使用 ARRAY[] 构造器，更安全且类型兼容
        const arrayLiteral = 'ARRAY[' + value.map(v => {
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number') return String(v);
          if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
          const escaped = String(v).replace(/'/g, "''");
          return "'" + escaped + "'";
        }).join(', ') + ']';
        finalSql = finalSql.replace(placeholder, arrayLiteral);
      } else if (typeof value === 'number') {
        finalSql = finalSql.replace(placeholder, String(value));
      } else if (typeof value === 'boolean') {
        finalSql = finalSql.replace(placeholder, value ? 'TRUE' : 'FALSE');
      } else if (value instanceof Date) {
        finalSql = finalSql.replace(placeholder, "'" + value.toISOString() + "'");
      } else {
        // 字符串转义单引号
        const escaped = String(value).replace(/'/g, "''");
        finalSql = finalSql.replace(placeholder, "'" + escaped + "'");
      }
    }
  }

  const trimmedSql = finalSql.trim();
  const command = trimmedSql.split(/\s+/)[0].toUpperCase();

  // SELECT 语句：通过 rpc_query 执行
  if (command === 'SELECT' || command === 'WITH') {
    try {
      const { data, error } = await supabase.rpc('rpc_query', { sql_query: trimmedSql });
      if (!error) {
        const rows = Array.isArray(data) ? data : (data ? [data] : []);
        return { rows, rowCount: rows.length, command };
      }
      if (!error.message.includes('Could not find the function')) {
        console.error('[supabase-client] rpc_query error:', error.message);
        throw new Error('Supabase RPC error: ' + error.message);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('Could not find the function')) {
        throw e;
      }
    }
    // rpc_query 不可用，fallthrough 到解析方式
    return parseAndExecute(supabase, trimmedSql);
  }

  // 写操作 (INSERT/UPDATE/DELETE)：优先通过 rpc_execute 执行
  try {
    const { data, error } = await supabase.rpc('rpc_execute', { sql_query: trimmedSql });
    if (!error) {
      // rpc_execute 返回两种格式：RETURNING 时返回数组，否则返回 {rowCount: N}
      if (data && Array.isArray(data)) {
        return { rows: data, rowCount: data.length, command };
      }
      if (data && typeof data === 'object' && 'rowCount' in data) {
        return { rows: [], rowCount: data.rowCount || 0, command };
      }
      return { rows: data ? [data] : [], rowCount: data ? 1 : 0, command };
    }
    if (!error.message.includes('Could not find the function')) {
      console.error('[supabase-client] rpc_execute error:', error.message);
      throw new Error('Supabase RPC error: ' + error.message);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('Could not find the function')) {
      throw e;
    }
    // rpc_execute 不可用，fallthrough 到解析方式
  }

  // Fallback: 解析简单 SQL 用 Supabase JS Client 直接操作
  return parseAndExecute(supabase, trimmedSql);
}

/**
 * 解析简单 SQL 并用 Supabase JS Client 直接操作
 * 支持：SELECT, INSERT, UPDATE, DELETE 基本模式
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parseAndExecute(supabase: SupabaseClient, sql: string): Promise<QueryResult> {
  const upperSql = sql.toUpperCase().trim();

  // SELECT ... FROM table WHERE ... ORDER BY ... LIMIT ...
  const selectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+([\s\S]+?))?(?:\s+LIMIT\s+(\d+))?(?:\s+OFFSET\s+(\d+))?\s*$/i);
  if (selectMatch) {
    const [, columns, table, whereClause, orderBy, limit, offset] = selectMatch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = supabase.from(table).select(columns.trim());

    // 解析 WHERE 子句（简单等值条件）
    if (whereClause) {
      query = applyWhereClause(query, whereClause);
    }

    // ORDER BY
    if (orderBy) {
      const parts = orderBy.trim().split(/\s+/);
      const col = parts[0];
      const dir = parts[1]?.toUpperCase() === 'DESC' ? false : true;
      query = query.order(col, { ascending: dir });
    }

    // LIMIT / OFFSET
    if (limit) query = query.limit(parseInt(limit));
    if (offset) query = query.range(parseInt(offset), parseInt(offset) + (limit ? parseInt(limit) : 100) - 1);

    const { data, error } = await query;
    if (error) throw new Error('Supabase query error: ' + error.message);
    return { rows: (data as Record<string, unknown>[]) || [], rowCount: (data as Record<string, unknown>[])?.length || 0, command: 'SELECT' };
  }

  // INSERT INTO table (cols) VALUES (vals)
  const insertMatch = sql.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*(?:RETURNING\s+(.+))?/i);
  if (insertMatch) {
    const [, table, cols, vals, returning] = insertMatch;
    const colNames = cols.split(',').map(c => c.trim());
    const valParts = parseValueList(vals);
    const record: Record<string, unknown> = {};
    colNames.forEach((col, i) => { record[col] = valParts[i]; });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = supabase.from(table).insert(record);
    if (returning) query = query.select(returning.trim());
    else query = query.select('*');

    const { data, error } = await query;
    if (error) throw new Error('Supabase insert error: ' + error.message);
    return { rows: (data as Record<string, unknown>[]) || [], rowCount: (data as Record<string, unknown>[])?.length || 0, command: 'INSERT' };
  }

  // UPDATE table SET col=val WHERE condition RETURNING *
  const updateMatch = sql.match(/UPDATE\s+(\w+)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+?)(?:\s+RETURNING\s+(.+))?$/i);
  if (updateMatch) {
    const [, table, setClause, whereClause, returning] = updateMatch;
    const setParts = parseSetClause(setClause);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = supabase.from(table).update(setParts);
    query = applyWhereClause(query, whereClause);
    if (returning) query = query.select(returning.trim());
    else query = query.select('*');

    const { data, error } = await query;
    if (error) throw new Error('Supabase update error: ' + error.message);
    return { rows: (data as Record<string, unknown>[]) || [], rowCount: (data as Record<string, unknown>[])?.length || 0, command: 'UPDATE' };
  }

  // DELETE FROM table WHERE condition RETURNING *
  const deleteMatch = sql.match(/DELETE\s+FROM\s+(\w+)\s+WHERE\s+([\s\S]+?)(?:\s+RETURNING\s+(.+))?$/i);
  if (deleteMatch) {
    const [, table, whereClause, returning] = deleteMatch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = supabase.from(table).delete();
    query = applyWhereClause(query, whereClause);
    if (returning) query = query.select(returning.trim());
    else query = query.select('*');

    const { data, error } = await query;
    if (error) throw new Error('Supabase delete error: ' + error.message);
    return { rows: (data as Record<string, unknown>[]) || [], rowCount: (data as Record<string, unknown>[])?.length || 0, command: 'DELETE' };
  }

  // 无法解析的 SQL，尝试用 rpc
  throw new Error('Unsupported SQL pattern, rpc_query not available: ' + sql.substring(0, 100));
}

/**
 * 解析 VALUES 列表
 */
function parseValueList(vals: string): unknown[] {
  const result: unknown[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < vals.length; i++) {
    const ch = vals[i];
    if (inString) {
      if (ch === stringChar && vals[i + 1] === stringChar) {
        current += ch; i++; // escaped quote
      } else if (ch === stringChar) {
        inString = false;
        current += ch;
      } else {
        current += ch;
      }
    } else {
      if (ch === "'" || ch === '"') {
        inString = true;
        stringChar = ch;
        current += ch;
      } else if (ch === ',') {
        result.push(parseValue(current.trim()));
        current = '';
      } else {
        current += ch;
      }
    }
  }
  if (current.trim()) result.push(parseValue(current.trim()));
  return result;
}

function parseValue(val: string): unknown {
  if (val.toUpperCase() === 'NULL') return null;
  if (val.toUpperCase() === 'TRUE') return true;
  if (val.toUpperCase() === 'FALSE') return false;
  if (/^'.*'$/.test(val)) return val.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(val)) return parseFloat(val);
  return val;
}

/**
 * 解析 SET 子句
 */
function parseSetClause(setClause: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  // 处理 col = val, col = val 模式
  const parts = setClause.split(/,(?=(?:[^']*'[^']*')*[^']*$)/);
  for (const part of parts) {
    const eqMatch = part.trim().match(/^(\w+)\s*=\s*(.+)$/);
    if (eqMatch) {
      result[eqMatch[1]] = parseValue(eqMatch[2].trim());
    }
  }
  return result;
}

/**
 * 应用 WHERE 子句到查询
 * 支持: col = val, col != val, col > val, col < val, col IS NULL, col IS NOT NULL
 * 支持 AND 连接
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyWhereClause(query: any, whereClause: string): any {
  // 简化处理：拆分 AND 条件
  const conditions = whereClause.split(/\s+AND\s+/i);

  for (const cond of conditions) {
    const trimmed = cond.trim();

    // col IS NULL
    const isNullMatch = trimmed.match(/^(\w+)\s+IS\s+NULL$/i);
    if (isNullMatch) { query = query.is(isNullMatch[1], null); continue; }

    // col IS NOT NULL
    const isNotNullMatch = trimmed.match(/^(\w+)\s+IS\s+NOT\s+NULL$/i);
    if (isNotNullMatch) { query = query.not(isNotNullMatch[1], 'is', null); continue; }

    // col IN (val1, val2, ...)
    const inMatch = trimmed.match(/^(\w+)\s+IN\s*\((.+)\)$/i);
    if (inMatch) {
      const vals = parseValueList(inMatch[2]);
      query = query.in(inMatch[1], vals as unknown[]);
      continue;
    }

    // col != val 或 col <> val
    const neqMatch = trimmed.match(/^(\w+)\s*(?:!=|<>)\s*(.+)$/);
    if (neqMatch) { query = query.neq(neqMatch[1], parseValue(neqMatch[2])); continue; }

    // col > val
    const gtMatch = trimmed.match(/^(\w+)\s*>\s*(.+)$/);
    if (gtMatch && !trimmed.includes('>=')) { query = query.gt(gtMatch[1], parseValue(gtMatch[2]) as number); continue; }

    // col >= val
    const gteMatch = trimmed.match(/^(\w+)\s*>=\s*(.+)$/);
    if (gteMatch) { query = query.gte(gteMatch[1], parseValue(gteMatch[2]) as number); continue; }

    // col < val
    const ltMatch = trimmed.match(/^(\w+)\s*<\s*(.+)$/);
    if (ltMatch && !trimmed.includes('<=')) { query = query.lt(ltMatch[1], parseValue(ltMatch[2]) as number); continue; }

    // col <= val
    const lteMatch = trimmed.match(/^(\w+)\s*<=\s*(.+)$/);
    if (lteMatch) { query = query.lte(lteMatch[1], parseValue(lteMatch[2]) as number); continue; }

    // col = val（默认）
    const eqMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (eqMatch) { query = query.eq(eqMatch[1], parseValue(eqMatch[2])); continue; }
  }

  return query;
}

/**
 * 导出兼容接口
 * 
 * 重要：原代码中 query<T>() 返回 T[]（行数组），
 * 而 withTransaction 回调中 client.query() 返回 { rows, rowCount }（pg Client 风格）
 */

// query - 执行 SQL 查询，返回行数组（兼容原 query<T>() 返回 T[] 的用法）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T = any>(sql: string, params?: unknown[]): Promise<T[]> {
  const result = await executeSql(getSupabase(), sql, params);
  return result.rows as T[];
}

// queryOne - 查询单条记录
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function queryOne<T = any>(sql: string, params?: unknown[]): Promise<T | null> {
  const result = await executeSql(getSupabase(), sql, params);
  return (result.rows[0] as T) || null;
}

// execute - 执行写操作，返回 { rows, rowCount }
export async function execute(sql: string, params?: unknown[]): Promise<QueryResult> {
  return executeSql(getSupabase(), sql, params);
}

// withTransaction - 模拟事务（Supabase REST API 不支持真正事务）
// 回调中 client.query() 返回 { rows, rowCount } 格式（兼容 pg Client）
export async function withTransaction<T>(
  callback: (client: { query: (sql: string, params?: unknown[]) => Promise<QueryResult>; execute: (sql: string, params?: unknown[]) => Promise<QueryResult> }) => Promise<T>
): Promise<T> {
  // REST API 不支持事务，直接执行
  const client = new CompatClient();
  return callback({
    query: client.query.bind(client),
    execute: client.query.bind(client),
  });
}

// pool - 兼容原有 pool.query() 调用，返回 { rows, rowCount }
export const pool = {
  query: async (sql: string, params?: unknown[]): Promise<QueryResult> => {
    return executeSql(getSupabase(), sql, params);
  },
};

// getPool - 兼容原有 getPool() 调用
export function getPool() {
  return pool;
}

export default {
  query,
  queryOne,
  execute,
  withTransaction,
  pool,
  getPool,
  getSupabase,
};
