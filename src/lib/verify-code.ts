/**
 * 验证码存储模块
 * 共享给 send-verify-code 和 register API 使用
 */

// 存储验证码（内存中，生产环境应使用Redis）
const verifyCodes: Map<string, { code: string; expiresAt: number }> = new Map();

/**
 * 存储验证码
 */
export function setVerifyCode(phone: string, code: string, expiresInMs: number = 5 * 60 * 1000) {
  verifyCodes.set(phone, {
    code,
    expiresAt: Date.now() + expiresInMs
  });
}

/**
 * 获取并验证验证码
 */
export function getVerifyCode(phone: string): { code: string; expiresAt: number } | undefined {
  return verifyCodes.get(phone);
}

/**
 * 删除验证码
 */
export function deleteVerifyCode(phone: string) {
  verifyCodes.delete(phone);
}

/**
 * 清理过期验证码
 */
export function cleanExpiredCodes() {
  const now = Date.now();
  for (const [phone, data] of verifyCodes.entries()) {
    if (data.expiresAt < now) {
      verifyCodes.delete(phone);
    }
  }
}

export { verifyCodes };
