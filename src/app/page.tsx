'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, Users, User, Shield, ArrowRight, Loader2, UserPlus, LogIn, Gift, HelpCircle, Lock, AtSign, Phone, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';

// 启动画面效果（使用渐变背景替代图片）
const SplashScreen = ({ onComplete }: { onComplete: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onComplete, 1500);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 overflow-hidden">
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
          <Shield className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">纪元智科</h1>
        <p className="text-blue-400">GPU算力基建平台</p>
        <div className="mt-8 flex justify-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
};

// 角色图标和颜色
const roleConfig = {
  admin: { icon: Shield, color: 'text-red-500', bg: 'bg-red-500', label: '总公司', redirect: '/admin' },
  branch: { icon: Building2, color: 'text-blue-500', bg: 'bg-blue-500', label: '分公司', redirect: '/branch' },
  provider: { icon: Users, color: 'text-purple-500', bg: 'bg-purple-500', label: '服务商', redirect: '/provider' },
  member: { icon: User, color: 'text-green-500', bg: 'bg-green-500', label: '会员', redirect: '/member' },
};

export default function LoginPage() {
  const router = useRouter();
  
  // 启动画面状态
  const [showSplash, setShowSplash] = useState(true);
  
  // 登录表单状态
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // 注册表单状态
  const [registerUsername, setRegisterUsername] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [inviterCode, setInviterCode] = useState('');
  const [registerPhone, setRegisterPhone] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyCodeSent, setVerifyCodeSent] = useState(false);
  const [verifyCodeLoading, setVerifyCodeLoading] = useState(false);
  const [verifyCodeCountdown, setVerifyCodeCountdown] = useState(0);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerError, setRegisterError] = useState('');
  
  // 当前模式：login 或 register
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // 登录
  const handleLogin = async () => {
    // 清除旧的登录状态，确保使用新账号登录
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('userRole');

    if (!username) {
      setError('请输入用户名/专属ID/手机号');
      return;
    }
    
    if (!password) {
      setError('请输入密码');
      return;
    }
    
    setLoading(true);
    setError('');
    
    console.log('[登录] 发送请求:', { loginKey: username, password: '***' });
    
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          loginKey: username,  // 支持用户名/专属ID/手机号
          password 
        }),
      });
      
      console.log('[登录] 响应状态:', response.status);
      const data = await response.json();
      console.log('[登录] 响应数据:', JSON.stringify(data).substring(0, 500));
      
      if (data.success) {
        // 保存用户信息到 localStorage
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('userId', data.data.id);
        localStorage.setItem('userName', data.data.username);
        localStorage.setItem('userRole', data.data.role);
        localStorage.setItem('userData', JSON.stringify(data.data));
        // 保存 JWT Token
        if (data.data.token) {
          console.log('[登录] 保存token:', data.data.token.substring(0, 20) + '...');
          localStorage.setItem('token', data.data.token);
        } else {
          console.log('[登录] 警告: 没有token!');
        }
        
        // 根据角色跳转 - 先跳转到登录成功过渡页
        const config = roleConfig[data.data.role as keyof typeof roleConfig] || roleConfig.member;
        router.replace(config.redirect);
      } else {
        setError(data.error || '登录失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
      console.error('登录错误:', err);
    } finally {
      setLoading(false);
    }
  };

  // 发送验证码
  const handleSendVerifyCode = async () => {
    if (!registerPhone) {
      setRegisterError('请输入手机号');
      return;
    }
    
    if (!/^1[3-9]\d{9}$/.test(registerPhone)) {
      setRegisterError('请输入正确的手机号');
      return;
    }
    
    setVerifyCodeLoading(true);
    
    try {
      const response = await fetch('/api/auth/send-verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: registerPhone }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setVerifyCodeSent(true);
        setVerifyCodeCountdown(60);
        // 在页面上显示验证码（测试环境）
        if (data.devCode) {
          setRegisterError(`测试验证码: ${data.devCode}（请在控制台也查看）`);
        }
        // 倒计时
        const timer = setInterval(() => {
          setVerifyCodeCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(timer);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        setRegisterError(data.error || '发送验证码失败');
      }
    } catch (err) {
      setRegisterError('网络错误，请稍后重试');
    } finally {
      setVerifyCodeLoading(false);
    }
  };

  // 注册
  const handleRegister = async () => {
    if (!registerUsername) {
      setRegisterError('请输入用户名');
      return;
    }
    
    if (registerUsername.length < 3) {
      setRegisterError('用户名至少3个字符');
      return;
    }
    
    if (!registerPassword) {
      setRegisterError('请输入密码');
      return;
    }
    
    if (registerPassword.length < 6) {
      setRegisterError('密码至少6个字符');
      return;
    }
    
    if (registerPassword !== confirmPassword) {
      setRegisterError('两次密码不一致');
      return;
    }
    
    if (!inviterCode) {
      setRegisterError('请输入邀请码');
      return;
    }
    
    if (!registerPhone) {
      setRegisterError('请输入手机号');
      return;
    }
    
    if (!/^1[3-9]\d{9}$/.test(registerPhone)) {
      setRegisterError('请输入正确的手机号');
      return;
    }
    
    if (!verifyCode) {
      setRegisterError('请输入验证码');
      return;
    }
    
    setRegisterLoading(true);
    setRegisterError('');
    
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username: registerUsername, 
          password: registerPassword,
          invite_code: inviterCode,
          phone: registerPhone,
          verify_code: verifyCode,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        // 注册成功后自动登录
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('userId', data.data.user.id);
        localStorage.setItem('userName', data.data.user.username);
        localStorage.setItem('userRole', 'member');
        localStorage.setItem('userData', JSON.stringify(data.data.user));
        
        // 跳转到会员端
        router.push('/member');
      } else {
        setRegisterError(data.error || '注册失败');
      }
    } catch (err) {
      setRegisterError('网络错误，请稍后重试');
      console.error('注册错误:', err);
    } finally {
      setRegisterLoading(false);
    }
  };

  // 启动画面
  if (showSplash) {
    return <SplashScreen onComplete={() => setShowSplash(false)} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* AI科技感背景图 */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: 'url(/ai-bg.jpg)' }}
      ></div>
      
      {/* 背景遮罩层 */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"></div>
      
      {/* 动态光效装饰 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-20 w-96 h-96 bg-blue-500/30 rounded-full filter blur-[100px] animate-pulse"></div>
        <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-purple-500/30 rounded-full filter blur-[100px] animate-pulse" style={{ animationDelay: '1s' }}></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-500/20 rounded-full filter blur-[120px] animate-pulse" style={{ animationDelay: '2s' }}></div>
      </div>

      <Card className="w-full max-w-md relative z-10 bg-slate-800/70 border-slate-600/50 backdrop-blur-xl shadow-2xl shadow-purple-500/10">
        <CardHeader className="text-center pb-2">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-400 via-blue-500 to-purple-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/30">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold text-white">纪元智科</CardTitle>
          <CardDescription className="text-gray-300 mt-2">
            {mode === 'login' ? '请输入账号密码登录系统' : '注册新账户'}
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {/* 登录/注册 切换按钮 */}
          <div className="flex bg-slate-700/50 rounded-lg p-1">
            <button
              onClick={() => { setMode('login'); setError(''); setRegisterError(''); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${
                mode === 'login' 
                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <LogIn className="w-4 h-4" />
              登录
            </button>
            <button
              onClick={() => { setMode('register'); setError(''); setRegisterError(''); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${
                mode === 'register' 
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              注册
            </button>
          </div>

          {/* ===== 登录表单 ===== */}
          {mode === 'login' && (
            <>
              {/* 用户名/专属ID/手机号输入 */}
              <div className="space-y-2">
                <Label htmlFor="username" className="text-gray-300">账号</Label>
                <div className="relative">
                  <AtSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="username"
                    type="text"
                    placeholder="用户名 / 专属ID / 手机号"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                    className="pl-10 bg-slate-700/50 border-slate-600 text-white placeholder-gray-400 focus:border-purple-500"
                  />
                </div>
              </div>

              {/* 密码输入 */}
              <div className="space-y-2">
                <Label htmlFor="password" className="text-gray-300">密码</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="请输入密码"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                    className="pl-10 pr-10 bg-slate-700/50 border-slate-600 text-white placeholder-gray-400 focus:border-purple-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-300 focus:outline-none"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="text-red-400 text-sm text-center">{error}</div>
              )}

              {/* 登录按钮 */}
              <Button
                onClick={handleLogin}
                disabled={loading || !username || !password}
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    登录中...
                  </>
                ) : (
                  <>
                    登录
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </>
          )}

          {/* ===== 注册表单 ===== */}
          {mode === 'register' && (
            <>
              {/* 用户名输入 */}
              <div className="space-y-2">
                <Label htmlFor="register-username" className="text-gray-300">用户名</Label>
                <div className="relative">
                  <AtSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="register-username"
                    type="text"
                    placeholder="请输入用户名（至少3个字符）"
                    value={registerUsername}
                    onChange={(e) => setRegisterUsername(e.target.value)}
                    className="pl-10 bg-slate-700/50 border-slate-600 text-white placeholder-gray-400 focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* 手机号输入 */}
              <div className="space-y-2">
                <Label htmlFor="register-phone" className="text-gray-300">
                  手机号
                  <span className="text-red-400 text-xs ml-1">*</span>
                </Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="register-phone"
                    type="tel"
                    placeholder="请输入手机号"
                    value={registerPhone}
                    onChange={(e) => setRegisterPhone(e.target.value.replace(/\D/g, ''))}
                    maxLength={11}
                    className="pl-10 bg-slate-700/50 border-slate-600 text-white placeholder-gray-400 focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* 验证码输入 */}
              <div className="space-y-2">
                <Label htmlFor="verify-code" className="text-gray-300">
                  验证码
                  <span className="text-red-400 text-xs ml-1">*</span>
                </Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <ShieldCheck className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      id="verify-code"
                      type="text"
                      placeholder="请输入验证码"
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                      maxLength={6}
                      className="pl-10 bg-slate-700/50 border-slate-600 text-white placeholder-gray-400 focus:border-cyan-500"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSendVerifyCode}
                    disabled={verifyCodeLoading || verifyCodeCountdown > 0 || !registerPhone}
                    className="border-cyan-500 text-cyan-400 hover:bg-cyan-500/20 whitespace-nowrap"
                  >
                    {verifyCodeLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : verifyCodeCountdown > 0 ? (
                      `${verifyCodeCountdown}s`
                    ) : (
                      '获取验证码'
                    )}
                  </Button>
                </div>
              </div>

              {/* 邀请码输入 */}
              <div className="space-y-2">
                <Label htmlFor="invite-code" className="text-gray-300">
                  邀请码
                  <span className="text-red-400 text-xs ml-1">*</span>
                </Label>
                <div className="relative">
                  <Gift className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="invite-code"
                    type="text"
                    placeholder="请向服务商获取邀请码"
                    value={inviterCode}
                    onChange={(e) => setInviterCode(e.target.value)}
                    className="pl-10 bg-slate-700/50 border-slate-600 text-white placeholder-gray-400 focus:border-cyan-500 uppercase"
                  />
                </div>
                <p className="text-xs text-gray-500">注册需填写邀请码，请联系您的服务商获取</p>
              </div>

              {/* 密码输入 */}
              <div className="space-y-2">
                <Label htmlFor="register-password" className="text-gray-300">密码</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="register-password"
                    type={showRegisterPassword ? 'text' : 'password'}
                    placeholder="请输入密码（至少6个字符）"
                    value={registerPassword}
                    onChange={(e) => setRegisterPassword(e.target.value)}
                    className="pl-10 pr-10 bg-slate-700/50 border-slate-600 text-white placeholder-gray-400 focus:border-cyan-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-300 focus:outline-none"
                  >
                    {showRegisterPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* 确认密码 */}
              <div className="space-y-2">
                <Label htmlFor="confirm-password" className="text-gray-300">确认密码</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="请再次输入密码"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10 pr-10 bg-slate-700/50 border-slate-600 text-white placeholder-gray-400 focus:border-cyan-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-300 focus:outline-none"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* 错误提示 */}
              {registerError && (
                <div className="text-red-400 text-sm text-center">{registerError}</div>
              )}

              {/* 注册按钮 */}
              <Button
                onClick={handleRegister}
                disabled={registerLoading || !registerUsername || !registerPassword || !confirmPassword || !inviterCode || !registerPhone || !verifyCode}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white"
              >
                {registerLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    注册中...
                  </>
                ) : (
                  <>
                    立即注册
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>

              {/* 已有账户提示 */}
              <div className="text-center text-sm text-gray-400">
                已有账户？
                <button 
                  onClick={() => setMode('login')}
                  className="text-cyan-400 hover:text-cyan-300 ml-1"
                >
                  立即登录
                </button>
              </div>
            </>
          )}

          {/* 帮助中心链接 */}
          <div className="pt-4 border-t border-slate-700 text-center">
            <a href="/help" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-blue-400 transition-colors">
              <HelpCircle className="w-4 h-4" />
              帮助中心
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
