import LoginPage from '@/components/LoginPage';
import { Suspense } from 'react';

export default function Page() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center">
        <div className="text-white text-lg">加载中...</div>
      </div>
    }>
      <LoginPage />
    </Suspense>
  );
}
