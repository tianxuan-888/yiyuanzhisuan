import { query } from './pg-client';
import { getSupabase } from './supabase-client';

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
 * 直接使用 Supabase REST API 查询
 */
export async function generateUniqueId(role: string): Promise<string> {
  const prefix = ROLE_PREFIX_MAP[role] || 'MB';
  const supabase = getSupabase();
  
  // 查找该前缀下已存在的最大编号
  const { data, error } = await supabase
    .from('users')
    .select('unique_id')
    .like('unique_id', `${prefix}%`)
    .order('unique_id', { ascending: false })
    .limit(1);
  
  if (error) {
    console.error('[invite-code] generateUniqueId query error:', error.message);
  }
  
  let nextNum = 1;
  if (data && data.length > 0) {
    const existingId = data[0].unique_id as string;
    const numPart = existingId.substring(2); // 去掉前2字母
    const existingNum = parseInt(numPart, 10);
    if (!isNaN(existingNum)) {
      nextNum = existingNum + 1;
    }
  }
  
  const uniqueId = `${prefix}${String(nextNum).padStart(5, '0')}`;
  
  // 确保唯一性
  const { data: checkData } = await supabase
    .from('users')
    .select('id')
    .eq('unique_id', uniqueId)
    .limit(1);
  
  if (checkData && checkData.length > 0) {
    // 冲突时递增
    for (let i = nextNum + 1; i < nextNum + 100; i++) {
      const tryId = `${prefix}${String(i).padStart(5, '0')}`;
      const { data: checkAgain } = await supabase
        .from('users')
        .select('id')
        .eq('unique_id', tryId)
        .limit(1);
      if (!checkAgain || checkAgain.length === 0) {
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
 * 直接使用 Supabase REST API 查询，绕过 rpc_query/parseAndExecute 的不稳定性
 */
export async function findUserByInviteCode(inviteCode: string) {
  const supabase = getSupabase();
  
  // 先查 unique_id（主逻辑）
  const { data: byId, error: err1 } = await supabase
    .from('users')
    .select('id, username, role, provider_id, branch_id, unique_id')
    .eq('unique_id', inviteCode)
    .limit(1);
  
  if (err1) {
    console.error('[invite-code] findUserByInviteCode unique_id query error:', err1.message);
  }
  if (byId && byId.length > 0) return byId[0];
  
  // 兼容旧的 invite_code 字段
  const { data: byCode, error: err2 } = await supabase
    .from('users')
    .select('id, username, role, provider_id, branch_id, unique_id')
    .eq('invite_code', inviteCode)
    .limit(1);
  
  if (err2) {
    console.error('[invite-code] findUserByInviteCode invite_code query error:', err2.message);
  }
  return (byCode && byCode.length > 0) ? byCode[0] : null;
}

/**
 * 根据邀请码查找用户（带角色限制）
 * 直接使用 Supabase REST API 查询
 */
export async function findUserByInviteCodeWithRole(inviteCode: string, role: string) {
  const supabase = getSupabase();
  
  // 先查 unique_id
  const { data: byId, error: err1 } = await supabase
    .from('users')
    .select('id, username, role, provider_id, branch_id, unique_id')
    .eq('unique_id', inviteCode)
    .eq('role', role)
    .limit(1);
  
  if (err1) {
    console.error('[invite-code] findUserByInviteCodeWithRole unique_id query error:', err1.message);
  }
  if (byId && byId.length > 0) return byId[0];
  
  // 兼容旧 invite_code 字段
  const { data: byCode, error: err2 } = await supabase
    .from('users')
    .select('id, username, role, provider_id, branch_id, unique_id')
    .eq('invite_code', inviteCode)
    .eq('role', role)
    .limit(1);
  
  if (err2) {
    console.error('[invite-code] findUserByInviteCodeWithRole invite_code query error:', err2.message);
  }
  return (byCode && byCode.length > 0) ? byCode[0] : null;
}
