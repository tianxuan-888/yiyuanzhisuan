'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  User,
  Lock,
  Gift,
  Copy,
  Check,
  Loader2,
  MessageSquare,
  ChevronRight,
  Shield,
  Building2,
  UserCog,
} from 'lucide-react';

interface ProfileData {
  id: string;
  username: string;
  phone: string;
  role: string;
  real_name: string | null;
  birth_date: string | null;
  wechat_account: string | null;
  alipay_account: string | null;
  gender: string | null;
  address: string | null;
  invite_code: string | null;
  unique_id: string;
  
  balance: string;
  created_at: string;
  inviter?: {
    id: string;
    username: string;
    phone: string;
    role: string;
  } | null;
  provider?: {
    id: string;
    username: string;
    phone: string;
  } | null;
  branch?: {
    id: string;
    username: string;
    phone: string;
  } | null;
}

export function MyProfile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [activeTab, setActiveTab] = useState('info');
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  
  const [profile, setProfile] = useState<ProfileData | null>(null);
  
  // 编辑表单状态
  const [formData, setFormData] = useState({
    username: '',
    real_name: '',
    birth_date: '',
    wechat_account: '',
    alipay_account: '',
    gender: '',
    address: '',
  });
  
  // 密码表单状态
  const [passwordForm, setPasswordForm] = useState({
    old_password: '',
    new_password: '',
    confirm_password: '',
  });
  
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // 获取用户资料
  const fetchProfile = async () => {
    try {
      const res = await fetch('/api/profile');
      const data = await res.json();
      if (data.success) {
        setProfile(data.data);
        setFormData({
          username: data.data.username || '',
          real_name: data.data.real_name || '',
          birth_date: data.data.birth_date || '',
          wechat_account: data.data.wechat_account || '',
          alipay_account: data.data.alipay_account || '',
          gender: data.data.gender || '',
          address: data.data.address || '',
        });
      }
    } catch (error) {
      console.error('获取资料失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  // 保存资料
  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (data.success) {
        alert('资料更新成功！');
        fetchProfile();
      } else {
        alert(data.error || '更新失败');
      }
    } catch (error) {
      alert('更新失败');
    } finally {
      setSaving(false);
    }
  };

  // 修改密码
  const handleChangePassword = async () => {
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordError('两次密码不一致');
      return;
    }
    if (passwordForm.new_password.length < 6) {
      setPasswordError('新密码长度不能少于6位');
      return;
    }
    
    setPasswordError('');
    setSaving(true);
    
    try {
      const res = await fetch('/api/profile/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(passwordForm),
      });
      const data = await res.json();
      if (data.success) {
        setPasswordSuccess('密码修改成功！');
        setPasswordForm({ old_password: '', new_password: '', confirm_password: '' });
        setTimeout(() => {
          setShowPasswordDialog(false);
          setPasswordSuccess('');
        }, 1500);
      } else {
        setPasswordError(data.error || '修改失败');
      }
    } catch (error) {
      setPasswordError('修改失败');
    } finally {
      setSaving(false);
    }
  };

  // 复制邀请码
  const copyInviteCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = code;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-purple-500 mx-auto" />
          <p className="mt-2 text-gray-500 text-sm">加载中...</p>
        </div>
      </div>
    );
  }

  const roleLabels: Record<string, string> = {
    admin: '智算中心管理员',
    branch: '服务网点管理员',
    provider: '服务商',
    member: '会员',
  };

  const roleColors: Record<string, string> = {
    admin: 'bg-red-100 text-red-800',
    branch: 'bg-blue-100 text-blue-800',
    provider: 'bg-purple-100 text-purple-800',
    member: 'bg-green-100 text-green-800',
  };

  const roleIcons: Record<string, React.ReactNode> = {
    admin: <Shield className="w-4 h-4" />,
    branch: <Building2 className="w-4 h-4" />,
    provider: <UserCog className="w-4 h-4" />,
    member: <User className="w-4 h-4" />,
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">我的资料</h1>
          <p className="text-gray-500 text-sm mt-1">管理您的个人信息和邀请码</p>
        </div>
        <Badge className={roleColors[profile?.role || 'member']}>
          {roleIcons[profile?.role || 'member']}
          <span className="ml-1">{roleLabels[profile?.role || 'member']}</span>
        </Badge>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="info">
            <User className="w-4 h-4 mr-2" />
            基本信息
          </TabsTrigger>
          <TabsTrigger value="invite">
            <Gift className="w-4 h-4 mr-2" />
            邀请码
          </TabsTrigger>
        </TabsList>

        {/* 基本信息 Tab */}
        <TabsContent value="info" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                基本信息
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>用户名</Label>
                  <Input
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    placeholder="请输入用户名"
                  />
                </div>
                <div>
                  <Label>真实姓名</Label>
                  <Input
                    value={formData.real_name}
                    onChange={(e) => setFormData({ ...formData, real_name: e.target.value })}
                    placeholder="请输入真实姓名"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>手机号</Label>
                  <Input value={profile?.phone || ''} disabled className="bg-gray-100" />
                </div>
                <div>
                  <Label>专属ID</Label>
                  <Input value={profile?.unique_id || ''} disabled className="bg-gray-100" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>出生日期</Label>
                  <Input
                    type="date"
                    value={formData.birth_date}
                    onChange={(e) => setFormData({ ...formData, birth_date: e.target.value })}
                  />
                </div>
                <div>
                  <Label>性别</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                  >
                    <option value="">请选择</option>
                    <option value="male">男</option>
                    <option value="female">女</option>
                    <option value="other">其他</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>微信号</Label>
                  <Input
                    value={formData.wechat_account}
                    onChange={(e) => setFormData({ ...formData, wechat_account: e.target.value })}
                    placeholder="请输入微信号"
                  />
                </div>
                <div>
                  <Label>支付宝账号</Label>
                  <Input
                    value={formData.alipay_account}
                    onChange={(e) => setFormData({ ...formData, alipay_account: e.target.value })}
                    placeholder="请输入支付宝账号"
                  />
                </div>
              </div>

              <div>
                <Label>收货地址</Label>
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="请输入详细地址"
                />
              </div>

              <Button onClick={handleSaveProfile} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                保存修改
              </Button>
            </CardContent>
          </Card>

          {/* 账户信息卡片 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="w-5 h-5" />
                账户安全
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <Lock className="w-5 h-5 text-gray-500" />
                  <div>
                    <p className="font-medium">登录密码</p>
                    <p className="text-sm text-gray-500">定期更换密码可以保护账户安全</p>
                  </div>
                </div>
                <Button variant="outline" onClick={() => setShowPasswordDialog(true)}>
                  修改密码
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 归属信息卡片 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                归属信息
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {profile?.inviter && (
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <User className="w-5 h-5 text-gray-500" />
                    <div>
                      <p className="text-sm text-gray-500">邀请人</p>
                      <p className="font-medium">{profile.inviter.username}</p>
                      <p className="text-xs text-gray-400">{profile.inviter.phone}</p>
                    </div>
                  </div>
                  <Badge variant="outline">{roleLabels[profile.inviter.role]}</Badge>
                </div>
              )}
              
              {profile?.provider && (
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <UserCog className="w-5 h-5 text-gray-500" />
                    <div>
                      <p className="text-sm text-gray-500">所属服务商</p>
                      <p className="font-medium">{profile.provider.username}</p>
                      <p className="text-xs text-gray-400">{profile.provider.phone}</p>
                    </div>
                  </div>
                  <Badge variant="outline">服务商</Badge>
                </div>
              )}
              
              {profile?.branch && (
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Building2 className="w-5 h-5 text-gray-500" />
                    <div>
                      <p className="text-sm text-gray-500">所属服务网点</p>
                      <p className="font-medium">{profile.branch.username}</p>
                      <p className="text-xs text-gray-400">{profile.branch.phone}</p>
                    </div>
                  </div>
                  <Badge variant="outline">服务网点</Badge>
                </div>
              )}

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <MessageSquare className="w-5 h-5 text-gray-500" />
                  <div>
                    <p className="text-sm text-gray-500">注册时间</p>
                    <p className="font-medium">
                      {profile?.created_at ? new Date(profile.created_at).toLocaleString('zh-CN') : '-'}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 邀请码 Tab */}
        <TabsContent value="invite" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gift className="w-5 h-5" />
                我的邀请码
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {profile?.invite_code ? (
                <>
                  <div className="p-6 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl text-white">
                    <p className="text-sm opacity-80 mb-2">分享您的邀请码</p>
                    <div className="flex items-center justify-between">
                      <p className="text-3xl font-bold tracking-wider">{profile.invite_code}</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => copyInviteCode(profile.invite_code!)}
                        className="bg-white/20 hover:bg-white/30 text-white border-0"
                      >
                        {copySuccess ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                        <span className="ml-1">{copySuccess ? '已复制' : '复制'}</span>
                      </Button>
                    </div>
                    <p className="text-xs opacity-70 mt-2">
                      邀请码类型：{profile.invite_code.startsWith('PROV') ? '服务商邀请码' : '会员邀请码'}
                    </p>
                  </div>
                  
                  <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                    <h4 className="font-medium text-amber-800 mb-2">邀请奖励规则</h4>
                    <ul className="text-sm text-amber-700 space-y-1">
                      <li>• 邀请好友注册，好友将绑定到您的名下</li>
                      <li>• 好友成功购买产品，您可获得收益奖励</li>
                      <li>• 邀请越多，奖励越多</li>
                    </ul>
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <Gift className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500 mb-4">您还没有邀请码</p>
                  <p className="text-sm text-gray-400">完成实名认证后可获得邀请码</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 修改密码对话框 */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改密码</DialogTitle>
            <DialogDescription>
              请填写以下信息来修改您的登录密码
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <Label>当前密码</Label>
              <Input
                type="password"
                value={passwordForm.old_password}
                onChange={(e) => setPasswordForm({ ...passwordForm, old_password: e.target.value })}
                placeholder="请输入当前密码"
              />
            </div>
            <div>
              <Label>新密码</Label>
              <Input
                type="password"
                value={passwordForm.new_password}
                onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
                placeholder="请输入新密码（至少6位）"
              />
            </div>
            <div>
              <Label>确认新密码</Label>
              <Input
                type="password"
                value={passwordForm.confirm_password}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })}
                placeholder="请再次输入新密码"
              />
            </div>
            
            {passwordError && (
              <p className="text-sm text-red-500">{passwordError}</p>
            )}
            {passwordSuccess && (
              <p className="text-sm text-green-500">{passwordSuccess}</p>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordDialog(false)}>
              取消
            </Button>
            <Button onClick={handleChangePassword} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              确认修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
