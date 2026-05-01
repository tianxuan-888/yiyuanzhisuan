import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

/**
 * 对明文密码进行哈希
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * 验证明文密码是否匹配哈希值
 */
export async function verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, hashedPassword);
}
