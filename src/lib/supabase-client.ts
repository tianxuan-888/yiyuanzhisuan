import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.COZE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.COZE_SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn('[supabase-client] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/**
 * Execute SQL query via Supabase RPC (rpc_query function)
 */
export async function rpcQuery<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[]; rowCount: number }> {
  const { data, error } = await supabase.rpc('rpc_query', { sql_query: sql });

  if (error) {
    throw new Error(`Supabase RPC error: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  return { rows: rows as T[], rowCount: rows.length };
}

/**
 * Execute SQL that modifies data (INSERT/UPDATE/DELETE)
 * Returns the affected rows
 */
export async function rpcExecute<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[]; rowCount: number }> {
  // For INSERT/UPDATE/DELETE with RETURNING, use the same rpc_query
  const { data, error } = await supabase.rpc('rpc_query', { sql_query: sql });

  if (error) {
    throw new Error(`Supabase RPC execute error: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  return { rows: rows as T[], rowCount: rows.length };
}

/**
 * Execute multiple SQL statements in a transaction-like manner
 * Note: Supabase REST API doesn't support true transactions,
 * so we execute them sequentially. For critical operations,
 * consider using the pg pool directly if available.
 */
export async function rpcTransaction<T = Record<string, unknown>>(
  queries: string[]
): Promise<{ rows: T[]; rowCount: number }[]> {
  const results: { rows: T[]; rowCount: number }[] = [];

  for (const sql of queries) {
    const result = await rpcExecute<T>(sql);
    results.push(result);
  }

  return results;
}

// Helper to check if Supabase REST mode is available
export function isSupabaseRestMode(): boolean {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

// Export type-compatible pool interface
export const supabasePool = {
  query: rpcQuery,
};
