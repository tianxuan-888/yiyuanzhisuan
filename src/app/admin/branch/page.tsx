'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { 
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MyProfile } from '@/components/admin/MyProfile';
import {
  Clock, CheckCircle, XCircle, AlertCircle,
  TrendingUp, DollarSign, CreditCard, ArrowUpRight,
  Server, Users, UserCog, Zap, LogOut, User
} from 'lucide-react';

interface WithdrawRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  requesterPhone: string;
  amount: number;
  fee: number;
  actualAmount: number;
  paymentMethod: string;
  paymentAccount: string | null;
  status: string;
  reviewerNote: string | null;
  createdAt: string;
  approvedAt: string | null;
  completedAt: string | null;
}

interface WithdrawStats {
  total: number;
  pending: number;
  totalAmount: number;
  totalFee: number;
}

interface BranchEnergyWithdrawRequest {
  id: string;
  amount: number;
  fee: number;
  actualAmount: number;
  paymentMethod: string;
  status: string;
  reviewerNote: string | null;
  createdAt: string;
}

export default function BranchPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  
  // 退出登录
  const logout = () => {
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('userId');
    localStorage.removeItem('userName');
    localStorage.removeItem('userRole');
    localStorage.removeItem('userData');
    router.push('/');
  };
  
  // 主Tab状态
  const [activeMainTab, setActiveMainTab] = useState('quota');
  // 额度管理子Tab状态
  const [activeQuotaSubTab, setActiveQuotaSubTab] = useState('allocation');
  // 收益管理子Tab状态
  const [activeEnergySubTab, setActiveEnergySubTab] = useState('withdraw-review');
  
  // 额度管理相关状态
  const [quotaAllocations, setQuotaAllocations] = useState<any[]>([]);
  const [quotaStats, setQuotaStats] = useState({
    totalQuota: 0,
    usedQuota: 0,
    availableQuota: 0,
    providerCount: 0
  });
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [showAllocationDialog, setShowAllocationDialog] = useState(false);
  const [allocationAmount, setAllocationAmount] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<any>(null);
  
  // 提现审核相关状态
  const [withdrawRequests, setWithdrawRequests] = useState<WithdrawRequest[]>([]);
  const [withdrawStats, setWithdrawStats] = useState<WithdrawStats>({ total: 0, pending: 0, totalAmount: 0, totalFee: 0 });
  const [withdrawLoading, setWithdrawLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<WithdrawRequest | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve');
  
  // 服务网点变现相关状态
  const [branchWithdrawRequests, setBranchWithdrawRequests] = useState<BranchEnergyWithdrawRequest[]>([]);
  const [branchWithdrawLoading, setBranchWithdrawLoading] = useState(true);
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'alipay' | 'wechat'>('alipay');
  const [paymentAccount, setPaymentAccount] = useState('');
  
  // 服务网点向智算总台申请收益相关状态
  const [branchEnergyRequests, setBranchEnergyRequests] = useState<any[]>([]);
  const [branchEnergyRequestsLoading, setBranchEnergyRequestsLoading] = useState(true);
  const [showApplyEnergyDialog, setShowApplyEnergyDialog] = useState(false);
  const [applyEnergyAmount, setApplyEnergyAmount] = useState('');
  const [applyEnergyNote, setApplyEnergyNote] = useState('');
  
  // 收益状态
  const [balanceValue, setBalanceValue] = useState(0);
  
  // 服务商管理相关状态
  const [providerData, setProviderData] = useState<{
    providers: any[];
    stats: { totalProviders: number; pendingApplications: number; totalSales: number };
  }>({ providers: [], stats: { totalProviders: 0, pendingApplications: 0, totalSales: 0 } });
  const [providerLoading, setProviderLoading] = useState(true);
  
  // 会员管理相关状态
  const [memberData, setMemberData] = useState<{
    members: any[];
    stats: { totalMembers: number; activeMembers: number };
  }>({ members: [], stats: { totalMembers: 0, activeMembers: 0 } });
  const [memberLoading, setMemberLoading] = useState(true);
  
  // 确认转账成功状态
  const [transferSuccess, setTransferSuccess] = useState<{show: boolean; requestId: string; fee: number}>({show: false, requestId: '', fee: 0});

  // 收益申请相关状态
  const [energyRequests, setEnergyRequests] = useState<any[]>([]);
  const [energyRequestLoading, setEnergyRequestLoading] = useState(true);
  const [showEnergyReviewDialog, setShowEnergyReviewDialog] = useState(false);
  const [selectedEnergyRequest, setSelectedEnergyRequest] = useState<any>(null);
  const [energyReviewNote, setEnergyReviewNote] = useState('');
  const [energyReviewAction, setEnergyReviewAction] = useState<'approve' | 'reject'>('approve');
  const loadEnergyRequestsRef = useRef<(() => Promise<void>) | null>(null);

  // 服务网点直接转账相关状态
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [transferType, setTransferType] = useState<'provider' | 'member'>('provider');
  const [selectedTransferTarget, setSelectedTransferTarget] = useState<any>(null);
  const [transferAmount, setTransferAmount] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'branch')) {
      router.push('/');
    }
  }, [user, loading, router]);

  // 初始化加载数据 - 使用 ref 存储 userId 避免循环依赖
  useEffect(() => {
    if (!user?.id) return;
    
    // 统一认证 fetch
    const authFetch = async (url: string, options: RequestInit = {}) => {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...options.headers as Record<string, string>,
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      return fetch(url, { ...options, headers });
    };
    
    const userId = user.id;
    
    const loadData = async () => {
      // 加载服务网点信息 - 同时获取用户信息和收益余额
      try {
        const [userResponse, energyStatsResponse] = await Promise.all([
          authFetch(`/api/auth/login`, {
            method: 'POST',
            body: JSON.stringify({ username: user.name, password: '' }),
          }),
          authFetch(`/api/energy/branch-stats?branchId=${userId}`)
        ]);
        
        const userResult = await userResponse.json();
        const energyStatsResult = await energyStatsResponse.json();
        
        if (userResult.success && userResult.data) {
          setBalanceValue(userResult.data.balance ?? 0);
        }
        
        // 从 energy_accounts 表获取正确的收益余额
        if (energyStatsResult.success && energyStatsResult.data?.branch) {
          setBalanceValue(energyStatsResult.data.branch.balance ?? 0);
        }
      } catch (error) {
        console.error('加载服务网点信息失败:', error);
      }
      
      // 加载服务网点向智算总台申请收益记录
      setBranchEnergyRequestsLoading(true);
      try {
        const response = await fetch(`/api/energy/branch-request?branchId=${userId}`);
        const result = await response.json();
        if (result.success && result.data) {
          setBranchEnergyRequests(result.data.records || []);
        }
      } catch (error) {
        console.error('加载收益申请记录失败:', error);
      }
      setBranchEnergyRequestsLoading(false);
      
      // 加载服务商提现申请
      setWithdrawLoading(true);
      try {
        const response = await fetch(`/api/branch/withdraw-review?branchId=${userId}`);
        const result = await response.json();
        if (result.success && result.data) {
          setWithdrawRequests(result.data.records || []);
          setWithdrawStats(result.data.stats || { total: 0, pending: 0, totalAmount: 0, totalFee: 0 });
        }
      } catch (error) {
        console.error('加载提现申请失败:', error);
      }
      setWithdrawLoading(false);
      
      // 加载服务网点向智算总台变现申请
      setBranchWithdrawLoading(true);
      try {
        const response = await fetch(`/api/branch/energy-withdraw?branchId=${userId}`);
        const result = await response.json();
        if (result.success && result.data) {
          // 转换字段格式：actual_amount -> actualAmount, created_at -> createdAt
          const formattedRecords = (result.data.records || []).map((r: any) => ({
            ...r,
            actualAmount: Number(r.actual_amount || 0),
            fee: Number(r.fee || 0),
            amount: Number(r.amount || 0),
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          }));
          setBranchWithdrawRequests(formattedRecords);
        }
      } catch (error) {
        console.error('加载变现记录失败:', error);
      }
      setBranchWithdrawLoading(false);
      
      // 加载服务商数据
      setProviderLoading(true);
      try {
        const response = await fetch(`/api/branch/providers?branchId=${userId}`);
        const result = await response.json();
        if (result.success && result.data) {
          setProviderData(result.data);
        }
      } catch (error) {
        console.error('加载服务商数据失败:', error);
      }
      setProviderLoading(false);
      
      // 加载会员数据
      setMemberLoading(true);
      try {
        const response = await fetch(`/api/branch/members?branchId=${userId}`);
        const result = await response.json();
        if (result.success && result.data) {
          setMemberData(result.data);
        }
      } catch (error) {
        console.error('加载会员数据失败:', error);
      }
      setMemberLoading(false);
    };
    
    loadData();
  }, [user?.id]);

  // 加载额度分配数据
  const loadQuotaAllocations = async () => {
    if (!user?.id) return;
    setQuotaLoading(true);
    try {
      const response = await fetch(`/api/branch/quota-allocations?branchId=${user.id}`);
      const result = await response.json();
      if (result.success && result.data) {
        setQuotaAllocations(result.data.records || []);
        setQuotaStats(result.data.stats || {
          totalQuota: 0,
          usedQuota: 0,
          availableQuota: 0,
          providerCount: 0
        });
      }
    } catch (error) {
      console.error('加载额度分配失败:', error);
    }
    setQuotaLoading(false);
  };

  // 额度分配给服务商
  const handleAllocation = async () => {
    if (!selectedProvider || !allocationAmount || parseFloat(allocationAmount) <= 0) {
      alert('请选择服务商并输入分配额度');
      return;
    }
    
    try {
      const authFetch = async (url: string, options: RequestInit = {}) => {
        const token = localStorage.getItem('token');
        const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((options.headers || {}) as Record<string, string>) };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return fetch(url, { ...options, headers });
      };
      const response = await authFetch('/api/branch/quota-allocations', {
        method: 'POST',
        body: JSON.stringify({
          branchId: user?.id,
          providerId: selectedProvider.id,
          amount: parseFloat(allocationAmount),
        }),
      });
      const result = await response.json();
      if (result.success) {
        alert('额度分配成功！');
        setShowAllocationDialog(false);
        setAllocationAmount('');
        setSelectedProvider(null);
        loadQuotaAllocations();
      } else {
        alert(result.error || '分配失败');
      }
    } catch (error) {
      console.error('额度分配失败:', error);
      alert('分配失败，请重试');
    }
  };

  // 加载额度统计数据
  useEffect(() => {
    if (user?.id && activeMainTab === 'quota') {
      loadQuotaAllocations();
    }
  }, [user?.id, activeMainTab]);

  // 收益管理tab切换时加载数据
  useEffect(() => {
    if (user?.id && activeMainTab === 'energy') {
      loadEnergyRequestsRef.current?.();
    }
  }, [user?.id, activeMainTab]);

  // 加载收益申请列表
  const loadEnergyRequests = useCallback(async () => {
    if (!user?.id) return;
    setEnergyRequestLoading(true);
    try {
      const response = await fetch(`/api/energy/request?branchId=${user.id}`);
      const result = await response.json();
      if (result.success) {
        setEnergyRequests(result.data || []);
      }
    } catch (error) {
      console.error('加载收益申请失败:', error);
    }
    setEnergyRequestLoading(false);
  }, [user?.id]);

  // 设置 ref 引用
  useEffect(() => {
    loadEnergyRequestsRef.current = loadEnergyRequests;
  }, [loadEnergyRequests]);

  // 审核收益申请
  const handleEnergyReview = async () => {
    if (!selectedEnergyRequest) return;

    const authFetch = async (url: string, options: RequestInit = {}) => {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((options.headers || {}) as Record<string, string>) };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return fetch(url, { ...options, headers });
    };

    try {
      const response = await authFetch('/api/branch/approve-energy-request', {
        method: 'POST',
        body: JSON.stringify({
          requestId: selectedEnergyRequest.id,
          branchId: user?.id,
          action: energyReviewAction,
          note: energyReviewNote,
        }),
      });
      const result = await response.json();
      if (result.success) {
        alert(energyReviewAction === 'approve' ? '审核通过，收益已发放！' : '已拒绝该申请');
        setShowEnergyReviewDialog(false);
        loadEnergyRequests();
        // 刷新服务网点收益
        const userResponse = await authFetch(`/api/auth/login`, {
          method: 'POST',
          body: JSON.stringify({ username: user?.name || '', password: '' }),
        });
        const userResult = await userResponse.json();
        if (userResult.success && userResult.data) {
          setBalanceValue(userResult.data.balance ?? 0);
        }
      } else {
        alert(result.error || '操作失败');
      }
    } catch (error) {
      alert('网络错误，请稍后重试');
    }
  };

  // 服务网点直接转账给服务商或会员
  const handleDirectTransfer = async () => {
    if (!selectedTransferTarget || !transferAmount || parseFloat(transferAmount) <= 0) {
      alert('请选择转账对象并输入金额');
      return;
    }

    const amount = parseFloat(transferAmount);
    if (amount > balanceValue) {
      alert('收益余额不足');
      return;
    }

    const authFetch = async (url: string, options: RequestInit = {}) => {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((options.headers || {}) as Record<string, string>) };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return fetch(url, { ...options, headers });
    };

    try {
      const response = await authFetch('/api/branch/transfer-energy', {
        method: 'POST',
        body: JSON.stringify({
          branchId: user?.id,
          targetId: selectedTransferTarget.id,
          targetType: transferType,
          amount: amount,
          note: `${transferType === 'provider' ? '服务商' : '会员'}转账`,
        }),
      });
      const result = await response.json();
      if (result.success) {
        alert(result.message);
        setShowTransferDialog(false);
        setTransferAmount('');
        setSelectedTransferTarget(null);
        // 刷新收益
        if (result.data) {
          setBalanceValue(result.data.branchEnergy);
        }
      } else {
        alert(result.error || '转账失败');
      }
    } catch (error) {
      alert('网络错误，请稍后重试');
    }
  };

  // 服务网点向智算总台申请收益
  const handleApplyEnergy = async () => {
    if (!applyEnergyAmount || parseFloat(applyEnergyAmount) < 100) {
      alert('申请金额最低为100收益');
      return;
    }
    
    const authFetch = async (url: string, options: RequestInit = {}) => {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((options.headers || {}) as Record<string, string>) };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return fetch(url, { ...options, headers });
    };

    try {
      const response = await authFetch('/api/energy/branch-request', {
        method: 'POST',
        body: JSON.stringify({
          branchId: user?.id,
          amount: applyEnergyAmount,
          note: applyEnergyNote,
        }),
      });
      const result = await response.json();
      if (result.success) {
        alert('收益申请已提交，等待智算总台审核！');
        setShowApplyEnergyDialog(false);
        setApplyEnergyAmount('');
        setApplyEnergyNote('');
        // 刷新申请记录
        setBranchEnergyRequestsLoading(true);
        try {
          const resp = await authFetch(`/api/energy/branch-request?branchId=${user?.id}`);
          const respData = await resp.json();
          if (respData.success && respData.data) {
            setBranchEnergyRequests(respData.data.records || []);
          }
        } catch (error) {
          console.error('刷新申请记录失败:', error);
        }
        setBranchEnergyRequestsLoading(false);
      } else {
        alert(result.error || '申请失败');
      }
    } catch (error) {
      alert('网络错误，请稍后重试');
    }
  };

  const handleReview = async () => {
    if (!selectedRequest) return;
    
    const authFetch = async (url: string, options: RequestInit = {}) => {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((options.headers || {}) as Record<string, string>) };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return fetch(url, { ...options, headers });
    };

    try {
      if (reviewAction === 'approve') {
        // 审核通过
        const response = await authFetch('/api/branch/withdraw-review', {
          method: 'POST',
          body: JSON.stringify({
            requestId: selectedRequest.id,
            branchId: user?.id,
            action: 'approve',
            note: reviewNote,
          }),
        });
        const result = await response.json();
        if (result.success) {
          alert('审核通过！请线下转账后确认到账。');
          setShowReviewDialog(false);
          // 刷新提现申请列表
          setWithdrawLoading(true);
          try {
            const response = await fetch(`/api/branch/withdraw-review?branchId=${user?.id}`);
            const result = await response.json();
            if (result.success && result.data) {
              setWithdrawRequests(result.data.records || []);
              setWithdrawStats(result.data.stats || { total: 0, pending: 0, totalAmount: 0, totalFee: 0 });
            }
          } catch (error) {
            console.error('刷新提现申请失败:', error);
          }
          setWithdrawLoading(false);
        } else {
          alert(result.error || '操作失败');
        }
      } else {
        // 拒绝
        const response = await authFetch('/api/branch/withdraw-review', {
          method: 'POST',
          body: JSON.stringify({
            requestId: selectedRequest.id,
            branchId: user?.id,
            action: 'reject',
            note: reviewNote,
          }),
        });
        const result = await response.json();
        if (result.success) {
          alert('已拒绝该申请');
          setShowReviewDialog(false);
          // 刷新提现申请列表
          setWithdrawLoading(true);
          try {
            const response = await authFetch(`/api/branch/withdraw-review?branchId=${user?.id}`);
            const result = await response.json();
            if (result.success && result.data) {
              setWithdrawRequests(result.data.records || []);
              setWithdrawStats(result.data.stats || { total: 0, pending: 0, totalAmount: 0, totalFee: 0 });
            }
          } catch (error) {
            console.error('刷新提现申请失败:', error);
          }
          setWithdrawLoading(false);
        } else {
          alert(result.error || '操作失败');
        }
      }
    } catch (error) {
      alert('网络错误，请稍后重试');
    }
  };

  const handleConfirmTransfer = async (request: WithdrawRequest) => {
    if (!confirm(`确认已向 ${request.requesterName} 转账 ${request.actualAmount} 收益？\n转账后将扣除服务商收益并记录沉淀。`)) return;

    const authFetch = async (url: string, options: RequestInit = {}) => {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((options.headers || {}) as Record<string, string>) };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return fetch(url, { ...options, headers });
    };
    
    try {
      const response = await authFetch('/api/branch/withdraw-review', {
        method: 'PUT',
        body: JSON.stringify({
          requestId: request.id,
          branchId: user?.id,
        }),
      });
      const result = await response.json();
      if (result.success) {
        // 显示成功消息
        setTransferSuccess({show: true, requestId: request.id, fee: request.fee});
        // 跳转到提现记录标签
        setActiveEnergySubTab('withdraw-records');
        // 刷新数据
        setWithdrawLoading(true);
        try {
          const resp = await authFetch(`/api/branch/withdraw-review?branchId=${user?.id}`);
          const respData = await resp.json();
          if (respData.success && respData.data) {
            setWithdrawRequests(respData.data.records || []);
            setWithdrawStats(respData.data.stats || { total: 0, pending: 0, totalAmount: 0, totalFee: 0 });
          }
        } catch (error) {
          console.error('刷新提现申请失败:', error);
        }
        setWithdrawLoading(false);
        // 刷新服务网点收益
        const userResponse = await fetch(`/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: user?.name, password: '' }),
        });
        const userResult = await userResponse.json();
        if (userResult.success && userResult.data) {
          setBalanceValue(userResult.data.balance ?? 0);
        }
      } else {
        alert(result.error || '操作失败');
      }
    } catch (error) {
      alert('网络错误，请稍后重试');
    }
  };

  const handleBranchWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount < 100) {
      alert('最低变现金额为 100 收益');
      return;
    }
    if (amount > balanceValue) {
      alert('收益余额不足');
      return;
    }
    if (!paymentAccount) {
      alert('请填写收款账号');
      return;
    }

    const authFetch = async (url: string, options: RequestInit = {}) => {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((options.headers || {}) as Record<string, string>) };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return fetch(url, { ...options, headers });
    };

    try {
      const response = await authFetch('/api/branch/energy-withdraw', {
        method: 'POST',
        body: JSON.stringify({
          branchId: user?.id,
          amount: amount,
          paymentMethod: paymentMethod,
          paymentAccount: paymentAccount,
        }),
      });
      const result = await response.json();
      if (result.success) {
        alert('变现申请已提交，等待智算总台审核！');
        setShowWithdrawDialog(false);
        setWithdrawAmount('');
        setPaymentAccount('');
        // 刷新变现记录
        setBranchWithdrawLoading(true);
        try {
          const resp = await authFetch(`/api/branch/energy-withdraw?branchId=${user?.id}`);
          const respData = await resp.json();
          if (respData.success && respData.data) {
            // 转换字段格式：actual_amount -> actualAmount, created_at -> createdAt
            const formattedRecords = (respData.data.records || []).map((r: any) => ({
              ...r,
              actualAmount: Number(r.actual_amount || 0),
              fee: Number(r.fee || 0),
              amount: Number(r.amount || 0),
              createdAt: r.created_at,
              updatedAt: r.updated_at,
            }));
            setBranchWithdrawRequests(formattedRecords);
          }
        } catch (error) {
          console.error('刷新变现记录失败:', error);
        }
        setBranchWithdrawLoading(false);
      } else {
        alert(result.error || '提交失败');
      }
    } catch (error) {
      alert('网络错误，请稍后重试');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/50">待审核</Badge>;
      case 'approved':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/50">待转账</Badge>;
      case 'completed':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/50">已完成</Badge>;
      case 'rejected':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/50">已拒绝</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const formatDate = (dateStr: string | undefined | null) => {
    if (!dateStr) return '-';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return '-';
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '-';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white">加载中...</div>
      </div>
    );
  }

  if (!user || user.role !== 'branch') {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-900">
      {/* 成功提示横幅 */}
      {transferSuccess.show && (
        <div className="bg-green-500/20 border-b border-green-500/50 px-6 py-4">
          <div className="flex items-center justify-between max-w-7xl mx-auto">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-500/30 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <p className="text-green-400 font-semibold">转账确认成功！</p>
                <p className="text-green-400/80 text-sm">
                  已向服务商转账，该服务商收益已扣除，{transferSuccess.fee} 收益已沉淀到您的账户
                </p>
              </div>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-green-400 hover:text-green-300"
              onClick={() => setTransferSuccess({show: false, requestId: '', fee: 0})}
            >
              关闭
            </Button>
          </div>
        </div>
      )}
      
      {/* 头部 */}
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 flex items-center justify-center">
              <span className="text-white font-bold">服务网点</span>
            </div>
            <div>
              <h1 className="text-white font-bold text-lg">{user.name}</h1>
              <p className="text-gray-400 text-sm">服务网点管控后台</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Button 
              variant="outline" 
              onClick={logout}
              className="border-slate-600 text-slate-300 hover:bg-slate-700"
            >
              <LogOut className="w-4 h-4 mr-2" />
              退出登录
            </Button>
          </div>
        </div>
      </header>

      <main className="p-6">
        {/* 主Tab导航 */}
        <div className="mb-6">
          <Tabs value={activeMainTab} onValueChange={setActiveMainTab}>
            <TabsList className="bg-slate-800 border-slate-700 grid grid-cols-5 w-full">
              <TabsTrigger 
                value="my-profile" 
                className="data-[state=active]:bg-blue-500 flex items-center gap-2"
              >
                <User className="w-4 h-4" />
                我的
              </TabsTrigger>
              <TabsTrigger 
                value="quota" 
                className="data-[state=active]:bg-blue-500 flex items-center gap-2"
              >
                <Server className="w-4 h-4" />
                算力额度管理
              </TabsTrigger>
              <TabsTrigger 
                value="provider" 
                className="data-[state=active]:bg-blue-500 flex items-center gap-2"
              >
                <UserCog className="w-4 h-4" />
                服务商管理
              </TabsTrigger>
              <TabsTrigger 
                value="member" 
                className="data-[state=active]:bg-blue-500 flex items-center gap-2"
              >
                <Users className="w-4 h-4" />
                会员管理
              </TabsTrigger>
              <TabsTrigger 
                value="energy" 
                className="data-[state=active]:bg-blue-500 flex items-center gap-2"
              >
                <Zap className="w-4 h-4" />
                收益管理
              </TabsTrigger>
            </TabsList>

            {/* 我的 */}
            <TabsContent value="my-profile">
              <MyProfile />
            </TabsContent>

        {/* 算力额度管理 */}
        <TabsContent value="quota">
          {/* 额度统计卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <Server className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm">算力总额度</p>
                    <p className="text-2xl font-bold text-blue-400">{(quotaStats.totalQuota || 0).toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-yellow-400" />
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm">已分配额度</p>
                    <p className="text-2xl font-bold text-yellow-400">{(quotaStats.usedQuota || 0).toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                    <DollarSign className="w-5 h-5 text-green-400" />
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm">剩余可用额度</p>
                    <p className="text-2xl font-bold text-green-400">{(quotaStats.availableQuota || 0).toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                    <UserCog className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm">服务商数量</p>
                    <p className="text-2xl font-bold text-purple-400">{quotaStats.providerCount}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 额度管理子Tab */}
          <Tabs value={activeQuotaSubTab} onValueChange={setActiveQuotaSubTab} className="space-y-4">
            <TabsList className="bg-slate-800 border-slate-700">
              <TabsTrigger value="allocation" className="data-[state=active]:bg-blue-500">
                额度分配
              </TabsTrigger>
              <TabsTrigger value="application" className="data-[state=active]:bg-blue-500">
                额度申请
              </TabsTrigger>
              <TabsTrigger value="statistics" className="data-[state=active]:bg-blue-500">
                使用统计
              </TabsTrigger>
            </TabsList>

            {/* 额度分配 */}
            <TabsContent value="allocation">
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-white flex items-center gap-2">
                      <Server className="w-5 h-5 text-blue-400" />
                      额度分配给服务商
                    </CardTitle>
                    <Button className="bg-green-500 hover:bg-green-600" onClick={() => setShowAllocationDialog(true)}>
                      <TrendingUp className="w-4 h-4 mr-2" />
                      分配额度
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {quotaLoading ? (
                    <div className="text-center text-gray-400 py-8">加载中...</div>
                  ) : quotaAllocations.length === 0 ? (
                    <div className="text-center text-gray-400 py-8">暂无分配记录</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-700">
                          <TableHead className="text-gray-400">服务商</TableHead>
                          <TableHead className="text-gray-400">联系方式</TableHead>
                          <TableHead className="text-gray-400">分配额度</TableHead>
                          <TableHead className="text-gray-400">已使用</TableHead>
                          <TableHead className="text-gray-400">剩余额度</TableHead>
                          <TableHead className="text-gray-400">分配时间</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {quotaAllocations.map((allocation, idx) => (
                          <TableRow key={`alloc-${allocation.id}-${idx}`} className="border-slate-700">
                            <TableCell className="text-white">{allocation.providerName}</TableCell>
                            <TableCell className="text-gray-400">{allocation.providerPhone}</TableCell>
                            <TableCell className="text-blue-400">{(allocation.totalAmount || 0).toLocaleString()}</TableCell>
                            <TableCell className="text-yellow-400">{(allocation.usedAmount || 0).toLocaleString()}</TableCell>
                            <TableCell className="text-green-400">{(allocation.availableAmount || 0).toLocaleString()}</TableCell>
                            <TableCell className="text-gray-400 text-sm">{formatDate(allocation.createdAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* 额度申请 */}
            <TabsContent value="application">
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Server className="w-5 h-5 text-yellow-400" />
                    向智算总台申请额度
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="p-4 rounded-lg bg-slate-700/50 mb-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                        <DollarSign className="w-5 h-5 text-blue-400" />
                      </div>
                      <div>
                        <p className="text-gray-400 text-sm">当前可用额度</p>
                        <p className="text-2xl font-bold text-blue-400">{quotaStats.availableQuota.toLocaleString()}</p>
                      </div>
                    </div>
                    <p className="text-gray-500 text-sm">
                      说明：申请一万算力额度，配比收益 2000（1万额度 = 2000收益）
                    </p>
                  </div>
                  
                  <div className="text-center text-gray-500 py-8">
                    额度申请功能开发中，请联系智算总台申请额度...
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* 使用统计 */}
            <TabsContent value="statistics">
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-green-400" />
                    额度使用统计
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="p-4 rounded-lg bg-slate-700/50">
                      <h4 className="text-white font-medium mb-4">额度使用分布</h4>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400">已分配</span>
                          <div className="flex items-center gap-2">
                            <div className="w-32 h-2 bg-slate-600 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-yellow-500 rounded-full"
                                style={{ width: `${quotaStats.totalQuota > 0 ? (quotaStats.usedQuota / quotaStats.totalQuota) * 100 : 0}%` }}
                              />
                            </div>
                            <span className="text-white text-sm">{(quotaStats.usedQuota || 0).toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400">剩余可用</span>
                          <div className="flex items-center gap-2">
                            <div className="w-32 h-2 bg-slate-600 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-green-500 rounded-full"
                                style={{ width: `${quotaStats.totalQuota > 0 ? (quotaStats.availableQuota / quotaStats.totalQuota) * 100 : 0}%` }}
                              />
                            </div>
                            <span className="text-white text-sm">{(quotaStats.availableQuota || 0).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="p-4 rounded-lg bg-slate-700/50">
                      <h4 className="text-white font-medium mb-4">服务商额度使用排名</h4>
                      {quotaAllocations.length === 0 ? (
                        <div className="text-center text-gray-500 py-4">暂无数据</div>
                      ) : (
                        <div className="space-y-2">
                          {quotaAllocations.slice(0, 5).map((allocation, idx) => (
                            <div key={`alloc-card-${allocation.id}-${idx}`} className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <span className="text-gray-500 text-sm">#{idx + 1}</span>
                                <span className="text-white text-sm">{allocation.providerName}</span>
                              </div>
                              <span className="text-yellow-400 text-sm">{(allocation.usedAmount || 0).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* 服务商管理 */}
        <TabsContent value="provider">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <UserCog className="w-5 h-5 text-purple-400" />
                服务商管理
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="p-4 rounded-lg bg-slate-700/50">
                  <p className="text-gray-400 text-sm">服务商总数</p>
                  <p className="text-2xl font-bold text-purple-400">{providerData.stats.totalProviders}</p>
                </div>
                <div className="p-4 rounded-lg bg-slate-700/50">
                  <p className="text-gray-400 text-sm">待审核申请</p>
                  <p className="text-2xl font-bold text-yellow-400">{providerData.stats.pendingApplications}</p>
                </div>
                <div className="p-4 rounded-lg bg-slate-700/50">
                  <p className="text-gray-400 text-sm">服务商总业绩</p>
                  <p className="text-2xl font-bold text-green-400">{((providerData?.stats?.totalSales) || 0).toLocaleString()}</p>
                </div>
              </div>
              
              {providerLoading ? (
                <div className="text-center text-gray-500 py-8">加载中...</div>
              ) : providerData.providers.length === 0 ? (
                <div className="text-center text-gray-500 py-8">暂无服务商数据</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="text-gray-400">服务商名称</TableHead>
                      <TableHead className="text-gray-400">手机号</TableHead>
                      <TableHead className="text-gray-400">额度</TableHead>
                      <TableHead className="text-gray-400">已用额度</TableHead>
                      <TableHead className="text-gray-400">剩余额度</TableHead>
                      <TableHead className="text-gray-400">收益</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {providerData.providers.map((provider, idx) => (
                      <TableRow key={`prov-${provider.id}-${idx}`} className="border-slate-700">
                        <TableCell className="text-white">{provider.realName || provider.username}</TableCell>
                        <TableCell className="text-gray-400">{provider.phone || '-'}</TableCell>
                        <TableCell className="text-white">{(provider.quotaAmount || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-yellow-400">{(provider.usedAmount || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-green-400">{(provider.availableAmount || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-purple-400">{(provider.balance || 0).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 会员管理 */}
        <TabsContent value="member">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-green-400" />
                会员管理
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="p-4 rounded-lg bg-slate-700/50">
                  <p className="text-gray-400 text-sm">会员总数</p>
                  <p className="text-2xl font-bold text-green-400">{memberData.stats.totalMembers}</p>
                </div>
                <div className="p-4 rounded-lg bg-slate-700/50">
                  <p className="text-gray-400 text-sm">活跃会员</p>
                  <p className="text-2xl font-bold text-blue-400">{memberData.stats.activeMembers}</p>
                </div>
                <div className="p-4 rounded-lg bg-slate-700/50">
                  <p className="text-gray-400 text-sm">会员总投资</p>
                  <p className="text-2xl font-bold text-yellow-400">
                    {(memberData?.members?.reduce((sum, m) => sum + (m.totalInvestment || 0), 0) || 0).toLocaleString()}
                  </p>
                </div>
              </div>
              
              {memberLoading ? (
                <div className="text-center text-gray-500 py-8">加载中...</div>
              ) : memberData.members.length === 0 ? (
                <div className="text-center text-gray-500 py-8">暂无会员数据</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="text-gray-400">会员名称</TableHead>
                      <TableHead className="text-gray-400">手机号</TableHead>
                      <TableHead className="text-gray-400">所属服务商</TableHead>
                      <TableHead className="text-gray-400">总投资金额</TableHead>
                      <TableHead className="text-gray-400">持仓产品</TableHead>
                      <TableHead className="text-gray-400">收益</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {memberData.members.map((member, idx) => (
                      <TableRow key={`member-${member.id}-${idx}`} className="border-slate-700">
                        <TableCell className="text-white">{member.realName || member.username}</TableCell>
                        <TableCell className="text-gray-400">{member.phone || '-'}</TableCell>
                        <TableCell className="text-gray-400">{member.providerName || '-'}</TableCell>
                        <TableCell className="text-yellow-400">{(member.totalInvestment || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-blue-400">{member.holdingProducts || 0}</TableCell>
                        <TableCell className="text-purple-400">{(member.balance || 0).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 收益管理 - 包含子Tab */}
        <TabsContent value="energy">
          {/* 收益管理统计卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-yellow-400" />
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm">收益余额</p>
                    <p className="text-2xl font-bold text-white">{(balanceValue || 0).toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-yellow-400" />
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm">待审核</p>
                    <p className="text-2xl font-bold text-white">{withdrawStats.pending}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                    <DollarSign className="w-5 h-5 text-green-400" />
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm">已转账总额</p>
                    <p className="text-2xl font-bold text-white">{((withdrawStats?.totalAmount) || 0).toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <CreditCard className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm">变现申请</p>
                    <p className="text-2xl font-bold text-white">{branchWithdrawRequests.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 收益管理子Tab */}
          <Tabs value={activeEnergySubTab} onValueChange={setActiveEnergySubTab} className="space-y-4">
            <TabsList className="bg-slate-800 border-slate-700 grid grid-cols-6">
              <TabsTrigger value="apply-energy" className="data-[state=active]:bg-blue-500">
                申请收益
              </TabsTrigger>
              <TabsTrigger value="withdraw-review" className="data-[state=active]:bg-blue-500">
                提现审核
              </TabsTrigger>
              <TabsTrigger value="energy-request-review" className="data-[state=active]:bg-blue-500">
                充值审核
              </TabsTrigger>
              <TabsTrigger value="direct-transfer" className="data-[state=active]:bg-blue-500">
                直接转账
              </TabsTrigger>
              <TabsTrigger value="withdraw-records" className="data-[state=active]:bg-blue-500">
                提现记录
              </TabsTrigger>
              <TabsTrigger value="branch-withdraw" className="data-[state=active]:bg-blue-500">
                收益兑换
              </TabsTrigger>
            </TabsList>

          {/* 申请收益 - 服务网点向智算总台申请 */}
          <TabsContent value="apply-energy">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white flex items-center gap-2">
                    <Zap className="w-5 h-5 text-yellow-400" />
                    向智算总台申请收益
                  </CardTitle>
                  <Button 
                    className="bg-green-500 hover:bg-green-600"
                    onClick={() => setShowApplyEnergyDialog(true)}
                  >
                    <ArrowUpRight className="w-4 h-4 mr-2" />
                    申请收益
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* 申请统计 */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="p-4 rounded-lg bg-slate-700/50">
                    <p className="text-gray-400 text-sm">可用收益</p>
                    <p className="text-2xl font-bold text-yellow-400">{balanceValue.toLocaleString()}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-slate-700/50">
                    <p className="text-gray-400 text-sm">已申请总额</p>
                    <p className="text-2xl font-bold text-white">
                      {branchEnergyRequests.reduce((sum, r) => sum + (r.amount || 0), 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-slate-700/50">
                    <p className="text-gray-400 text-sm">待审核</p>
                    <p className="text-2xl font-bold text-yellow-400">
                      {branchEnergyRequests.filter(r => r.status === 'pending').length}
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-slate-700/50">
                    <p className="text-gray-400 text-sm">已通过</p>
                    <p className="text-2xl font-bold text-green-400">
                      {branchEnergyRequests.filter(r => r.status === 'approved').length}
                    </p>
                  </div>
                </div>

                {/* 申请记录表格 */}
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="text-gray-400">申请金额</TableHead>
                      <TableHead className="text-gray-400">备注</TableHead>
                      <TableHead className="text-gray-400">状态</TableHead>
                      <TableHead className="text-gray-400">申请时间</TableHead>
                      <TableHead className="text-gray-400">审核备注</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {branchEnergyRequestsLoading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-gray-400 py-8">加载中...</TableCell>
                      </TableRow>
                    ) : branchEnergyRequests.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-gray-400 py-8">暂无申请记录</TableCell>
                      </TableRow>
                    ) : (
                      branchEnergyRequests.map((request, idx) => (
                        <TableRow key={`branch-energy-${request.id}-${idx}`} className="border-slate-700">
                          <TableCell className="text-white font-medium">
                            +{Number(request.amount || 0).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-gray-400 text-sm">
                            {request.note || '-'}
                          </TableCell>
                          <TableCell>
                            {request.status === 'pending' && (
                              <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/50">
                                待审核
                              </Badge>
                            )}
                            {request.status === 'approved' && (
                              <Badge className="bg-green-500/20 text-green-400 border-green-500/50">
                                已通过
                              </Badge>
                            )}
                            {request.status === 'rejected' && (
                              <Badge className="bg-red-500/20 text-red-400 border-red-500/50">
                                已拒绝
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-gray-400 text-sm">
                            {formatDate(request.createdAt)}
                          </TableCell>
                          <TableCell className="text-gray-400 text-sm">
                            {request.reviewerNote || '-'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 提现审核 */}
          <TabsContent value="withdraw-review">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-yellow-400" />
                  服务商提现申请
                </CardTitle>
              </CardHeader>
              <CardContent>
                {withdrawLoading ? (
                  <div className="text-center text-gray-400 py-8">加载中...</div>
                ) : withdrawRequests.filter(r => r.status === 'pending' || r.status === 'approved').length === 0 ? (
                  <div className="text-center text-gray-400 py-8">暂无待处理申请</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-700">
                        <TableHead className="text-gray-400">服务商</TableHead>
                        <TableHead className="text-gray-400">联系方式</TableHead>
                        <TableHead className="text-gray-400">转账金额</TableHead>
                        <TableHead className="text-gray-400">收款方式</TableHead>
                        <TableHead className="text-gray-400">状态</TableHead>
                        <TableHead className="text-gray-400">申请时间</TableHead>
                        <TableHead className="text-gray-400">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {withdrawRequests
                        .filter(r => r.status === 'pending' || r.status === 'approved')
                        .map((request, idx) => (
                          <TableRow key={`withdraw-${request.id}-${idx}`} className="border-slate-700">
                            <TableCell className="text-white">{request.requesterName}</TableCell>
                            <TableCell className="text-gray-400">{request.requesterPhone}</TableCell>
                            <TableCell className="text-red-400">-{(request.actualAmount || 0).toLocaleString()}</TableCell>
                            <TableCell className="text-gray-400">
                              {request.paymentMethod === 'alipay' ? '💙 支付宝' : '🟢 微信'}
                            </TableCell>
                            <TableCell>{getStatusBadge(request.status)}</TableCell>
                            <TableCell className="text-gray-400 text-sm">{formatDate(request.createdAt)}</TableCell>
                            <TableCell>
                              {request.status === 'pending' && (
                                <div className="flex gap-2">
                                  <Button 
                                    size="sm" 
                                    className="bg-green-500 hover:bg-green-600"
                                    onClick={() => {
                                      setSelectedRequest(request);
                                      setReviewAction('approve');
                                      setReviewNote('');
                                      setShowReviewDialog(true);
                                    }}
                                  >
                                    审核
                                  </Button>
                                </div>
                              )}
                              {request.status === 'approved' && (
                                <Button 
                                  size="sm" 
                                  className="bg-blue-500 hover:bg-blue-600"
                                  onClick={() => handleConfirmTransfer(request)}
                                >
                                  确认转账
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 收益充值审核 */}
          <TabsContent value="energy-request-review">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white flex items-center gap-2">
                    <Zap className="w-5 h-5 text-yellow-400" />
                    服务商充值申请
                  </CardTitle>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-slate-600 text-gray-300"
                    onClick={loadEnergyRequests}
                  >
                    刷新
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {energyRequestLoading ? (
                  <div className="text-center text-gray-400 py-8">加载中...</div>
                ) : energyRequests.length === 0 ? (
                  <div className="text-center text-gray-400 py-8">暂无充值申请</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-700">
                        <TableHead className="text-gray-400">服务商</TableHead>
                        <TableHead className="text-gray-400">联系方式</TableHead>
                        <TableHead className="text-gray-400">申请金额</TableHead>
                        <TableHead className="text-gray-400">备注</TableHead>
                        <TableHead className="text-gray-400">状态</TableHead>
                        <TableHead className="text-gray-400">申请时间</TableHead>
                        <TableHead className="text-gray-400">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {energyRequests.map((request, idx) => (
                        <TableRow key={`energy-${request.id}-${idx}`} className="border-slate-700">
                          <TableCell className="text-white">{request.providerName}</TableCell>
                          <TableCell className="text-gray-400">{request.providerPhone || '-'}</TableCell>
                          <TableCell className="text-yellow-400 font-bold">+{request.requestedAmount?.toLocaleString()}</TableCell>
                          <TableCell className="text-gray-400">{request.note || '-'}</TableCell>
                          <TableCell>{getStatusBadge(request.status)}</TableCell>
                          <TableCell className="text-gray-400 text-sm">{formatDate(request.createdAt)}</TableCell>
                          <TableCell>
                            {request.status === 'pending' && (
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="bg-green-500 hover:bg-green-600"
                                  onClick={() => {
                                    setSelectedEnergyRequest(request);
                                    setEnergyReviewAction('approve');
                                    setEnergyReviewNote('');
                                    setShowEnergyReviewDialog(true);
                                  }}
                                >
                                  通过
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-red-500/50 text-red-400 hover:bg-red-500/20"
                                  onClick={() => {
                                    setSelectedEnergyRequest(request);
                                    setEnergyReviewAction('reject');
                                    setEnergyReviewNote('');
                                    setShowEnergyReviewDialog(true);
                                  }}
                                >
                                  拒绝
                                </Button>
                              </div>
                            )}
                            {request.status !== 'pending' && (
                              <span className="text-gray-500 text-sm">已处理</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 服务网点直接转账 */}
          <TabsContent value="direct-transfer">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white flex items-center gap-2">
                    <ArrowUpRight className="w-5 h-5 text-green-400" />
                    直接转账收益
                  </CardTitle>
                  <div className="text-right">
                    <p className="text-gray-400 text-sm">可用余额</p>
                    <p className="text-2xl font-bold text-yellow-400">{balanceValue.toLocaleString()}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* 转账类型选择 */}
                <div className="space-y-2">
                  <label className="text-gray-400 text-sm">转账类型</label>
                  <div className="flex gap-4">
                    <Button
                      variant={transferType === 'provider' ? 'default' : 'outline'}
                      className={transferType === 'provider' ? 'bg-blue-500 hover:bg-blue-600' : 'border-slate-600 text-gray-300'}
                      onClick={() => {
                        setTransferType('provider');
                        setSelectedTransferTarget(null);
                      }}
                    >
                      转给服务商
                    </Button>
                    <Button
                      variant={transferType === 'member' ? 'default' : 'outline'}
                      className={transferType === 'member' ? 'bg-purple-500 hover:bg-purple-600' : 'border-slate-600 text-gray-300'}
                      onClick={() => {
                        setTransferType('member');
                        setSelectedTransferTarget(null);
                      }}
                    >
                      转给会员
                    </Button>
                  </div>
                </div>

                {/* 目标选择 */}
                <div className="space-y-2">
                  <label className="text-gray-400 text-sm">选择{transferType === 'provider' ? '服务商' : '会员'}</label>
                  <div className="max-h-48 overflow-y-auto border border-slate-700 rounded-lg">
                    {transferType === 'provider' ? (
                      providerData.providers.length === 0 ? (
                        <div className="p-4 text-center text-gray-500">暂无服务商</div>
                      ) : (
                        providerData.providers.map((p: any) => (
                          <div
                            key={p.id}
                            className={`p-3 cursor-pointer hover:bg-slate-700 ${selectedTransferTarget?.id === p.id ? 'bg-blue-500/20 border-l-2 border-blue-500' : 'border-l-2 border-transparent'}`}
                            onClick={() => setSelectedTransferTarget(p)}
                          >
                            <p className="text-white font-medium">{p.username}</p>
                            <p className="text-gray-400 text-sm">{p.phone || '无电话'}</p>
                          </div>
                        ))
                      )
                    ) : (
                      memberData.members.length === 0 ? (
                        <div className="p-4 text-center text-gray-500">暂无会员</div>
                      ) : (
                        memberData.members.map((m: any) => (
                          <div
                            key={m.id}
                            className={`p-3 cursor-pointer hover:bg-slate-700 ${selectedTransferTarget?.id === m.id ? 'bg-purple-500/20 border-l-2 border-purple-500' : 'border-l-2 border-transparent'}`}
                            onClick={() => setSelectedTransferTarget(m)}
                          >
                            <p className="text-white font-medium">{m.username}</p>
                            <p className="text-gray-400 text-sm">{m.phone || '无电话'}</p>
                          </div>
                        ))
                      )
                    )}
                  </div>
                </div>

                {/* 金额输入 */}
                <div className="space-y-2">
                  <label className="text-gray-400 text-sm">转账金额</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      placeholder="请输入转账金额"
                      value={transferAmount}
                      onChange={(e) => setTransferAmount(e.target.value)}
                      className="bg-slate-700 border-slate-600 text-white"
                    />
                    <Button
                      className="bg-green-500 hover:bg-green-600"
                      onClick={handleDirectTransfer}
                      disabled={!selectedTransferTarget || !transferAmount || parseFloat(transferAmount) <= 0}
                    >
                      确认转账
                    </Button>
                  </div>
                  <p className="text-gray-500 text-sm">
                    当前余额：{balanceValue.toLocaleString()} 收益
                  </p>
                </div>

                {/* 快捷金额 */}
                <div className="space-y-2">
                  <label className="text-gray-400 text-sm">快捷金额</label>
                  <div className="flex gap-2 flex-wrap">
                    {[100, 500, 1000, 2000, 5000].map((amount) => (
                      <Button
                        key={amount}
                        variant="outline"
                        size="sm"
                        className="border-slate-600 text-gray-300 hover:bg-slate-700"
                        onClick={() => setTransferAmount(String(amount))}
                      >
                        {amount >= 1000 ? `${amount/1000}千` : amount}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 提现记录 */}
          <TabsContent value="withdraw-records">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white">提现记录</CardTitle>
              </CardHeader>
              <CardContent>
                {withdrawLoading ? (
                  <div className="text-center text-gray-400 py-8">加载中...</div>
                ) : withdrawRequests.length === 0 ? (
                  <div className="text-center text-gray-400 py-8">暂无记录</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-700">
                        <TableHead className="text-gray-400">服务商</TableHead>
                        <TableHead className="text-gray-400">转账金额</TableHead>
                        <TableHead className="text-gray-400">状态</TableHead>
                        <TableHead className="text-gray-400">审核备注</TableHead>
                        <TableHead className="text-gray-400">时间</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {withdrawRequests.map((request, idx) => (
                        <TableRow key={`withdraw-table-${request.id}-${idx}`} className="border-slate-700">
                          <TableCell className="text-white">{request.requesterName}</TableCell>
                          <TableCell className="text-red-400">-{request.actualAmount.toLocaleString()}</TableCell>
                          <TableCell>{getStatusBadge(request.status)}</TableCell>
                          <TableCell className="text-gray-400">{request.reviewerNote || '-'}</TableCell>
                          <TableCell className="text-gray-400 text-sm">{formatDate(request.createdAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 服务网点收益变现 */}
          <TabsContent value="branch-withdraw">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-yellow-400" />
                    收益变现
                  </CardTitle>
                  <Button 
                    className="bg-green-500 hover:bg-green-600"
                    onClick={() => setShowWithdrawDialog(true)}
                  >
                    <ArrowUpRight className="w-4 h-4 mr-2" />
                    申请变现
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="p-4 rounded-lg bg-slate-700/50">
                    <p className="text-gray-400 text-sm">可用收益</p>
                    <p className="text-2xl font-bold text-yellow-400">{balanceValue.toLocaleString()}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-slate-700/50">
                    <p className="text-gray-400 text-sm">累计变现</p>
                    <p className="text-2xl font-bold text-white">
                      {branchWithdrawRequests.filter(r => r.status === 'approved').reduce((sum, r) => sum + (r.actualAmount || 0), 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-slate-700/50">
                    <p className="text-gray-400 text-sm">待审核</p>
                    <p className="text-2xl font-bold text-yellow-400">
                      {branchWithdrawRequests.filter(r => r.status === 'pending').length}
                    </p>
                  </div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="text-gray-400">变现金额</TableHead>
                      <TableHead className="text-gray-400">手续费</TableHead>
                      <TableHead className="text-gray-400">实际到账</TableHead>
                      <TableHead className="text-gray-400">状态</TableHead>
                      <TableHead className="text-gray-400">申请时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {branchWithdrawRequests.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-gray-400 py-8">暂无记录</TableCell>
                      </TableRow>
                    ) : (
                      branchWithdrawRequests.map((request, idx) => (
                        <TableRow key={`branch-withdraw-${request.id}-${idx}`} className="border-slate-700">
                          <TableCell className="text-white">{(request.amount || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-red-400">-{((request.fee) || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-green-400">{(request.actualAmount || 0).toLocaleString()}</TableCell>
                          <TableCell>{getStatusBadge(request.status)}</TableCell>
                          <TableCell className="text-gray-400 text-sm">{formatDate(request.createdAt)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          </Tabs>
        </TabsContent>
        </Tabs>
        </div>
      </main>

      {/* 审核弹窗 */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>审核提现申请</DialogTitle>
            <DialogDescription className="text-gray-400">
              审核 {selectedRequest?.requesterName} 的提现申请
            </DialogDescription>
          </DialogHeader>
          
          {selectedRequest && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-slate-700/50">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">转账金额</span>
                  <span className="text-green-400 font-bold">{(selectedRequest?.actualAmount || 0).toLocaleString()}</span>
                </div>
              </div>
              
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <p className="text-blue-400 text-sm">
                  <AlertCircle className="w-4 h-4 inline mr-1" />
                  审核通过后，请线下转账到服务商账户，确认转账后再点击&quot;确认转账&quot;
                </p>
              </div>

              <div>
                <label className="text-gray-400 text-sm">备注</label>
                <Input
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="可选填写审核备注"
                  className="bg-slate-700 border-slate-600 text-white mt-2"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setReviewAction('reject');
                handleReview();
              }}
              className="border-red-500/50 text-red-400 hover:bg-red-500/20"
            >
              <XCircle className="w-4 h-4 mr-2" />
              拒绝
            </Button>
            <Button 
              className="bg-green-500 hover:bg-green-600"
              onClick={() => {
                setReviewAction('approve');
                handleReview();
              }}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              审核通过
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 申请收益弹窗 */}
      <Dialog open={showApplyEnergyDialog} onOpenChange={setShowApplyEnergyDialog}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>向智算总台申请收益</DialogTitle>
            <DialogDescription className="text-gray-400">
              提交申请后等待智算总台审核，通过后收益将直接到账
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-gray-400 text-sm">当前收益余额</label>
              <p className="text-2xl font-bold text-yellow-400 mt-1">{balanceValue.toLocaleString()}</p>
            </div>

            <div>
              <label className="text-gray-400 text-sm">申请金额</label>
              <Input
                type="number"
                placeholder="最低100收益"
                value={applyEnergyAmount}
                onChange={(e) => setApplyEnergyAmount(e.target.value)}
                className="bg-slate-700 border-slate-600 text-white mt-1"
              />
              <p className="text-gray-500 text-xs mt-1">最低申请金额：100收益</p>
            </div>

            <div>
              <label className="text-gray-400 text-sm">备注说明（可选）</label>
              <Input
                placeholder="如：用于下级服务商充值"
                value={applyEnergyNote}
                onChange={(e) => setApplyEnergyNote(e.target.value)}
                className="bg-slate-700 border-slate-600 text-white mt-1"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApplyEnergyDialog(false)}>
              取消
            </Button>
            <Button className="bg-green-500 hover:bg-green-600" onClick={handleApplyEnergy}>
              提交申请
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 服务网点变现弹窗 */}
      <Dialog open={showWithdrawDialog} onOpenChange={setShowWithdrawDialog}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>收益变现</DialogTitle>
            <DialogDescription className="text-gray-400">
              将收益变现，等待智算总台转账
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-gray-400 text-sm">可用收益</label>
              <p className="text-2xl font-bold text-yellow-400 mt-1">{balanceValue.toLocaleString()}</p>
            </div>

            <div>
              <label className="text-gray-400 text-sm">变现金额</label>
              <Input
                type="number"
                placeholder="请输入变现金额"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                className="bg-slate-700 border-slate-600 text-white mt-2"
              />
              <p className="text-gray-500 text-xs mt-1">最低变现 100 收益</p>
            </div>

            <div>
              <label className="text-gray-400 text-sm">收款方式</label>
              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('alipay')}
                  className={`flex-1 p-3 rounded-lg border ${paymentMethod === 'alipay' ? 'bg-blue-500/20 border-blue-500 text-blue-400' : 'bg-slate-700 border-slate-600 text-gray-400'}`}
                >
                  <div className="text-2xl mb-1">💙</div>
                  <div className="text-sm">支付宝</div>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('wechat')}
                  className={`flex-1 p-3 rounded-lg border ${paymentMethod === 'wechat' ? 'bg-green-500/20 border-green-500 text-green-400' : 'bg-slate-700 border-slate-600 text-gray-400'}`}
                >
                  <div className="text-2xl mb-1">🟢</div>
                  <div className="text-sm">微信</div>
                </button>
              </div>
            </div>

            <div>
              <label className="text-gray-400 text-sm">
                {paymentMethod === 'alipay' ? '支付宝账号' : '微信收款码链接'}
              </label>
              <Input
                type="text"
                placeholder={paymentMethod === 'alipay' ? '请输入支付宝账号' : '请输入微信收款码图片链接'}
                value={paymentAccount}
                onChange={(e) => setPaymentAccount(e.target.value)}
                className="bg-slate-700 border-slate-600 text-white mt-2"
              />
            </div>

            {withdrawAmount && parseFloat(withdrawAmount) >= 100 && (
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">变现金额</span>
                  <span className="text-white">{parseFloat(withdrawAmount || '0').toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-gray-400">手续费(5%)</span>
                  <span className="text-red-400">-{(parseFloat(withdrawAmount || '0') * 0.05).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-gray-400">实际到账</span>
                  <span className="text-green-400 font-bold">{(parseFloat(withdrawAmount || '0') * 0.95).toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWithdrawDialog(false)} className="border-slate-600 text-gray-300">
              取消
            </Button>
            <Button className="bg-green-500 hover:bg-green-600" onClick={handleBranchWithdraw}>
              提交申请
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 额度分配弹窗 */}
      <Dialog open={showAllocationDialog} onOpenChange={setShowAllocationDialog}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>分配额度给服务商</DialogTitle>
            <DialogDescription className="text-gray-400">
              从可用额度中分配给服务商
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <label className="text-gray-400 text-sm">可用额度</label>
              <p className="text-2xl font-bold text-green-400 mt-1">{quotaStats.availableQuota.toLocaleString()}</p>
            </div>
            
            <div>
              <label className="text-gray-400 text-sm">选择服务商</label>
              <select
                className="w-full mt-2 p-2 rounded-lg bg-slate-700 border border-slate-600 text-white"
                value={selectedProvider?.id || ''}
                onChange={(e) => {
                  const provider = quotaAllocations.find(a => a.providerId === e.target.value);
                  setSelectedProvider(provider || null);
                }}
              >
                <option value="">请选择服务商</option>
                {quotaAllocations.map((a, idx) => (
                  <option key={`prov-opt-${a.providerId}-${idx}`} value={a.providerId}>
                    {a.providerName} (当前剩余: {(a.availableAmount || 0).toLocaleString()})
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="text-gray-400 text-sm">分配额度</label>
              <Input
                type="number"
                placeholder="请输入分配额度"
                value={allocationAmount}
                onChange={(e) => setAllocationAmount(e.target.value)}
                className="bg-slate-700 border-slate-600 text-white mt-2"
              />
              <p className="text-gray-500 text-xs mt-1">最低分配 1,000 额度</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAllocationDialog(false)} className="border-slate-600 text-gray-300">
              取消
            </Button>
            <Button className="bg-green-500 hover:bg-green-600" onClick={handleAllocation}>
              确认分配
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 收益充值审核弹窗 */}
      <Dialog open={showEnergyReviewDialog} onOpenChange={setShowEnergyReviewDialog}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>
              {energyReviewAction === 'approve' ? '通过充值申请' : '拒绝充值申请'}
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              {selectedEnergyRequest?.providerName} 的充值申请
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-slate-700/50">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">服务商</span>
                <span className="text-white font-medium">{selectedEnergyRequest?.providerName}</span>
              </div>
              <div className="flex justify-between text-sm mt-2">
                <span className="text-gray-400">充值金额</span>
                <span className="text-yellow-400 font-bold text-lg">
                  +{selectedEnergyRequest?.requestedAmount?.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-sm mt-2">
                <span className="text-gray-400">可用余额</span>
                <span className="text-white">{balanceValue.toLocaleString()}</span>
              </div>
            </div>

            {energyReviewAction === 'approve' && (
              <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                <p className="text-yellow-400 text-sm">
                  <AlertCircle className="w-4 h-4 inline mr-1" />
                  通过后将从您的收益余额中扣除 {selectedEnergyRequest?.requestedAmount?.toLocaleString()} 收益
                </p>
              </div>
            )}

            <div>
              <label className="text-gray-400 text-sm">备注</label>
              <Input
                value={energyReviewNote}
                onChange={(e) => setEnergyReviewNote(e.target.value)}
                placeholder="可选填写审核备注"
                className="bg-slate-700 border-slate-600 text-white mt-2"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEnergyReviewDialog(false)}
              className="border-slate-600 text-gray-300"
            >
              取消
            </Button>
            {energyReviewAction === 'reject' ? (
              <Button
                className="bg-red-500 hover:bg-red-600"
                onClick={handleEnergyReview}
              >
                <XCircle className="w-4 h-4 mr-2" />
                确认拒绝
              </Button>
            ) : (
              <Button
                className="bg-green-500 hover:bg-green-600"
                onClick={handleEnergyReview}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                确认通过
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
