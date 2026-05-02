/**
 * 数据库客户端 - 通过 Supabase REST API 兼容层
 * 
 * 导出与原 pg Pool 完全相同的接口
 * 所有 API 路由通过 import { query, queryOne, execute, withTransaction } from '@/lib/pg-client' 使用
 * 
 * 接口说明：
 * - query<T>(sql, params) → T[]  （行数组，兼容原代码用法）
 * - queryOne<T>(sql, params) → T | null
 * - execute(sql, params) → { rows, rowCount }
 * - withTransaction(cb) → cb 中 client.query() 返回 { rows, rowCount }（pg Client 风格）
 */

// Re-export from supabase-client (REST API 兼容层)
export { query, queryOne, execute, withTransaction, pool, getPool, getSupabase } from './supabase-client';

// Re-export QueryResult type
export type { QueryResult } from './supabase-client';

// 兼容类型定义
export interface QueryResultRow {
  [key: string]: unknown;
}

// 永远为 true - 当前模式就是 REST API 模式
export const isSupabaseRestMode = true;
