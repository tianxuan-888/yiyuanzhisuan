import { query } from './pg-client';

/**
 * 邀请码类型
 */
export type InviteCodeType = 'admin' | 'branch' | 'provider' | 'member' | 'invalid';

/**
 * 角色前缀映射（2字母前缀，用于唯一ID和邀请码）
 * 邀请码 = 唯一ID = 2字母角色前缀 + 5位数字
 */
export const ROLE_PREFIX_MAP: Record<string, string> = {
  admin: 'AD',
  branch: 'BR',
  provider: 'PV',
  member: 'MB',
};

/**
 * 前缀到角色的反向映射
 */
const PREFIX_TO_ROLE: Record<string, string> = {
  'AD': 'admin',
  'BR': 'branch',
  'PV': 'provider',
  'MB': 'member',
};

/**
 * 根据邀请码（唯一ID）前缀判断类型
 * 新格式：2字母角色前缀 + 5位数字，如 MB12345, PV00001
 */
export function getInviteCodeType(inviteCode: string): InviteCodeType {
  if (!inviteCode || inviteCode.length < 2) {
    return 'invalid';
  }
  
  const prefix = inviteCode.substring(0, 2).toUpperCase();
  const role = PREFIX_TO_ROLE[prefix];
  
  if (role) {
    return role as InviteCodeType;
  }
  
  // 兼容旧格式邀请码
  const upperCode = inviteCode.toUpperCase();
  if (upperCode.startsWith('ADMIN')) return 'admin';
  if (upperCode.startsWith('BRAN')) return 'branch';
  if (upperCode.startsWith('PROV')) return 'provider';
  if (upperCode.startsWith('MEMB')) return 'member';
  
  return 'invalid';
}

/**
 * 生成唯一的邀请码（= 唯一ID）
 * 格式：2字母角色前缀 + 5位数字
 */
export async function generateUniqueId(role: string): Promise<string> {
  const prefix = ROLE_PREFIX_MAP[role] || 'MB';
  
  // 查找该前缀下已存在的最大编号
  const result = await query(
    `SELECT unique_id FROM users WHERE unique_id LIKE $1 ORDER BY unique_id DESC LIMIT 1`,
    [`${prefix}%`]
  );
  
  let nextNum = 1;
  if (result.length > 0) {
    const existingId = result[0].unique_id as string;
    const numPart = existingId.substring(2); // 去掉前2字母
    const existingNum = parseInt(numPart, 10);
    if (!isNaN(existingNum)) {
      nextNum = existingNum + 1;
    }
  }
  
  const uniqueId = `${prefix}${String(nextNum).padStart(5, '0')}`;
  
  // 确保唯一性
  const check = await query('SELECT id FROM users WHERE unique_id = $1', [uniqueId]);
  if (check.length > 0) {
    // 冲突时递增
    for (let i = nextNum + 1; i < nextNum + 100; i++) {
      const tryId = `${prefix}${String(i).padStart(5, '0')}`;
      const checkAgain = await query('SELECT id FROM users WHERE unique_id = $1', [tryId]);
      if (checkAgain.length === 0) {
        return tryId;
      }
    }
    throw new Error('生成唯一ID失败，请重试');
  }
  
  return uniqueId;
}

/**
 * 保留旧函数名兼容（已废弃，请使用 generateUniqueId）
 */
export async function generateInviteCode(prefix: string = 'MB'): Promise<string> {
  const roleMap: Record<string, string> = {
    'ADMIN': 'admin',
    'BRAN': 'branch',
    'PROV': 'provider',
    'MEMB': 'member',
  };
  const role = roleMap[prefix] || 'member';
  return generateUniqueId(role);
}

export async function generateAdminInviteCode(): Promise<string> {
  return generateUniqueId('admin');
}

export async function generateBranchInviteCode(): Promise<string> {
  return generateUniqueId('branch');
}

export async function generateProviderInviteCode(): Promise<string> {
  return generateUniqueId('provider');
}

export async function generateMemberInviteCode(): Promise<string> {
  return generateUniqueId('member');
}

/**
 * 根据邀请码查找用户
 * 邀请码 = 唯一ID，所以查 unique_id 字段
 */
export async function findUserByInviteCode(inviteCode: string) {
  // 先查 unique_id（新逻辑）
  const usersById = await query(
    'SELECT id, username, role, provider_id, branch_id, unique_id FROM users WHERE unique_id = $1',
    [inviteCode]
  );
  if (usersById.length > 0) return usersById[0];
  
  // 兼容旧的 invite_code 字段
  const usersByCode = await query(
    'SELECT id, username, role, provider_id, branch_id, unique_id FROM users WHERE invite_code = $1',
    [inviteCode]
  );
  return usersByCode.length > 0 ? usersByCode[0] : null;
}

/**
 * 根据邀请码查找用户（带角色限制）
 */
export async function findUserByInviteCodeWithRole(inviteCode: string, role: string) {
  // 先查 unique_id
  const usersById = await query(
    'SELECT id, username, role, provider_id, branch_id, unique_id FROM users WHERE unique_id = $1 AND role = $2',
    [inviteCode, role]
  );
  if (usersById.length > 0) return usersById[0];
  
  // 兼容旧 invite_code 字段
  const usersByCode = await query(
    'SELECT id, username, role, provider_id, branch_id, unique_id FROM users WHERE invite_code = $1 AND role = $2',
    [inviteCode, role]
  );
  return usersByCode.length > 0 ? usersByCode[0] : null;
}
