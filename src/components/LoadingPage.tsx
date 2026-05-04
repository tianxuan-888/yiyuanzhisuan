"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface LoadingPageProps {
  message?: string;
  targetPath?: string;
}

export function LoadingPage({ 
  message = "正在跳转...", 
  targetPath 
}: LoadingPageProps) {
  const router = useRouter();
  const [dots, setDots] = useState("");

  useEffect(() => {
    // 动画效果
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? "" : prev + ".");
    }, 500);

    // 延迟跳转
    const timeout = setTimeout(() => {
      if (targetPath) {
        router.replace(targetPath);
      }
    }, 2000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [targetPath, router]);

  return (
    <div 
      className="fixed inset-0 flex flex-col items-center justify-center bg-cover bg-center bg-no-repeat"
      style={{
        backgroundImage: "url('/login-bg.jpg')",
      }}
    >
      {/* 遮罩层 */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      
      {/* 内容 */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Logo/图标 */}
        <div className="mb-8">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-2xl animate-pulse">
            <svg 
              className="w-10 h-10 text-white" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M13 10V3L4 14h7v7l9-11h-7z" 
              />
            </svg>
          </div>
        </div>
        
        {/* 标题 */}
        <h1 className="text-3xl font-bold text-white mb-2 tracking-wider">
          艺元智算
        </h1>
        <p className="text-blue-300 text-lg mb-8">GPU算力基建平台</p>
        
        {/* 加载动画 */}
        <div className="flex flex-col items-center">
          <div className="relative w-48 h-1 bg-gray-700 rounded-full overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 animate-[loading_1.5s_ease-in-out_infinite]" />
          </div>
          <p className="mt-4 text-white/80 text-sm">
            {message}{dots}
          </p>
        </div>
      </div>

      {/* 底部装饰 */}
      <div className="absolute bottom-8 text-white/40 text-xs">
        © 2024 艺元智算科技有限公司
      </div>

      <style jsx>{`
        @keyframes loading {
          0% { width: 0%; left: 0; }
          50% { width: 60%; left: 20%; }
          100% { width: 0%; left: 100%; }
        }
      `}</style>
    </div>
  );
}
