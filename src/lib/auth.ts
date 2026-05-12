import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import { getJwtSecret } from './env';

// JWT 密钥 - 从环境变量读取（兼容多种命名格式）
const JWT_SECRET = getJwtSecret();

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  警告: JWT_SECRET 未设置，将使用默认值（不安全）');
}

const TOKEN_EXPIRY = '365d';

export interface JwtPayload {
  userId: string;
  username: string;
  role: 'admin' | 'provider' | 'member' | 'branch';
}

/**
 * 签发 JWT 令牌
 */
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

/**
 * 验证并解析 JWT 令牌
 */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

/**
 * 从请求头中提取 JWT 令牌
 */
export function extractToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * 从请求中验证用户身份
 * 成功返回用户信息，失败返回 null
 */
export function authenticateRequest(request: NextRequest): JwtPayload | null {
  const token = extractToken(request);
  if (!token) {
    return null;
  }
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

/**
 * 验证用户角色是否在允许列表中
 */
export function authorizeRole(user: JwtPayload, allowedRoles: string[]): boolean {
  return allowedRoles.includes(user.role);
}

/**
 * API 路由鉴权守卫（便捷封装）
 * 验证失败时抛出带 statusCode 的错误，调用方 catch 后返回对应 HTTP 状态码。
 *
 * 用法：
 *   const user = requireAuth(request);                   // 仅要求登录
 *   const user = requireAuth(request, ['admin']);         // 要求管理员角色
 *   const user = requireAuth(request, ['provider','admin']); // 要求服务商或管理员
 */
export function requireAuth(request: NextRequest, allowedRoles?: string[]): JwtPayload {
  const user = authenticateRequest(request);
  if (!user) {
    throw Object.assign(new Error('未登录，请先登录'), { statusCode: 401 });
  }
  if (allowedRoles && !authorizeRole(user, allowedRoles)) {
    throw Object.assign(new Error('无权访问'), { statusCode: 403 });
  }
  return user;
}
