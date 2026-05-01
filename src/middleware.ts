import { NextRequest, NextResponse } from 'next/server';

// 不需要认证的路径白名单
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/send-verify-code',
  '/api/invite-codes/available',
  '/api/reset-password-direct',
  '/api/energy/account',
  '/api/energy/branch-stats',
  '/api/energy/transactions',
  '/api/energy/transfer-targets',
  '/api/energy/transfer',
  '/api/energy/withdraw-request',
  '/api/energy/withdraw-requests',
  '/api/energy/branch-request',
  '/api/branch/provider-energy-requests',
  '/api/branch/approve-provider-energy',
  '/api/branch/energy-records',
  '/api/branch/providers',
  '/api/branch/members',
  '/api/branch/quota-requests',
  '/api/member/products',
  '/api/member/assets',
  '/api/member/energy-records',
  '/api/member/energy-recharge',
  '/api/member/recharge-request',
  '/api/member/revenue',
  '/api/member/revenue/convert',
  '/api/member/revenue/details',
  '/api/member/purchase-limits',
  '/api/orders/buy',
  '/api/orders/sell',
  '/api/orders/review',
  '/api/orders',
  '/api/products',
  '/api/provider/members',
  '/api/provider/quota-requests',
  '/api/provider/pending-orders',
  '/api/provider/confirm-payment',
  '/api/provider/reject-order',
  '/api/provider/review-sell',
  '/api/provider/sales-stats',
  '/api/provider/products',
  '/api/provider/applications',
  '/api/provider/recharge-request',
  '/api/provider/recharge-energy',
  '/api/provider/withdraw-request',
  '/api/provider/generate-products',
  '/api/provider/revenue',
  '/api/admin/stats',
  '/api/admin/three-types-stats',
  '/api/admin/orders',
  '/api/admin/provider-management',
  '/api/admin/members-stats',
  '/api/admin/branch-management',
  '/api/notifications',
  '/api/notifications/mark-read',
  '/api/admin/platform-stats',
  '/api/admin/energy-stats',
  '/api/admin/energy-branch-stats',
];

// 静态资源和页面路径不走 API 认证
const SKIP_PREFIXES = [
  '/_next',
  '/favicon.ico',
  '/public',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 跳过静态资源
  if (SKIP_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // 只拦截 API 路由
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // 公开接口放行
  if (PUBLIC_PATHS.some(path => pathname === path)) {
    return NextResponse.next();
  }

  // 检查 Authorization 头
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: '未登录，请先登录' },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7);
  if (!token) {
    return NextResponse.json(
      { error: '令牌无效' },
      { status: 401 }
    );
  }

  // JWT 签名验证在 middleware 中用 jsonwebtoken 的同步方式不太方便，
  // 因此这里只检查令牌格式（3段 Base64），具体的签名验证在各 API 路由中完成。
  // 这是第一道防线，防止完全无令牌的请求进入。
  const parts = token.split('.');
  if (parts.length !== 3) {
    return NextResponse.json(
      { error: '令牌格式无效' },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
