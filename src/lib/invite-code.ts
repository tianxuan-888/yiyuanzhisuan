import { query } from './pg-client';

/**
 * 邀请码类型
 */
export type InviteCodeType = 'provider' | 'member' | 'invalid';

/**
 * 根据邀请码前缀判断类型
 */
export function getInviteCodeType(inviteCode: string): InviteCodeType {
  if (!inviteCode) {
    return 'invalid';
  }
  
  const upperCode = inviteCode.toUpperCase();
  
  if (upperCode.startsWith('PROV')) {
    return 'provider';
  }
  
  if (upperCode.startsWith('MEMB')) {
    return 'member';
  }
  
  return 'invalid';
}

/**
 * 生成唯一的邀请码
 */
export async function generateInviteCode(prefix: string = 'PROV'): Promise<string> {
  const generateCode = (): string => {
    const randomNum = Math.floor(Math.random() * 1000000);
    return `${prefix}${String(randomNum).padStart(6, '0')}`;
  };
  
  // 检查邀请码是否已存在
  const isCodeExists = async (code: string): Promise<boolean> => {
    const users = await query(
      'SELECT id FROM users WHERE invite_code = $1',
      [code]
    );
    return users.length > 0;
  };
  
  // 生成唯一的邀请码（最多尝试10次）
  for (let i = 0; i < 10; i++) {
    const code = generateCode();
    const exists = await isCodeExists(code);
    if (!exists) {
      return code;
    }
  }
  
  throw new Error('生成邀请码失败，请重试');
}

/**
 * 生成服务商邀请码
 */
export async function generateProviderInviteCode(): Promise<string> {
  return generateInviteCode('PROV');
}

/**
 * 生成会员邀请码
 */
export async function generateMemberInviteCode(): Promise<string> {
  return generateInviteCode('MEMB');
}

/**
 * 根据邀请码查找用户
 */
export async function findUserByInviteCode(inviteCode: string) {
  const users = await query(
    'SELECT id, username, role, provider_id, branch_id FROM users WHERE invite_code = $1',
    [inviteCode]
  );
  return users.length > 0 ? users[0] : null;
}

/**
 * 根据邀请码查找用户（带角色限制）
 */
export async function findUserByInviteCodeWithRole(inviteCode: string, role: string) {
  const users = await query(
    'SELECT id, username, role, provider_id, branch_id FROM users WHERE invite_code = $1 AND role = $2',
    [inviteCode, role]
  );
  return users.length > 0 ? users[0] : null;
}
