/**
 * 验证码存储模块
 * 使用 Supabase 数据库持久化存储，解决服务重启丢失问题
 */
import { queryOne, execute } from '@/lib/pg-client';

/**
 * 确保验证码表存在
 */
async function ensureTable() {
  await execute(`
    CREATE TABLE IF NOT EXISTS sms_verify_codes (
      id SERIAL PRIMARY KEY,
      phone VARCHAR(20) NOT NULL,
      code VARCHAR(10) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // 创建索引加速查询
  await execute(`
    CREATE INDEX IF NOT EXISTS idx_sms_verify_codes_phone ON sms_verify_codes(phone)
  `).catch(() => {/* index may already exist */});
}

/**
 * 存储验证码
 */
export async function setVerifyCode(phone: string, code: string, expiresInMs: number = 5 * 60 * 1000) {
  await ensureTable();
  const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
  // 先删除该手机号的旧验证码，再插入新的
  await execute('DELETE FROM sms_verify_codes WHERE phone = $1', [phone]);
  await execute('INSERT INTO sms_verify_codes (phone, code, expires_at) VALUES ($1, $2, $3)', [phone, code, expiresAt]);
}

/**
 * 获取并验证验证码
 */
export async function getVerifyCode(phone: string): Promise<{ code: string; expiresAt: number } | undefined> {
  await ensureTable();
  // 清理过期验证码
  await execute('DELETE FROM sms_verify_codes WHERE expires_at < NOW()').catch(() => {});
  
  const row = await queryOne('SELECT code, expires_at FROM sms_verify_codes WHERE phone = $1', [phone]);
  if (!row) return undefined;
  
  return {
    code: row.code as string,
    expiresAt: new Date(row.expires_at as string).getTime(),
  };
}

/**
 * 删除验证码
 */
export async function deleteVerifyCode(phone: string) {
  await execute('DELETE FROM sms_verify_codes WHERE phone = $1', [phone]).catch(() => {});
}

/**
 * 清理过期验证码
 */
export async function cleanExpiredCodes() {
  await execute('DELETE FROM sms_verify_codes WHERE expires_at < NOW()').catch(() => {});
}
