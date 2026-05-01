'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Home, ArrowLeft, Search, AlertCircle } from 'lucide-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <Card className="bg-slate-800/50 border-slate-700 max-w-md w-full">
        <CardContent className="pt-8 pb-8 text-center">
          {/* 404 图标 */}
          <div className="relative mb-6">
            <div className="text-8xl font-bold text-slate-700">404</div>
            <div className="absolute inset-0 flex items-center justify-center">
              <AlertCircle className="w-16 h-16 text-yellow-400" />
            </div>
          </div>
          
          <h1 className="text-2xl font-bold text-white mb-2">页面未找到</h1>
          <p className="text-gray-400 mb-6">
            抱歉，您访问的页面不存在或已被移除
          </p>
          
          {/* 快捷操作 */}
          <div className="space-y-3">
            <Link href="/" className="block">
              <Button className="w-full bg-blue-500 hover:bg-blue-600">
                <Home className="w-4 h-4 mr-2" />
                返回首页
              </Button>
            </Link>
            
            <Button 
              variant="outline" 
              className="w-full border-slate-600 text-gray-300 hover:text-white"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              返回上一页
            </Button>
          </div>
          
          {/* 帮助链接 */}
          <div className="mt-6 pt-6 border-t border-slate-700">
            <p className="text-gray-500 text-sm mb-3">如果您认为这是一个错误，请：</p>
            <Link href="/help">
              <Button variant="link" className="text-blue-400 hover:text-blue-300 p-0">
                <Search className="w-4 h-4 mr-1" />
                访问帮助中心
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
