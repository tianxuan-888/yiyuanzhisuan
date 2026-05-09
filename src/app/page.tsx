'use client';

import dynamic from 'next/dynamic';

// 禁用 SSR，解决 Coze iframe 中 React hydrate 失败导致交互不生效的问题
const LoginPage = dynamic(() => import('@/components/LoginPage'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="text-white text-lg">加载中...</div>
    </div>
  ),
});

export default function Page() {
  return <LoginPage />;
}
