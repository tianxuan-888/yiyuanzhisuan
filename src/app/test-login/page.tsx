'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function TestLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const testLogin = async () => {
    setLoading(true);
    setResult('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();
      setResult(JSON.stringify(data, null, 2));

      if (data.success) {
        // 保存登录信息
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('userId', data.data.id);
        localStorage.setItem('userName', data.data.username);
        localStorage.setItem('userRole', data.data.role);
        localStorage.setItem('userData', JSON.stringify(data.data));

        // 测试跳转
        setTimeout(() => {
          if (data.data.role === 'member') {
            window.location.href = '/member';
          } else if (data.data.role === 'provider') {
            window.location.href = '/provider';
          } else if (data.data.role === 'branch') {
            window.location.href = '/admin/branch';
          } else {
            window.location.href = '/admin/platform';
          }
        }, 1000);
      }
    } catch (error) {
      setResult('错误: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 左侧：登录表单 */}
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">登录测试</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-gray-300 text-sm mb-2 block">用户名</label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="bg-slate-700 border-slate-600 text-white"
                placeholder="输入用户名"
              />
            </div>
            <div>
              <label className="text-gray-300 text-sm mb-2 block">密码</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-slate-700 border-slate-600 text-white"
                placeholder="输入密码"
              />
            </div>
            <Button
              onClick={testLogin}
              disabled={loading}
              className="w-full bg-blue-500 hover:bg-blue-600"
            >
              {loading ? '登录中...' : '登录'}
            </Button>
          </CardContent>
        </Card>

        {/* 右侧：快捷账号 */}
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">快捷账号</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-gray-400 text-sm">点击快速填充账号</p>
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full border-slate-600 text-gray-300 hover:bg-slate-700"
                onClick={() => { setUsername('admin'); setPassword('admin123'); }}
              >
                总公司：admin / admin123
              </Button>
              <Button
                variant="outline"
                className="w-full border-slate-600 text-gray-300 hover:bg-slate-700"
                onClick={() => { setUsername('branch1'); setPassword('branch123'); }}
              >
                北京分公司：branch1 / branch123
              </Button>
              <Button
                variant="outline"
                className="w-full border-slate-600 text-gray-300 hover:bg-slate-700"
                onClick={() => { setUsername('branch2'); setPassword('branch123'); }}
              >
                上海分公司：branch2 / branch123
              </Button>
              <Button
                variant="outline"
                className="w-full border-slate-600 text-gray-300 hover:bg-slate-700"
                onClick={() => { setUsername('provider1'); setPassword('provider123'); }}
              >
                服务商A：provider1 / provider123
              </Button>
              <Button
                variant="outline"
                className="w-full border-slate-600 text-gray-300 hover:bg-slate-700"
                onClick={() => { setUsername('provider2'); setPassword('provider123'); }}
              >
                服务商B：provider2 / provider123
              </Button>
              <Button
                variant="outline"
                className="w-full border-slate-600 text-green-400 hover:bg-slate-700"
                onClick={() => { setUsername('member1'); setPassword('member123'); }}
              >
                会员张三：member1 / member123
              </Button>
              <Button
                variant="outline"
                className="w-full border-slate-600 text-green-400 hover:bg-slate-700"
                onClick={() => { setUsername('member2'); setPassword('member123'); }}
              >
                会员李四：member2 / member123
              </Button>
              <Button
                variant="outline"
                className="w-full border-slate-600 text-green-400 hover:bg-slate-700"
                onClick={() => { setUsername('member3'); setPassword('member123'); }}
              >
                会员王五：member3 / member123
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 底部：结果 */}
        {result && (
          <Card className="bg-slate-800 border-slate-700 md:col-span-2">
            <CardHeader>
              <CardTitle className="text-white">登录结果</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-gray-300 text-sm overflow-auto max-h-96">
                {result}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
