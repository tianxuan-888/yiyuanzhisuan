'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Package, Database, Coins, BarChart3, 
  Zap, CheckCircle, User, Loader2,
  Shield, Award, Users, ArrowRightLeft, Plus, LogOut, 
  ChevronRight, ChevronLeft, Gift, Copy, Check, Lock, TrendingUp,
  Search, X, Eye, EyeOff, TrendingDown, ArrowUpRight, ArrowDownRight,
  DollarSign, CreditCard, ArrowUp, ArrowDown, RefreshCw, Filter, Edit
} from 'lucide-react';
import { ChangePasswordDialog } from '@/components/admin/ChangePasswordDialog';

interface ProviderStats {
  memberCount: number;
  totalInvestment: number;
  totalProducts: number;
  availableProducts: number;
  soldProducts: number;
  quota: number;
  usedQuota: number;
}

interface Product {
  id: string;
  name: string;
  code: string;
  price: number;
  period: number;
  total_rate: number;
  market_rate: number;
  profit_rate: number;
  status: string;
  created_at: string;
}

interface Member {
  id: string;
  username: string;
  phone: string;
  energy_value: number;
  balance: number;
  real_name?: string;
  totalInvestment: number;
  holdingProducts: number;
  created_at: string;
}

interface EnergyRecord {
  id: string;
  type: string;
  amount: number;
  note?: string;
  created_at: string;
  from_username?: string;
  to_username?: string;
  status?: string;
}

interface EnergyRequest {
  id: string;
  amount: number;
  note?: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_at?: string;
  branch_name?: string;
}

export default function ProviderDashboard() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeMenu, setActiveMenu] = useState('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [token, setToken] = useState('');
  
  // 数据状态
  const [stats, setStats] = useState<ProviderStats | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [productStats, setProductStats] = useState({ total: 0, available: 0, sold: 0, availableAmount: 0, soldAmount: 0 });
  const [members, setMembers] = useState<Member[]>([]);
  const [memberPagination, setMemberPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [energyRecords, setEnergyRecords] = useState<EnergyRecord[]>([]);
  const [energyStats, setEnergyStats] = useState({ totalRecharge: 0, totalTransferIn: 0, totalTransferOut: 0 });
  const [energyBalance, setEnergyBalance] = useState({ energyValue: 0, balance: 0, quota: 0, usedQuota: 0, totalSales: 0 });
  
  // 充值状态
  const [rechargeMember, setRechargeMember] = useState<Member | null>(null);
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [rechargeNote, setRechargeNote] = useState('');
  const [recharging, setRecharging] = useState(false);
  const [rechargeSuccess, setRechargeSuccess] = useState('');
  
  // 向分公司申请能量值状态
  const [branchRequestAmount, setBranchRequestAmount] = useState('');
  const [branchRequestNote, setBranchRequestNote] = useState('');
  const [requestingBranch, setRequestingBranch] = useState(false);
  const [branchRequestSuccess, setBranchRequestSuccess] = useState('');
  const [branchRequests, setBranchRequests] = useState<EnergyRequest[]>([]);
  const [branchName, setBranchName] = useState('');
  
  // 向分公司申请算力额度状态
  const [quotaRequestAmount, setQuotaRequestAmount] = useState('');
  const [quotaRequestNote, setQuotaRequestNote] = useState('');
  const [requestingQuota, setRequestingQuota] = useState(false);
  const [quotaRequestSuccess, setQuotaRequestSuccess] = useState('');
  const [quotaRequests, setQuotaRequests] = useState<any[]>([]);
  const [quotaBranchName, setQuotaBranchName] = useState('');
  
  // 能量值提现记录
  const [energyWithdrawRecords, setEnergyWithdrawRecords] = useState<any[]>([]);
  
  // 能量值提现状态
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawSuccess, setWithdrawSuccess] = useState('');
  
  // 搜索状态
  const [memberSearch, setMemberSearch] = useState('');
  const [productFilter, setProductFilter] = useState('all');
  
  // 流转审核状态
  const [transfers, setTransfers] = useState<any[]>([]);
  const [transferLoading, setTransferLoading] = useState(false);
  const [reviewingTransfer, setReviewingTransfer] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null);

  // 用户名编辑状态
  const [editingUsername, setEditingUsername] = useState('');
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);

  // 保存用户名
  const handleSaveUsername = async () => {
    if (!editingUsername.trim() || editingUsername === user?.username) {
      setIsEditingUsername(false);
      return;
    }
    
    setSavingUsername(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ username: editingUsername.trim() })
      });
      const data = await res.json();
      if (data.success) {
        // 更新本地用户数据
        const updatedUser = { ...user, username: editingUsername.trim() };
        setUser(updatedUser);
        localStorage.setItem('userData', JSON.stringify(updatedUser));
        localStorage.setItem('userName', editingUsername.trim());
        showToast('用户名修改成功', 'success');
        setIsEditingUsername(false);
      } else {
        showToast(data.error || '修改失败', 'error');
      }
    } catch (err) {
      showToast('修改失败', 'error');
    }
    setSavingUsername(false);
  };

  useEffect(() => {
    const userData = localStorage.getItem('userData');
    const savedToken = localStorage.getItem('token');
    if (userData) {
      try {
        setUser(JSON.parse(userData));
      } catch (e) {
        console.error('解析用户数据失败', e);
      }
    }
    if (savedToken) {
      setToken(savedToken);
    }
    setLoading(false);
  }, []);

  // 获取请求头
  const getHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  }), [token]);

  // 获取服务商数据总览
  const fetchOverview = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/provider/overview', { headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        setStats(data.data.stats);
      }
    } catch (err) {
      console.error('获取总览失败:', err);
    }
  }, [token, getHeaders]);

  // 获取产品列表
  const fetchProducts = useCallback(async () => {
    if (!token) return;
    try {
      const url = productFilter !== 'all' ? `/api/provider/products?status=${productFilter}` : '/api/provider/products';
      const res = await fetch(url, { headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        setProducts(data.data.products);
        setProductStats(data.data.stats);
      }
    } catch (err) {
      console.error('获取产品失败:', err);
    }
  }, [token, getHeaders, productFilter]);

  // 获取会员列表
  const fetchMembers = useCallback(async (page = 1, search = '') => {
    if (!token) return;
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (search) params.set('search', search);
      const res = await fetch(`/api/provider/members?${params}`, { headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        setMembers(data.data.members);
        setMemberPagination(data.data.pagination);
      }
    } catch (err) {
      console.error('获取会员失败:', err);
    }
  }, [token, getHeaders]);

  // 获取能量值信息
  const fetchEnergy = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/provider/energy', { headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        setEnergyBalance({
          energyValue: data.data.energyValue,
          balance: data.data.balance,
          quota: data.data.quota,
          usedQuota: data.data.usedQuota,
          totalSales: data.data.totalSales,
        });
        setEnergyStats(data.data.stats);
        setEnergyRecords(data.data.records);
      }
    } catch (err) {
      console.error('获取能量值失败:', err);
    }
  }, [token, getHeaders]);

  // 初始化加载
  useEffect(() => {
    if (token && activeMenu === 'overview') {
      fetchOverview();
    }
  }, [token, activeMenu, fetchOverview]);

  useEffect(() => {
    if (token && activeMenu === 'products') {
      fetchProducts();
    }
  }, [token, activeMenu, fetchProducts]);

  useEffect(() => {
    if (token && activeMenu === 'members') {
      fetchMembers(1, memberSearch);
    }
  }, [token, activeMenu, memberSearch, fetchMembers]);

  useEffect(() => {
    if (token && activeMenu === 'energy') {
      fetchEnergy();
      fetchBranchRequests();
      fetchEnergyWithdrawRecords();
    }
  }, [token, activeMenu, fetchEnergy]);

  useEffect(() => {
    if (token && activeMenu === 'quota') {
      fetchQuotaRequests();
    }
  }, [token, activeMenu]);

  useEffect(() => {
    if (token && activeMenu === 'transfer') {
      fetchTransfers();
    }
  }, [token, activeMenu]);

  // 获取流转列表
  const fetchTransfers = async () => {
    if (!user?.id) return;
    setTransferLoading(true);
    try {
      const res = await fetch(`/api/products/transfer/list?providerId=${user.id}`, {
        headers: getHeaders()
      });
      const data = await res.json();
      if (data.success) {
        setTransfers(data.data || []);
      }
    } catch (err) {
      console.error('获取流转列表失败:', err);
    } finally {
      setTransferLoading(false);
    }
  };

  // 审核流转
  const handleTransferReview = async (transferId: string, action: 'approve' | 'reject') => {
    setReviewingTransfer(transferId);
    try {
      const res = await fetch('/api/products/transfer/review', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          transferId,
          reviewerId: user.id,
          action
        })
      });
      const data = await res.json();
      if (data.success) {
        setToast({ message: data.message, type: 'success' });
        fetchTransfers();
      } else {
        setToast({ message: data.error || '操作失败', type: 'error' });
      }
    } catch (err) {
      setToast({ message: '操作失败', type: 'error' });
    } finally {
      setReviewingTransfer(null);
    }
  };

  // 处理充值
  const handleRecharge = async () => {
    if (!rechargeMember || !rechargeAmount || parseFloat(rechargeAmount) <= 0) {
      setToast({ message: '请选择会员并输入正确的充值金额', type: 'error' });
      return;
    }
    if (parseFloat(rechargeAmount) > energyBalance.energyValue) {
      setToast({ message: '能量值余额不足', type: 'error' });
      return;
    }

    setRecharging(true);
    try {
      const res = await fetch('/api/provider/energy/recharge', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          memberId: rechargeMember.id,
          amount: parseFloat(rechargeAmount),
          note: rechargeNote
        })
      });
      const data = await res.json();
      if (data.success) {
        setToast({ message: data.message, type: 'success' });
        setRechargeSuccess(data.message);
        setRechargeMember(null);
        setRechargeAmount('');
        setRechargeNote('');
        fetchEnergy(); // 刷新数据
        setTimeout(() => setRechargeSuccess(''), 3000);
      } else {
        setToast({ message: data.error, type: 'error' });
      }
    } catch (err) {
      setToast({ message: '充值失败', type: 'error' });
    }
    setRecharging(false);
  };

  // 向分公司申请能量值
  const handleBranchRequest = async () => {
    if (!branchRequestAmount || parseFloat(branchRequestAmount) <= 0) {
      setToast({ message: '请输入正确的申请金额', type: 'error' });
      return;
    }

    setRequestingBranch(true);
    try {
      const res = await fetch('/api/provider/energy-request', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          providerId: user?.id,
          amount: parseFloat(branchRequestAmount),
          note: branchRequestNote
        })
      });
      const data = await res.json();
      if (data.success) {
        setToast({ message: data.message, type: 'success' });
        setBranchRequestSuccess(data.message);
        setBranchRequestAmount('');
        setBranchRequestNote('');
        fetchBranchRequests(); // 刷新申请记录
        setTimeout(() => setBranchRequestSuccess(''), 3000);
      } else {
        setToast({ message: data.error, type: 'error' });
      }
    } catch (err) {
      setToast({ message: '申请失败', type: 'error' });
    }
    setRequestingBranch(false);
  };

  // 获取向分公司的申请记录
  const fetchBranchRequests = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/provider/energy-request', { headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        setBranchRequests(data.data.requests || []);
        setBranchName(data.data.branchName || '');
      }
    } catch (err) {
      console.error('获取申请记录失败:', err);
    }
  };

  // 能量值提现
  const handleEnergyWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount < 100) {
      setToast({ message: '最低提现金额为 100 能量值', type: 'error' });
      return;
    }

    setWithdrawing(true);
    try {
      const res = await fetch('/api/provider/energy-withdraw', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          providerId: user?.id,
          amount: amount
        })
      });
      const data = await res.json();
      if (data.success) {
        setWithdrawSuccess(`提现成功！实际到账: ${data.data.actualAmount} 能量值 (扣除手续费 ${data.data.fee} 能量值)`);
        setWithdrawAmount('');
        fetchEnergyWithdrawRecords(); // 刷新提现记录
        fetchEnergy(); // 刷新余额
        setTimeout(() => setWithdrawSuccess(''), 5000);
      } else {
        setToast({ message: data.error, type: 'error' });
      }
    } catch (err) {
      setToast({ message: '提现失败', type: 'error' });
    }
    setWithdrawing(false);
  };

  // 向分公司申请算力额度
  const handleQuotaRequest = async () => {
    const amount = parseInt(quotaRequestAmount);
    if (!amount || amount < 5000) {
      setToast({ message: '申请金额必须大于等于5000', type: 'error' });
      return;
    }

    setRequestingQuota(true);
    try {
      const res = await fetch('/api/provider/request-quota', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          providerId: user?.id,
          amount: amount,
          note: quotaRequestNote
        })
      });
      const data = await res.json();
      if (data.success) {
        setToast({ message: data.message, type: 'success' });
        setQuotaRequestSuccess(data.message);
        setQuotaRequestAmount('');
        setQuotaRequestNote('');
        fetchQuotaRequests(); // 刷新申请记录
        setTimeout(() => setQuotaRequestSuccess(''), 3000);
      } else {
        setToast({ message: data.error, type: 'error' });
      }
    } catch (err) {
      setToast({ message: '申请失败', type: 'error' });
    }
    setRequestingQuota(false);
  };

  // 获取算力额度申请记录
  const fetchQuotaRequests = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/provider/request-quota', { headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        setQuotaRequests(data.data || []);
        setQuotaBranchName(data.branchName || user?.branch_name || '');
      }
    } catch (err) {
      console.error('获取算力额度申请记录失败:', err);
    }
  };

  // 获取能量值提现记录
  const fetchEnergyWithdrawRecords = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/provider/energy-withdraw', { headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        setEnergyWithdrawRecords(data.data || []);
      }
    } catch (err) {
      console.error('获取能量值提现记录失败:', err);
    }
  };

  const handleMemberSearch = () => {
    fetchMembers(1, memberSearch);
  };

  const handleLogout = () => {
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('userId');
    localStorage.removeItem('userName');
    localStorage.removeItem('userRole');
    localStorage.removeItem('userData');
    localStorage.removeItem('token');
    window.location.href = '/';
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('已复制到剪贴板', 'success');
  };

  const menuItems = [
    { id: 'overview', name: '数据总览', icon: BarChart3, badge: 0 },
    { id: 'profile', name: '我的资料', icon: User, badge: 0 },
    { id: 'products', name: '我的产品', icon: Package, badge: 0 },
    { id: 'members', name: '会员管理', icon: Users, badge: 0 },
    { id: 'reviews', name: '审核申请', icon: CheckCircle, badge: 0 },
    { id: 'recharge-review', name: '充值审核', icon: Zap, badge: 0 },
    { id: 'repurchase', name: '回购管理', icon: RefreshCw, badge: 0 },
    { id: 'transfer', name: '产品流转', icon: ArrowRightLeft, badge: transfers.filter(t => t.status === 'awaiting_payment' || t.status === 'seller_confirmed').length },
    { id: 'quota', name: '算力额度', icon: Database, badge: 0 },
    { id: 'energy', name: '能量值管理', icon: Coins, badge: 0 },
  ];

  const menuNames: Record<string, string> = {
    overview: '数据总览',
    profile: '我的资料',
    products: '我的产品',
    members: '会员管理',
    reviews: '审核申请',
    'recharge-review': '充值审核',
    repurchase: '回购管理',
    transfer: '产品流转',
    quota: '算力额度',
    energy: '能量值管理',
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN');
  };

  const renderContent = () => {
    switch (activeMenu) {
      case 'profile':
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">我的资料</h1>
              <p className="text-gray-500 text-sm mt-1">管理您的个人信息</p>
            </div>
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
                    <Label className="text-gray-500">用户名</Label>
                    <div className="flex gap-2 mt-1">
                      {isEditingUsername ? (
                        <>
                          <Input 
                            value={editingUsername} 
                            onChange={(e) => setEditingUsername(e.target.value)}
                            className="flex-1"
                            maxLength={20}
                            placeholder="请输入新用户名"
                          />
                          <Button 
                            size="sm" 
                            onClick={handleSaveUsername}
                            disabled={savingUsername}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            {savingUsername ? '保存中...' : '保存'}
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => {
                              setEditingUsername(user?.username || '');
                              setIsEditingUsername(false);
                            }}
                          >
                            取消
                          </Button>
                        </>
                      ) : (
                        <>
                          <Input value={user?.username || ''} disabled className="flex-1 bg-gray-100" />
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => setIsEditingUsername(true)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">3-20个字符，可包含中文、字母、数字</p>
                  </div>
                  <div>
                    <Label className="text-gray-500">手机号</Label>
                    <Input value={user?.phone || ''} disabled className="mt-1 bg-gray-100" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-500">专属ID</Label>
                    <Input value={user?.unique_id || ''} disabled className="mt-1 bg-gray-100" />
                  </div>
                  <div>
                    <Label className="text-gray-500">能量值</Label>
                    <Input value={user?.energy_value || 0} disabled className="mt-1 bg-gray-100" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lock className="w-5 h-5" />
                  账户安全
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Button variant="outline" onClick={() => setShowPasswordDialog(true)}>
                  <Lock className="w-4 h-4 mr-2" />
                  修改密码
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Gift className="w-5 h-5" />
                  我的邀请码
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <p className="text-sm text-purple-600 mb-2">分享您的邀请码给好友</p>
                  <div className="flex items-center gap-4">
                    <p className="text-2xl font-bold text-purple-700">{user?.invite_code || 'PROV000001'}</p>
                    <Button size="sm" variant="outline" onClick={() => copyToClipboard(user?.invite_code || 'PROV000001')}>
                      <Copy className="w-4 h-4 mr-1" />
                      复制
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        );

      case 'overview':
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">数据总览</h1>
              <p className="text-gray-500 text-sm mt-1">欢迎回来，{user?.username || '服务商'}</p>
            </div>
            <div className="grid grid-cols-4 gap-6">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">会员总数</p>
                      <p className="text-3xl font-bold mt-1">{stats?.memberCount || 0}</p>
                    </div>
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white">
                      <Users className="w-6 h-6" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">能量值余额</p>
                      <p className="text-3xl font-bold mt-1">{user?.energy_value || 0}</p>
                    </div>
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white">
                      <Coins className="w-6 h-6" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">累计投资额</p>
                      <p className="text-3xl font-bold mt-1">{formatCurrency(stats?.totalInvestment || 0)}</p>
                    </div>
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center text-white">
                      <TrendingUp className="w-6 h-6" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">产品销售额</p>
                      <p className="text-3xl font-bold mt-1">{formatCurrency(productStats.soldAmount)}</p>
                    </div>
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center text-white">
                      <Package className="w-6 h-6" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-purple-500" />
                  服务商收益规则
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-purple-50 rounded-lg">
                    <h4 className="font-medium text-purple-800">技术服务费</h4>
                    <p className="text-sm text-purple-600 mt-1">服务商入驻需缴纳技术服务费 ¥2,800</p>
                  </div>
                  <div className="p-4 bg-amber-50 rounded-lg">
                    <h4 className="font-medium text-amber-800">培养服务商</h4>
                    <p className="text-sm text-amber-600 mt-1">培养1个服务商得0.3%，≥3个得0.5%交易额分成</p>
                  </div>
                  <div className="p-4 bg-green-50 rounded-lg">
                    <h4 className="font-medium text-green-800">提现手续费</h4>
                    <p className="text-sm text-green-600 mt-1">服务商收益提现收取5%手续费</p>
                  </div>
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <h4 className="font-medium text-blue-800">最低提现</h4>
                    <p className="text-sm text-blue-600 mt-1">服务商收益提现最低 ¥100 起</p>
                  </div>
                </div>
                
                {/* 服务商收益标准 */}
                <div className="mt-4">
                  <h4 className="font-medium text-gray-700 mb-2">服务商收益标准</h4>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody className="divide-y">

                        <tr className="bg-gray-50">
                          <td className="px-4 py-2 text-gray-600">服务商收益提现手续费</td>
                          <td className="px-4 py-2 text-gray-800 font-medium">5%</td>
                        </tr>
                        <tr className="bg-white">
                          <td className="px-4 py-2 text-gray-600">最低提现金额</td>
                          <td className="px-4 py-2 text-gray-800 font-medium">¥100 起</td>
                        </tr>
                        <tr className="bg-gray-50">
                          <td className="px-4 py-2 text-gray-600">培养1个服务商分成</td>
                          <td className="px-4 py-2 text-gray-800 font-medium">下级交易额的 0.3%</td>
                        </tr>
                        <tr className="bg-white">
                          <td className="px-4 py-2 text-gray-600">培养≥3个服务商分成</td>
                          <td className="px-4 py-2 text-gray-800 font-medium">所有下级交易额的 0.5%</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        );

      case 'products':
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">我的产品</h1>
                <p className="text-gray-500 text-sm mt-1">管理您的算力产品</p>
              </div>
              <div className="flex items-center gap-4">
                <select 
                  value={productFilter}
                  onChange={(e) => setProductFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg"
                >
                  <option value="all">全部产品</option>
                  <option value="available">可购买</option>
                  <option value="sold">已售出</option>
                </select>
              </div>
            </div>
            
            <div className="grid grid-cols-4 gap-4">
              <Card className="border-blue-200">
                <CardContent className="p-4">
                  <p className="text-sm text-gray-500">产品总数</p>
                  <p className="text-2xl font-bold">{productStats.total}</p>
                </CardContent>
              </Card>
              <Card className="border-green-200">
                <CardContent className="p-4">
                  <p className="text-sm text-gray-500">可购买</p>
                  <p className="text-2xl font-bold text-green-600">{productStats.available}</p>
                </CardContent>
              </Card>
              <Card className="border-purple-200">
                <CardContent className="p-4">
                  <p className="text-sm text-gray-500">已售出</p>
                  <p className="text-2xl font-bold text-purple-600">{productStats.sold}</p>
                </CardContent>
              </Card>
              <Card className="border-amber-200">
                <CardContent className="p-4">
                  <p className="text-sm text-gray-500">待售金额</p>
                  <p className="text-2xl font-bold text-amber-600">{formatCurrency(productStats.availableAmount)}</p>
                </CardContent>
              </Card>
            </div>

            {products.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Package className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p>暂无产品数据</p>
              </div>
            ) : (
              <div className="bg-white rounded-lg border overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">产品名称</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">产品编号</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">价格</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">周期</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">收益率</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {products.map((product) => (
                      <tr key={product.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">{product.name}</td>
                        <td className="px-4 py-3 text-gray-500">{product.code}</td>
                        <td className="px-4 py-3 font-medium">{formatCurrency(product.price)}</td>
                        <td className="px-4 py-3">{product.period}天</td>
                        <td className="px-4 py-3 text-green-600">+{product.total_rate}%</td>
                        <td className="px-4 py-3">
                          <Badge variant={product.status === 'available' ? 'default' : 'secondary'}
                            className={product.status === 'available' ? 'bg-green-100 text-green-700' : ''}>
                            {product.status === 'available' ? '可购买' : '已售出'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );

      case 'members':
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">会员管理</h1>
                <p className="text-gray-500 text-sm mt-1">管理您的直属会员</p>
              </div>
            </div>
            
            <Card>
              <CardHeader>
                <div className="flex items-center gap-4">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input 
                      placeholder="搜索用户名或手机号..." 
                      className="pl-9"
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleMemberSearch()}
                    />
                  </div>
                  <Button onClick={handleMemberSearch}>搜索</Button>
                </div>
              </CardHeader>
              <CardContent>
                {members.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Users className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <p>暂无会员数据</p>
                  </div>
                ) : (
                  <>
                    <div className="bg-white rounded-lg border overflow-hidden">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">用户名</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">手机号</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">能量值</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">累计投资</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">持仓产品</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">注册时间</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {members.map((member) => (
                            <tr key={member.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 font-medium">{member.username}</td>
                              <td className="px-4 py-3 text-gray-500">{member.phone}</td>
                              <td className="px-4 py-3 text-amber-600">{member.energy_value}</td>
                              <td className="px-4 py-3">{formatCurrency(member.totalInvestment)}</td>
                              <td className="px-4 py-3">{member.holdingProducts}</td>
                              <td className="px-4 py-3 text-gray-500">{formatDate(member.created_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    
                    {memberPagination.totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4">
                        <p className="text-sm text-gray-500">
                          第 {memberPagination.page} / {memberPagination.totalPages} 页，共 {memberPagination.total} 条
                        </p>
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            disabled={memberPagination.page <= 1}
                            onClick={() => fetchMembers(memberPagination.page - 1, memberSearch)}
                          >
                            上一页
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            disabled={memberPagination.page >= memberPagination.totalPages}
                            onClick={() => fetchMembers(memberPagination.page + 1, memberSearch)}
                          >
                            下一页
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        );

      case 'quota':
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">算力额度</h1>
              <p className="text-gray-500 text-sm mt-1">管理您的算力额度</p>
            </div>
            <div className="grid grid-cols-3 gap-6">
              <Card className="border-blue-200">
                <CardContent className="p-6">
                  <p className="text-sm text-gray-500">初始算力额度</p>
                  <p className="text-3xl font-bold mt-1">{stats?.quota || 0}</p>
                </CardContent>
              </Card>
              <Card className="border-red-200">
                <CardContent className="p-6">
                  <p className="text-sm text-gray-500">已使用算力</p>
                  <p className="text-3xl font-bold mt-1 text-red-500">{stats?.usedQuota || 0}</p>
                </CardContent>
              </Card>
              <Card className="border-green-200">
                <CardContent className="p-6">
                  <p className="text-sm text-gray-500">剩余算力</p>
                  <p className="text-3xl font-bold mt-1 text-green-500">{(stats?.quota || 0) - (stats?.usedQuota || 0)}</p>
                </CardContent>
              </Card>
            </div>
            
            {/* 向分公司申请算力额度 */}
            <Card className="border-blue-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-blue-500" />
                  向分公司申请算力额度
                </CardTitle>
                <CardDescription>向所属分公司申请算力额度，每次申请至少5000元起</CardDescription>
              </CardHeader>
              <CardContent>
                {quotaRequestSuccess && (
                  <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700">
                    {quotaRequestSuccess}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>所属分公司</Label>
                    <Input 
                      value={quotaBranchName || user?.branch_name || '加载中...'}
                      disabled
                      className="mt-1 bg-gray-100"
                    />
                  </div>
                  <div>
                    <Label>申请金额 (最低5000)</Label>
                    <Input 
                      type="number"
                      placeholder="输入申请算力额度"
                      value={quotaRequestAmount}
                      onChange={(e) => setQuotaRequestAmount(e.target.value)}
                      min="5000"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>申请说明 (可选)</Label>
                    <Input 
                      placeholder="备注说明"
                      value={quotaRequestNote}
                      onChange={(e) => setQuotaRequestNote(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
                <Button 
                  className="mt-4 bg-blue-600 hover:bg-blue-700"
                  onClick={handleQuotaRequest}
                  disabled={requestingQuota || !quotaRequestAmount || parseInt(quotaRequestAmount) < 5000}
                >
                  {requestingQuota ? '申请中...' : '提交申请'}
                </Button>

                {/* 申请记录 */}
                {quotaRequests.length > 0 && (
                  <div className="mt-6">
                    <h4 className="font-medium text-gray-700 mb-3">申请记录</h4>
                    <div className="space-y-2">
                      {quotaRequests.map((req) => (
                        <div key={req.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <p className="font-medium">申请金额: ¥{req.requested_amount?.toLocaleString() || 0}</p>
                            <p className="text-sm text-gray-500">
                              {req.note || '无备注'} · {req.created_at ? formatDate(req.created_at) : '-'}
                            </p>
                          </div>
                          <Badge variant={
                            req.status === 'pending' ? 'secondary' :
                            req.status === 'approved' ? 'default' : 'destructive'
                          } className={
                            req.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                            req.status === 'approved' ? 'bg-green-100 text-green-700' : ''
                          }>
                            {req.status === 'pending' ? '待审核' :
                             req.status === 'approved' ? '已通过' : '已拒绝'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        );

      case 'energy':
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">能量值管理</h1>
              <p className="text-gray-500 text-sm mt-1">管理您的能量值，为会员充值</p>
            </div>
            
            {/* 能量值统计卡片 */}
            <div className="grid grid-cols-4 gap-6">
              <Card className="border-amber-200">
                <CardContent className="p-6">
                  <p className="text-sm text-gray-500">能量值余额</p>
                  <p className="text-3xl font-bold mt-1 text-amber-600">{energyBalance.energyValue}</p>
                </CardContent>
              </Card>
              <Card className="border-green-200">
                <CardContent className="p-6">
                  <p className="text-sm text-gray-500">累计充值</p>
                  <p className="text-3xl font-bold mt-1 text-green-600">{energyStats.totalRecharge}</p>
                </CardContent>
              </Card>
              <Card className="border-blue-200">
                <CardContent className="p-6">
                  <p className="text-sm text-gray-500">累计获得</p>
                  <p className="text-3xl font-bold mt-1 text-blue-600">{energyStats.totalTransferIn}</p>
                </CardContent>
              </Card>
              <Card className="border-red-200">
                <CardContent className="p-6">
                  <p className="text-sm text-gray-500">累计转出</p>
                  <p className="text-3xl font-bold mt-1 text-red-600">{energyStats.totalTransferOut}</p>
                </CardContent>
              </Card>
            </div>

            {/* 给会员充值 */}
            <Card className="border-purple-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-purple-500" />
                  给会员充值能量值
                </CardTitle>
                <CardDescription>服务商线下收款后，在此为会员充值能量值</CardDescription>
              </CardHeader>
              <CardContent>
                {rechargeSuccess && (
                  <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700">
                    {rechargeSuccess}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>选择会员</Label>
                    <Input 
                      placeholder="输入会员用户名或手机号"
                      value={rechargeMember?.username || ''}
                      onChange={async (e) => {
                        const search = e.target.value;
                        if (search.length >= 2) {
                          const res = await fetch(`/api/provider/energy/recharge?search=${search}`, { headers: getHeaders() });
                          const data = await res.json();
                          if (data.success && data.data.length > 0) {
                            setRechargeMember(data.data[0]);
                          }
                        }
                      }}
                      className="mt-1"
                    />
                    {rechargeMember && (
                      <p className="text-sm text-green-600 mt-1">
                        已选择: {rechargeMember.username} (当前能量值: {rechargeMember.energy_value})
                      </p>
                    )}
                  </div>
                  <div>
                    <Label>充值金额</Label>
                    <Input 
                      type="number"
                      placeholder="输入能量值数量"
                      value={rechargeAmount}
                      onChange={(e) => setRechargeAmount(e.target.value)}
                      className="mt-1"
                    />
                    <p className="text-xs text-gray-500 mt-1">可用余额: {energyBalance.energyValue}</p>
                  </div>
                  <div>
                    <Label>备注 (可选)</Label>
                    <Input 
                      placeholder="备注说明"
                      value={rechargeNote}
                      onChange={(e) => setRechargeNote(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
                <Button 
                  className="mt-4 bg-purple-600 hover:bg-purple-700"
                  onClick={handleRecharge}
                  disabled={recharging || !rechargeMember || !rechargeAmount}
                >
                  {recharging ? '充值中...' : '确认充值'}
                </Button>
              </CardContent>
            </Card>

            {/* 向分公司申请能量值 */}
            <Card className="border-blue-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-blue-500" />
                  向分公司申请能量值
                </CardTitle>
                <CardDescription>向所属分公司申请能量值配额，等待审核后发放</CardDescription>
              </CardHeader>
              <CardContent>
                {branchRequestSuccess && (
                  <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700">
                    {branchRequestSuccess}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>所属分公司</Label>
                    <Input 
                      value={branchName || user?.branch_name || '加载中...'}
                      disabled
                      className="mt-1 bg-gray-100"
                    />
                  </div>
                  <div>
                    <Label>申请金额</Label>
                    <Input 
                      type="number"
                      placeholder="输入申请能量值数量"
                      value={branchRequestAmount}
                      onChange={(e) => setBranchRequestAmount(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>申请说明 (可选)</Label>
                    <Input 
                      placeholder="备注说明"
                      value={branchRequestNote}
                      onChange={(e) => setBranchRequestNote(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
                <Button 
                  className="mt-4 bg-blue-600 hover:bg-blue-700"
                  onClick={handleBranchRequest}
                  disabled={requestingBranch || !branchRequestAmount}
                >
                  {requestingBranch ? '申请中...' : '提交申请'}
                </Button>

                {/* 申请记录 */}
                {branchRequests.length > 0 && (
                  <div className="mt-6">
                    <h4 className="font-medium text-gray-700 mb-3">申请记录</h4>
                    <div className="space-y-2">
                      {branchRequests.map((req) => (
                        <div key={req.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <p className="font-medium">申请金额: {req.amount}</p>
                            <p className="text-sm text-gray-500">
                              {req.note || '无备注'} · {formatDate(req.created_at)}
                            </p>
                          </div>
                          <Badge variant={
                            req.status === 'pending' ? 'secondary' :
                            req.status === 'approved' ? 'default' : 'destructive'
                          } className={
                            req.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                            req.status === 'approved' ? 'bg-green-100 text-green-700' : ''
                          }>
                            {req.status === 'pending' ? '待审核' :
                             req.status === 'approved' ? '已通过' : '已拒绝'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 能量值提现 */}
            <Card className="border-red-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-red-500" />
                  能量值提现
                </CardTitle>
                <CardDescription>将能量值提现，最低100起，手续费5%</CardDescription>
              </CardHeader>
              <CardContent>
                {withdrawSuccess && (
                  <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700">
                    {withdrawSuccess}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>可提现能量值</Label>
                    <Input 
                      value={energyBalance.energyValue}
                      disabled
                      className="mt-1 bg-gray-100"
                    />
                  </div>
                  <div>
                    <Label>提现金额 (最低100)</Label>
                    <Input 
                      type="number"
                      placeholder="输入提现金额"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      min="100"
                      className="mt-1"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button 
                      className="mt-1 bg-red-600 hover:bg-red-700"
                      onClick={handleEnergyWithdraw}
                      disabled={withdrawing || !withdrawAmount || parseFloat(withdrawAmount) < 100}
                    >
                      {withdrawing ? '提现中...' : '申请提现'}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">手续费5%，最低提现金额100能量值</p>
              </CardContent>
            </Card>

            {/* 能量值记录 */}
            <Card>
              <CardHeader>
                <CardTitle>能量值记录</CardTitle>
              </CardHeader>
              <CardContent>
                {energyRecords.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Coins className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                    <p>暂无能量值记录</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {energyRecords.map((record) => (
                      <div key={record.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            record.type === 'recharge' ? 'bg-green-100 text-green-600' :
                            record.type === 'transfer_in' ? 'bg-blue-100 text-blue-600' :
                            'bg-red-100 text-red-600'
                          }`}>
                            {record.type === 'transfer_out' ? <ArrowDown className="w-5 h-5" /> : <ArrowUp className="w-5 h-5" />}
                          </div>
                          <div>
                            <p className="font-medium">
                              {record.type === 'recharge' ? '充值' : 
                               record.type === 'transfer_in' ? '从 ' + (record.from_username || '系统') + ' 转入' :
                               '转出给 ' + (record.to_username || '未知')}
                            </p>
                            <p className="text-sm text-gray-500">{record.note || '无备注'} · {formatDate(record.created_at)}</p>
                          </div>
                        </div>
                        <p className={`font-bold ${record.type === 'transfer_out' ? 'text-red-600' : 'text-green-600'}`}>
                          {record.type === 'transfer_out' ? '-' : '+'}{record.amount}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 能量值提现记录 */}
            <Card>
              <CardHeader>
                <CardTitle>能量值提现记录</CardTitle>
              </CardHeader>
              <CardContent>
                {withdrawSuccess && (
                  <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700">
                    {withdrawSuccess}
                  </div>
                )}
                {energyWithdrawRecords.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <DollarSign className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                    <p>暂无提现记录</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {energyWithdrawRecords.map((record) => (
                      <div key={record.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <p className="font-medium">申请金额: {record.amount}</p>
                          <p className="text-sm text-gray-500">
                            实际到账: {record.actual_amount} · 手续费: {record.fee}
                          </p>
                          <p className="text-sm text-gray-500">
                            {formatDate(record.created_at)}
                          </p>
                        </div>
                        <Badge variant={
                          record.status === 'pending' ? 'secondary' :
                          record.status === 'approved' ? 'default' : 'destructive'
                        } className={
                          record.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                          record.status === 'approved' ? 'bg-green-100 text-green-700' : ''
                        }>
                          {record.status === 'pending' ? '待审核' :
                           record.status === 'approved' ? '已通过' : '已拒绝'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        );

      case 'reviews':
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">审核申请</h1>
              <p className="text-gray-500 text-sm mt-1">待审核的购买申请</p>
            </div>
            <div className="text-center py-12 text-gray-500">
              <CheckCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p>暂无待审核申请</p>
            </div>
          </div>
        );

      case 'recharge-review':
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">充值审核</h1>
              <p className="text-gray-500 text-sm mt-1">会员能量值充值申请</p>
            </div>
            <div className="text-center py-12 text-gray-500">
              <Zap className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p>暂无待处理充值</p>
            </div>
          </div>
        );

      case 'repurchase':
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">回购管理</h1>
              <p className="text-gray-500 text-sm mt-1">管理待回购产品</p>
            </div>
            <div className="text-center py-12 text-gray-500">
              <RefreshCw className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p>暂无待回购产品</p>
            </div>
          </div>
        );

      case 'transfer':
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">产品流转</h1>
                <p className="text-gray-500 text-sm mt-1">会员间产品流转审核</p>
              </div>
              <Button variant="outline" size="sm" onClick={fetchTransfers}>
                <RefreshCw className="w-4 h-4 mr-1" /> 刷新
              </Button>
            </div>

            {transferLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
              </div>
            ) : transfers.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <ArrowRightLeft className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p>暂无流转记录</p>
              </div>
            ) : (
              <div className="space-y-4">
                {transfers.map((t) => {
                  const isAwaitingPayment = t.status === 'awaiting_payment';
                  const isSellerConfirmed = t.status === 'seller_confirmed';
                  const isPending = isAwaitingPayment || isSellerConfirmed;
                  
                  return (
                    <Card key={t.id} className={`${isSellerConfirmed ? 'border-green-300 bg-green-50/50' : isAwaitingPayment ? 'border-yellow-300 bg-yellow-50/30' : ''}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2">
                              <Package className="w-4 h-4 text-gray-500" />
                              <span className="font-semibold text-gray-900">{t.product_name || t.product_id}</span>
                              <Badge variant={t.status === 'completed' ? 'default' : t.status === 'rejected' ? 'destructive' : 'secondary'}>
                                {t.status === 'pending' ? '待购买' :
                                 t.status === 'awaiting_payment' ? '等待付款' :
                                 t.status === 'seller_confirmed' ? '已确认收款' :
                                 t.status === 'completed' ? '已完成' :
                                 t.status === 'rejected' ? '已拒绝' :
                                 t.status === 'repurchased' ? '已回购' : t.status}
                              </Badge>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                              <div className="text-gray-500">
                                卖家: <span className="text-gray-900 font-medium">{t.from_username || t.from_user_id?.substring(0,8)}</span>
                              </div>
                              <div className="text-gray-500">
                                买家: <span className="text-gray-900 font-medium">{t.to_username || (t.to_user_id ? t.to_user_id.substring(0,8) + '...' : '暂无')}</span>
                              </div>
                              <div className="text-gray-500">
                                流转价格: <span className="text-gray-900 font-medium">¥{t.transfer_price || '-'}</span>
                              </div>
                              <div className="text-gray-500">
                                市场费: <span className="text-gray-900 font-medium">{t.market_fee || '-'}</span>
                              </div>
                            </div>

                            {/* 付款状态 */}
                            {isPending && t.to_user_id && (
                              <div className={`flex items-center gap-2 mt-2 p-2 rounded-md text-sm ${
                                isSellerConfirmed 
                                  ? 'bg-green-100 text-green-700' 
                                  : 'bg-yellow-100 text-yellow-700'
                              }`}>
                                {isSellerConfirmed ? (
                                  <>
                                    <CheckCircle className="w-4 h-4" />
                                    <span>卖家已确认收款，可以审核通过</span>
                                  </>
                                ) : (
                                  <>
                                    <div className="w-4 h-4 rounded-full border-2 border-yellow-500 flex items-center justify-center">
                                      <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                                    </div>
                                    <span>卖家未确认收款，无法审核通过</span>
                                  </>
                                )}
                              </div>
                            )}

                            <div className="text-xs text-gray-400 mt-1">
                              {t.created_at ? new Date(t.created_at).toLocaleString('zh-CN') : ''}
                            </div>
                          </div>

                          {/* 审核按钮 */}
                          {isPending && (
                            <div className="flex gap-2 ml-4">
                              <Button
                                size="sm"
                                variant="default"
                                className="bg-green-600 hover:bg-green-700"
                                disabled={!isSellerConfirmed || reviewingTransfer === t.id}
                                onClick={() => handleTransferReview(t.id, 'approve')}
                                title={!isSellerConfirmed ? '卖家未确认收款，无法审核' : '审核通过'}
                              >
                                {reviewingTransfer === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : '通过'}
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={reviewingTransfer === t.id}
                                onClick={() => handleTransferReview(t.id, 'reject')}
                              >
                                拒绝
                              </Button>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-100">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
          toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.message}
        </div>
      )}

      {/* 左侧导航 */}
      <aside className={`${sidebarCollapsed ? 'w-20' : 'w-64'} bg-gradient-to-b from-slate-900 to-slate-800 min-h-screen flex flex-col border-r border-slate-700 transition-all duration-300`}>
        {/* Logo区域 */}
        <div className="p-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center flex-shrink-0">
              <Shield className="w-6 h-6 text-white" />
            </div>
            {!sidebarCollapsed && (
              <div>
                <h1 className="text-white font-bold text-lg">服务商后台</h1>
                <p className="text-slate-400 text-xs">GPU算力服务平台</p>
              </div>
            )}
          </div>
        </div>

        {/* 菜单 */}
        <nav className="flex-1 p-3 overflow-y-auto">
          <ul className="space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <button
                    onClick={() => setActiveMenu(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all ${
                      activeMenu === item.id
                        ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/30'
                        : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                    } ${sidebarCollapsed ? 'justify-center' : ''}`}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <div className={`flex items-center gap-3 ${sidebarCollapsed ? 'justify-center' : ''}`}>
                      <Icon className="w-5 h-5 flex-shrink-0" />
                      {!sidebarCollapsed && <span className="font-medium text-sm">{item.name}</span>}
                    </div>
                    {!sidebarCollapsed && item.badge !== undefined && item.badge > 0 && (
                      <Badge className="bg-red-500 text-white text-xs">{item.badge}</Badge>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* 底部按钮 */}
        <div className="p-3 border-t border-slate-700 space-y-2">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
          >
            {sidebarCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
            {!sidebarCollapsed && <span className="text-sm">收起</span>}
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            {!sidebarCollapsed && <span className="text-sm">退出登录</span>}
          </button>
        </div>
      </aside>

      {/* 右侧内容 */}
      <main className="flex-1 p-6 overflow-auto">
        {/* 面包屑 */}
        <div className="mb-4 text-sm text-gray-500">
          <span className="text-purple-600">服务商后台</span> / <span>{menuNames[activeMenu]}</span>
        </div>

        {/* 页面内容 */}
        {renderContent()}

        {/* 修改密码对话框 */}
        <ChangePasswordDialog
          open={showPasswordDialog}
          onOpenChange={setShowPasswordDialog}
          userId={user?.id || ''}
        />
      </main>
    </div>
  );
}
