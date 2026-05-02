// Re-export from pg-client for backward compatibility
export { query, queryOne, execute, withTransaction, getPool, pool, isSupabaseRestMode, getSupabase } from './pg-client';
export type { QueryResult } from './pg-client';
export type { QueryResultRow } from './pg-client';
