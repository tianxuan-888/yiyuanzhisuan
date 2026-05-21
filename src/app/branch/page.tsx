'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Users, Zap, Package, Loader2, Send, Building2, 
  RefreshCw, Plus, Bell, ChevronDown, ChevronUp,
  Eye, DollarSign, ClipboardList, CheckCircle, XCircle, Database,
  FileCheck, ClipboardCheck, User, History, Banknote, Gift, TrendingUp,
  AlertCircle, Cpu, Share2, FileText, PlusCircle, ArrowRightLeft
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

// 用户数据接口（兼容 useAuth 返回类型）
interface UserData {
  id: string;
  username: string;
  role: string;
  phone: string | null;
  real_name: string | null;
  alipay_account: string | null;
  provider_id: string | null;
  inviter_id: string | null;
  energy_value: number;
  balance: number;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  branch_id?: string | null;
  unique_id?: string;
}

interface Provider {
  id: string;
  username: string;
  energy_value: number;
  balance: number;
  quota?: number;
  used_quota?: number;
  available_quota?: number;
  created_at: string;
}

interface Template {
  id: string;
  name: string;
  code: string;
  period: number;
  total_rate: number;
  market_rate: number;
  profit_rate: number;
  status?: string;
}

interface QuotaAllocation {
  id: string;
  provider_id: string;
  template_id: string;
  quota_amount: number;
  used_amount: number;
  status: string;
  created_at: string;
  provider?: { id: string; username: string };
  product_templates?: Template;
}

interface ProviderApplication {
  id: string;
  user_id: string;
  applicant_name: string;
  phone: string;
  user_phone?: string;
  username?: string;
  real_name?: string;
  alipay_account: string;
  apply_type: string;
  quota_request: number;
  quota_approved?: number;
  status: string;
  reject_reason?: string;
  parent_provider_name?: string;
  parent_provider_id?: string;
  created_at: string;
  users?: { id: string; username: string; real_name: string };
}

interface Stats {
  provider_count: number;
  member_count: number;
  total_member_energy: number;
  total_member_balance: number;
  pending_sell_count: number;
  pending_withdrawal_count: number;
  total_quota?: number;
  available_quota?: number;
  used_quota?: number;
}

interface QuotaRequest {
  id: string;
  requested_amount: number;
  approved_amount: number;
  bonus_rate: number;
  status: string;
  created_at: string;
}

export default function BranchPage() {
  const { user, loading: authLoading, logout } = useAuth('branch');
  
  // 统一的 API 请求方法（带认证）
  const authFetch = async (url: string, options: RequestInit = {}) => {
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(url, { ...options, headers, cache: 'no-store' });
    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('userId');
      localStorage.removeItem('userRole');
      localStorage.removeItem('userData');
      window.location.href = '/';
    }
    return response;
  };

  const [stats, setStats] = useState<Stats>({
    provider_count: 0,
    member_count: 0,
    total_member_energy: 0,
    total_member_balance: 0,
    pending_sell_count: 0,
    pending_withdrawal_count: 0,
  });
  const [providers, setProviders] = useState<Provider[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [allocations, setAllocations] = useState<QuotaAllocation[]>([]);
  const [applications, setApplications] = useState<ProviderApplication[]>([]);
  const [quotaRequests, setQuotaRequests] = useState<QuotaRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [quotaSubTab, setQuotaSubTab] = useState('overview');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  // 服务商额度申请审批相关
  const [providerQuotaRequests, setProviderQuotaRequests] = useState<any[]>([]);
  const [quotaApiResult, setQuotaApiResult] = useState<any>(null);
  const [energyTransactions, setEnergyTransactions] = useState<any[]>([]);
  
  // 收益互转相关状态
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [transferTargets, setTransferTargets] = useState<any[]>([]);
  const [transferMembers, setTransferMembers] = useState<any[]>([]);
  const [transferUserId, setTransferUserId] = useState("");
  const [transferTarget, setTransferTarget] = useState("");
  const [transferUserType, setTransferUserType] = useState<"provider" | "member" | "branch">("provider");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferNote, setTransferNote] = useState("");
  
  // 会员转移相关状态
  const [showMemberTransferDialog, setShowMemberTransferDialog] = useState(false);
  const [transferMemberId, setTransferMemberId] = useState("");
  const [transferMemberInfo, setTransferMemberInfo] = useState<any>(null);
  const [transferTargetProvider, setTransferTargetProvider] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);

  // 收款信息和修改密码相关状态
  const [profileAlipayAccount, setProfileAlipayAccount] = useState("");
  const [profileWechatAccount, setProfileWechatAccount] = useState("");
  const [profileBankName, setProfileBankName] = useState("");
  const [profileBankAccount, setProfileBankAccount] = useState("");
  const [profileBankHolder, setProfileBankHolder] = useState("");
  const [savingPaymentInfo, setSavingPaymentInfo] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [transferPreview, setTransferPreview] = useState<any>(null);
  
  // 编辑资料状态
  const [editUsername, setEditUsername] = useState("");
  const [editRealName, setEditRealName] = useState("");
  const [editAlipayAccount, setEditAlipayAccount] = useState("");
  
  // 分公司收益余额
  const [branchEnergyBalance, setBranchEnergyBalance] = useState(0);
  
  // 分公司申请收益
  const [branchApplyAmount, setBranchApplyAmount] = useState("");
  
  // 分公司列表（同级互转）
  const [branchList, setBranchList] = useState<Array<{id: string; username: string; role: string}>>([]);
  
  // 分公司变现申请
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawRequests, setWithdrawRequests] = useState<any[]>([]);

  // 提现审核
  const [pendingWithdrawals, setPendingWithdrawals] = useState<any[]>([]);
  const [branchWithdrawRecords, setBranchWithdrawRecords] = useState<any[]>([]);
  const [branchRevenueRecords, setBranchRevenueRecords] = useState<any[]>([]);
  const [branchRevenueStats, setBranchRevenueStats] = useState<any>({});
  const [branchWithdrawAmount, setBranchWithdrawAmount] = useState("");
  const [branchWithdrawAlipay, setBranchWithdrawAlipay] = useState("");
  const [branchWithdrawRealName, setBranchWithdrawRealName] = useState("");
  const [showBranchWithdrawDialog, setShowBranchWithdrawDialog] = useState(false);

  // 收益转收益
  const [showConvertToEnergyDialog, setShowConvertToEnergyDialog] = useState(false);
  const [convertToEnergyAmount, setConvertToEnergyAmount] = useState("");

  // 分公司收益流转记录
  const [energyRecords, setEnergyRecords] = useState<any[]>([]);
  const [energyFilterType, setEnergyFilterType] = useState<string>('all');
  const [energyStats, setEnergyStats] = useState({
    totalIn: 0,
    totalOut: 0,
    rechargeCount: 0,
    transferInCount: 0,
    transferOutCount: 0,
  });

  // 会员管理
  const [memberList, setMemberList] = useState<any[]>([]);
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberFilterProvider, setMemberFilterProvider] = useState<string>('all');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberPage, setMemberPage] = useState(1);
  const [memberTotalPages, setMemberTotalPages] = useState(1);
  const [memberTotal, setMemberTotal] = useState(0);

  // 加载收益流转记录
  const loadEnergyRecords = async (filterType: string = 'all') => {
    const branchId = localStorage.getItem('userId');
    if (!branchId) return;

    try {
      const response = await authFetch(`/api/branch/energy-records?branchId=${branchId}&type=${filterType}`);
      const data = await response.json();
      if (data.success) {
        setEnergyRecords(data.data.records || []);
        setEnergyStats(data.data.stats || energyStats);
      }
    } catch (error) {
      console.error('加载收益记录失败:', error);
    }
  };

  // 收益申请审批相关状态
  const [energyRequests, setEnergyRequests] = useState<any[]>([]);
  
  // 收益管理子Tab
  const [energySubTab, setEnergySubTab] = useState<string>('records'); // records, review, transfer
  
  // 分公司向总公司申请收益相关状态
  const [myEnergyRequests, setMyEnergyRequests] = useState<any[]>([]);
  const [myEnergyApplyPendingCount, setMyEnergyApplyPendingCount] = useState(0);
  
  // 服务商向本分公司申请收益相关状态
  const [providerEnergyRequests, setProviderEnergyRequests] = useState<any[]>([]);
  
  // 分配额度表单
  const [showAllocateDialog, setShowAllocateDialog] = useState(false);
  const [showQuotaApplyDialog, setShowQuotaApplyDialog] = useState(false);
  const [showEnergyApplyDialog, setShowEnergyApplyDialog] = useState(false);
  const [energyApplyAmount, setEnergyApplyAmount] = useState('');
  const [energyApplyNote, setEnergyApplyNote] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [quotaAmount, setQuotaAmount] = useState<string>('50000');
  const [applyQuotaAmount, setApplyQuotaAmount] = useState<string>('');

  // 打开分配额度对话框时刷新服务商列表
  const openAllocateDialog = async () => {
    const branchId = localStorage.getItem('userId');
    if (!branchId) return;
    
    // 重新获取服务商列表
    try {
      const res = await authFetch(`/api/branch/providers?branchId=${branchId}`);
      const data = await res.json();
      if (data.success && data.data?.providers) {
        setProviders(data.data.providers);
      }
    } catch (e) {
      console.error('获取服务商列表失败:', e);
    }
    setShowAllocateDialog(true);
  };

  const loadData = useCallback(async () => {
    const branchId = localStorage.getItem('userId');
    const username = localStorage.getItem('username');
    console.log('[loadData] START - branchId:', branchId, 'username:', username);
    if (!branchId) {
      console.log('loadData: branchId is null');
      return;
    }

    const token = localStorage.getItem('token');
    console.log('loadData token:', token ? 'exists' : 'null');
    console.log('loadData branchId:', branchId);

    // 辅助函数：解析 Promise.allSettled 的结果
    const extractResult = async (result: PromiseSettledResult<Response>): Promise<any> => {
      if (result.status === 'fulfilled') {
        try {
          return await result.value.json();
        } catch {
          return { success: false, error: 'JSON parse failed' };
        }
      } else {
        console.error('API rejected:', result.reason);
        return { success: false, error: 'Request failed' };
      }
    };

    try {
      console.log('[loadData] 开始发送API请求...');
      const results = await Promise.allSettled([
        fetch(`/api/branch/overview?branchId=${branchId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`/api/admin/branch-templates?branchId=${branchId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`/api/quota-allocations?branchId=${branchId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`/api/branch/approve-provider?branchId=${branchId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`/api/quota?userId=${branchId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`/api/quota-requests?requesterId=${branchId}&requesterType=branch`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`/api/branch/approve-quota?branchId=${branchId}&status=pending`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`/api/energy/branch-stats?branchId=${branchId}&username=${username || ''}`, { headers: { 'Authorization': `Bearer ${token}` } }),
      ]);
      console.log('[loadData] 所有API请求完成');
      
      // 调试：显示每个请求的状态
      const requestNames = ['branch/overview', 'admin/branch-templates', 'quota-allocations', 'provider-applications', 'quota', 'quota-requests', 'branch/approve-quota', 'energy/branch-stats'];
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(`[loadData] 请求 ${requestNames[index]} 失败:`, result.reason);
        } else if (!result.value.ok) {
          console.error(`[loadData] 请求 ${requestNames[index]} HTTP错误:`, result.value.status);
        } else {
          console.log(`[loadData] 请求 ${requestNames[index]} HTTP状态:`, result.value.status);
        }
      });
      
      const [overviewData, branchTemplatesData, allocationsData, applicationsData, quotaData, myQuotaRequestsData, providerQuotaRequestsData, energyStatsData] = await Promise.all(results.map(extractResult));

      console.log('[loadData] overviewData:', JSON.stringify(overviewData).substring(0, 500));

      // 更新分公司收益余额
      if (energyStatsData.success && energyStatsData.data?.branch) {
        console.log('[loadData] energyStatsData SUCCESS - branch balance:', energyStatsData.data.branch.balance);
        setBranchEnergyBalance(energyStatsData.data.branch.balance || 0);
      } else {
        console.log('[loadData] energyStatsData result:', energyStatsData);
      }

      if (overviewData.success) {
        setStats(prev => ({
          ...prev,
          ...overviewData.data.stats,
        }));
        setProviders(overviewData.data.providers || []);
      }

      // 从分配记录中提取模板信息
      if (branchTemplatesData.success) {
        const allocations = branchTemplatesData.data?.allocations || [];
        // 将分配记录转换为模板格式
        const templatesFromAllocations = allocations.map((alloc: any) => ({
          id: alloc.template_id,
          name: alloc.template_name,
          code: alloc.template_code,
          period: alloc.period,
          total_rate: alloc.total_rate,
          market_rate: alloc.market_rate,
          profit_rate: alloc.profit_rate,
          quota_amount: alloc.quota_amount,
          used_amount: alloc.used_amount,
          available_amount: alloc.quota_amount - alloc.used_amount,
        }));
        setTemplates(templatesFromAllocations);
      }

      if (allocationsData.success) {
        // 兼容两种格式：数组或 { records: [], stats: {} }
        const records = Array.isArray(allocationsData.data) 
          ? allocationsData.data 
          : (allocationsData.data?.records || []);
        setAllocations(records);
        // 如果有 stats 信息，也更新额度统计
        if (allocationsData.data?.stats) {
          setStats(prev => ({
            ...prev,
            total_quota: allocationsData.data.stats.totalQuota || 0,
            available_quota: allocationsData.data.stats.availableQuota || 0,
            used_quota: allocationsData.data.stats.usedQuota || 0,
          }));
        }
      }

      if (applicationsData.success) {
        setApplications(applicationsData.data || []);
      }

      if (providerQuotaRequestsData.success) {
        setProviderQuotaRequests(providerQuotaRequestsData.data || []);
      }

      console.log('[loadData] quotaData result:', JSON.stringify(quotaData));
      setQuotaApiResult(quotaData); // 保存用于调试
      if (quotaData.success && quotaData.data) {
        console.log('[loadData] 更新额度: total_quota=', quotaData.data.total_quota, 'available_quota=', quotaData.data.available_quota);
        setStats(prev => ({
          ...prev,
          total_quota: quotaData.data?.total_quota || 0,
          available_quota: quotaData.data?.available_quota || 0,
          used_quota: quotaData.data?.used_quota || 0,
        }));
      } else {
        console.error('[loadData] quotaData FAILED:', quotaData);
      }

      if (myQuotaRequestsData.success) {
        setQuotaRequests(myQuotaRequestsData.data || []);
      }
    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    console.log('[useEffect] authLoading:', authLoading, 'user:', user ? user.name : null);
    if (!authLoading && user) {
      console.log('[useEffect] 触发 loadData');
      loadData();
    }
  }, [authLoading, user, loadData]);

  // 调试状态
  const [showDebug, setShowDebug] = useState(false);
  const [debugInfo, setDebugInfo] = useState({
    localStorage: { userId: '', username: '', role: '' },
    apiData: null as any,
    error: ''
  });

  // 初始化编辑资料状态
  useEffect(() => {
    if (user) {
      setEditUsername(user.username || '');
      setEditRealName(user.real_name || '');
      setEditAlipayAccount(user.alipay_account || '');
    }
  }, [user]);

  useEffect(() => {
    setDebugInfo({
      localStorage: {
        userId: localStorage.getItem('userId') || '',
        username: localStorage.getItem('userName') || '',
        role: localStorage.getItem('userRole') || ''
      },
      apiData: { stats, providers, templates },
      error: ''
    });
  }, [stats, providers, templates]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  // 分配额度给服务商
  const handleAllocateQuota = async () => {
    if (!selectedProvider || !quotaAmount) {
      showMessage('error', '请选择服务商并输入额度');
      return;
    }

    const branchId = localStorage.getItem('userId');
    if (!branchId) return;

    setSubmitting(true);
    try {
      const response = await authFetch('/api/quota-allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          providerId: selectedProvider,
          quotaAmount: parseFloat(quotaAmount),
        }),
      });

      const data = await response.json();

      if (data.success) {
        showMessage('success', data.message || '额度分配成功');
        setShowAllocateDialog(false);
        setSelectedProvider('');
        setQuotaAmount('50000');
        loadData();
      } else {
        showMessage('error', data.error || '分配失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 审核服务商申请
  const handleReviewApplication = async (applicationId: string, action: 'approve' | 'reject', quotaAllocated?: number) => {
    const branchId = localStorage.getItem('userId');
    if (!branchId) return;

    setSubmitting(true);
    try {
      const response = await authFetch('/api/branch/approve-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicationId,
          reviewerId: branchId,
          action,
        }),
      });

      const data = await response.json();

      if (data.success) {
        showMessage('success', data.message || '审核完成');
        loadData();
      } else {
        showMessage('error', data.error || '审核失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 申请额度
  const handleApplyQuota = async () => {
    const branchId = localStorage.getItem('userId');
    if (!branchId) return;

    if (!applyQuotaAmount || parseFloat(applyQuotaAmount) < 10000) {
      showMessage('error', '申请额度不能少于10,000元');
      return;
    }

    setSubmitting(true);
    try {
      // 总公司管理员ID
      const ADMIN_ID = '00000000-0000-0000-0000-000000000001';

      const response = await authFetch('/api/quota-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requesterId: branchId,
          requesterType: 'branch',
          parentId: ADMIN_ID,
          requestedAmount: parseFloat(applyQuotaAmount),
        }),
      });

      const data = await response.json();

      if (data.success) {
        showMessage('success', data.message || '额度申请已提交，请等待总公司审核');
        setShowQuotaApplyDialog(false);
        setApplyQuotaAmount('');
        loadData();
      } else {
        showMessage('error', data.error || '申请失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 审批服务商额度申请
  const handleApproveProviderQuota = async (requestId: string, action: 'approve' | 'reject', approvedAmount?: number) => {
    const branchId = localStorage.getItem('userId');
    if (!branchId) return;

    setSubmitting(true);
    try {
      const response = await authFetch('/api/branch/approve-quota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: requestId,
          reviewer_id: branchId,
          action,
          approved_amount: action === 'approve' ? approvedAmount : undefined,
        }),
      });

      const data = await response.json();

      if (data.success) {
        showMessage('success', data.message || '审核完成');
        loadProviderQuotaRequests();
        loadData();
      } else {
        showMessage('error', data.error || '审核失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 加载会员列表
  const loadMemberList = async (page: number = 1, overrideProviderId?: string) => {
    const branchId = localStorage.getItem('userId');
    if (!branchId) return;

    const currentProviderId = overrideProviderId !== undefined ? overrideProviderId : memberFilterProvider;
    setMemberLoading(true);
    try {
      let url = `/api/branch/members?branchId=${branchId}&page=${page}&pageSize=20`;
      if (currentProviderId !== 'all') {
        url += `&providerId=${currentProviderId}`;
      }
      const response = await authFetch(url);
      const data = await response.json();
      if (data.success) {
        setMemberList(data.data.members || []);
        setMemberTotal(data.data.stats?.totalMembers || 0);
        setMemberTotalPages(data.data.pagination?.totalPages || 1);
        setMemberPage(page);
      }
    } catch (error) {
      console.error('加载会员列表失败:', error);
    } finally {
      setMemberLoading(false);
    }
  };

  // 打开会员转移Dialog
  const openMemberTransfer = (member: any) => {
    setTransferMemberId(member.id);
    setTransferMemberInfo(member);
    setTransferTargetProvider('');
    setTransferPreview(null);
    setShowMemberTransferDialog(true);
  };

  // 预览会员转移（获取直推树和持有产品检查）
  const previewMemberTransfer = async () => {
    if (!transferMemberId || !transferTargetProvider) return;
    setTransferLoading(true);
    try {
      const branchId = localStorage.getItem('userId');
      const response = await authFetch('/api/branch/transfer-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          memberId: transferMemberId,
          targetProviderId: transferTargetProvider,
          operatorId: branchId,
          preview: true
        })
      });
      const data = await response.json();
      if (data.success) {
        setTransferPreview(data.data);
      } else {
        setTransferPreview({ error: data.message });
      }
    } catch (error) {
      console.error('预览转移失败:', error);
      setTransferPreview({ error: '预览失败' });
    } finally {
      setTransferLoading(false);
    }
  };

  // 确认执行会员转移
  const confirmMemberTransfer = async () => {
    if (!transferMemberId || !transferTargetProvider) return;
    setTransferLoading(true);
    try {
      const branchId = localStorage.getItem('userId');
      const response = await authFetch('/api/branch/transfer-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          memberId: transferMemberId,
          targetProviderId: transferTargetProvider,
          operatorId: branchId
        })
      });
      const data = await response.json();
      if (data.success) {
        showMessage('success', data.message);
        setShowMemberTransferDialog(false);
        setTransferPreview(null);
        loadMemberList(1);
      } else {
        showMessage('error', data.message);
      }
    } catch (error) {
      console.error('转移失败:', error);
      showMessage('error', '转移失败');
    } finally {
      setTransferLoading(false);
    }
  };

  // 保存用户名
  const handleSaveUsername = async () => {
    try {
      const userId = localStorage.getItem('userId');
      const response = await authFetch('/api/user/username', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, username: editUsername })
      });
      const data = await response.json();
      if (data.success) {
        showMessage('success', '用户名修改成功');
        const stored = localStorage.getItem('userData');
        if (stored) {
          const parsed = JSON.parse(stored);
          parsed.username = editUsername;
          localStorage.setItem('userData', JSON.stringify(parsed));
        }
        localStorage.setItem('userName', editUsername);
      } else {
        showMessage('error', data.error || '修改失败');
      }
    } catch (error) {
      showMessage('error', '修改失败');
    }
  };

  // 保存真实姓名
  const handleSaveProfile = async () => {
    try {
      const userId = localStorage.getItem('userId');
      const response = await authFetch('/api/user/username', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, realName: editRealName })
      });
      const data = await response.json();
      if (data.success) {
        showMessage('success', '姓名修改成功');
        const stored = localStorage.getItem('userData');
        if (stored) {
          const parsed = JSON.parse(stored);
          parsed.real_name = editRealName;
          localStorage.setItem('userData', JSON.stringify(parsed));
        }
      } else {
        showMessage('error', data.message || '修改失败');
      }
    } catch (error) {
      showMessage('error', '修改失败');
    }
  };

  // 保存收款信息
  const handleSavePayment = async () => {
    try {
      const userId = localStorage.getItem('userId');
      const response = await authFetch('/api/member/payment-info', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, alipayAccount: editAlipayAccount })
      });
      const data = await response.json();
      if (data.success) {
        showMessage('success', '收款信息保存成功');
        const stored = localStorage.getItem('userData');
        if (stored) {
          const parsed = JSON.parse(stored);
          parsed.alipay_account = editAlipayAccount;
          localStorage.setItem('userData', JSON.stringify(parsed));
        }
      } else {
        showMessage('error', data.message || '保存失败');
      }
    } catch (error) {
      showMessage('error', '保存失败');
    }
  };

  // 修改密码
  const handlePasswordChange = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      showMessage('error', '请填写完整密码信息');
      return;
    }
    if (newPassword !== confirmPassword) {
      showMessage('error', '两次输入的新密码不一致');
      return;
    }
    if (newPassword.length < 6) {
      showMessage('error', '新密码至少6个字符');
      return;
    }
    try {
      const userId = localStorage.getItem('userId');
      const response = await authFetch('/api/user/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, oldPassword, newPassword })
      });
      const data = await response.json();
      if (data.success) {
        showMessage('success', '密码修改成功，请重新登录');
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        showMessage('error', data.message || '修改失败');
      }
    } catch (error) {
      showMessage('error', '修改失败');
    }
  };

  // 加载服务商额度申请记录
  const [quotaFilterStatus, setQuotaFilterStatus] = useState<string>('pending');
  const loadProviderQuotaRequests = async () => {
    const branchId = localStorage.getItem('userId');
    if (!branchId) return;

    try {
      const statusParam = quotaFilterStatus === 'all' ? '' : `&status=${quotaFilterStatus}`;
      const response = await authFetch(`/api/branch/approve-quota?branchId=${branchId}${statusParam}&showAll=true`);
      const data = await response.json();
      if (data.success) {
        setProviderQuotaRequests(data.data || []);
      }
    } catch (error) {
      console.error('加载服务商额度申请失败:', error);
    }
  };

  // 分公司向总公司申请收益
  const handleBranchApplyEnergy = async () => {
    const amount = parseFloat(branchApplyAmount);
    if (!amount || amount <= 0) {
      showMessage('error', '请输入有效金额');
      return;
    }

    if (amount < 50) {
      showMessage('error', '申请金额最低为50收益');
      return;
    }

    try {
      setSubmitting(true);
      const branchId = localStorage.getItem('userId');
      if (!branchId) return;

      const response = await authFetch('/api/energy/branch-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId: branchId,
          amount: amount,
          note: '分公司申请收益'
        })
      });

      const data = await response.json();
      if (data.success) {
        showMessage('success', '申请已提交，等待总公司审核');
        setBranchApplyAmount('');
        loadEnergyRequests(); // 刷新申请记录
      } else {
        showMessage('error', data.error || '申请失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 分公司申请变现收益
  const handleBranchWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount <= 0) {
      showMessage('error', '请输入有效金额');
      return;
    }

    if (amount < 50) {
      showMessage('error', '最低变现金额为50收益');
      return;
    }

    if (amount > branchEnergyBalance) {
      showMessage('error', '收益余额不足');
      return;
    }

    try {
      setSubmitting(true);
      const branchId = localStorage.getItem('userId');
      if (!branchId) return;

      const response = await authFetch('/api/energy/withdraw-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amount,
          note: '分公司申请变现'
        })
      });

      const data = await response.json();
      if (data.success) {
        showMessage('success', data.message);
        setWithdrawAmount('');
        setShowWithdrawDialog(false);
        loadWithdrawRequests();
        // 刷新余额
        loadEnergyBalance();
      } else {
        showMessage('error', data.error || '变现申请失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 加载变现申请记录
  const loadWithdrawRequests = async () => {
    try {
      const response = await authFetch('/api/energy/withdraw-request?role=branch');
      const data = await response.json();
      if (data.success) {
        setWithdrawRequests(data.data || []);
      }
    } catch (error) {
      console.error('加载变现申请记录失败:', error);
    }
  };

  // 加载待审核提现列表
  const loadPendingWithdrawals = async () => {
    const branchId = localStorage.getItem('userId');
    if (!branchId) return;
    try {
      const response = await authFetch(`/api/branch/withdraw-review?branchId=${branchId}`);
      const data = await response.json();
      if (data.success) {
        setPendingWithdrawals(data.data || []);
      }
    } catch (error) {
      console.error('加载待审核提现失败:', error);
    }
  };

  // 审核提现操作
  const handleReviewWithdrawal = async (withdrawalId: string, action: string, rejectReason?: string) => {
    try {
      setSubmitting(true);
      const response = await authFetch('/api/branch/withdraw-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withdrawalId, action, rejectReason }),
      });
      const data = await response.json();
      if (data.success) {
        showMessage('success', data.message || '操作成功');
        loadPendingWithdrawals();
        loadBranchRevenueRecords();
      } else {
        showMessage('error', data.error || '操作失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 加载分公司收益记录
  const loadBranchRevenueRecords = async () => {
    const branchId = localStorage.getItem('userId');
    if (!branchId) return;
    try {
      const response = await authFetch(`/api/branch/revenue-records?branchId=${branchId}`);
      const data = await response.json();
      if (data.success) {
        setBranchRevenueRecords(data.data?.records || []);
        const s = data.data?.stats || {};
        setBranchRevenueStats({
          totalRevenue: s.total_revenue || 0,
          memberWithdraw: s.total_member_withdraw || 0,
          providerWithdraw: s.total_provider_withdraw || 0,
          marketFeeShare: s.total_market_fee_share || 0,
          providerUpstream: s.total_provider_upstream || 0,
        });
      }
    } catch (error) {
      console.error('加载收益记录失败:', error);
    }
  };

  // 分公司提现到总公司
  const handleBranchWithdrawToCompany = async () => {
    const amount = parseFloat(branchWithdrawAmount);
    if (!amount || amount < 100) {
      showMessage('error', '最低提现金额为100元');
      return;
    }
    if (!branchWithdrawAlipay.trim()) {
      showMessage('error', '请输入支付宝账号');
      return;
    }
    if (!branchWithdrawRealName.trim()) {
      showMessage('error', '请输入支付宝姓名');
      return;
    }
    try {
      setSubmitting(true);
      const response = await authFetch('/api/branch/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: branchWithdrawAmount,
          alipayAccount: branchWithdrawAlipay.trim(),
          realName: branchWithdrawRealName.trim(),
        }),
      });
      const data = await response.json();
      if (data.success) {
        showMessage('success', `提现申请已提交！手续费${data.data?.fee || 0}元，实际到账${data.data?.actualAmount || 0}元，等待总公司审核`);
        setShowBranchWithdrawDialog(false);
        setBranchWithdrawAmount('');
        setBranchWithdrawAlipay('');
        setBranchWithdrawRealName('');
        loadBranchRevenueRecords();
      } else {
        showMessage('error', data.error || '提现失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 收益转收益
  const handleConvertToEnergy = async () => {
    const amount = parseFloat(convertToEnergyAmount);
    if (!amount || amount < 10) {
      showMessage('error', '最低转换金额为10元');
      return;
    }
    try {
      setSubmitting(true);
      const response = await authFetch('/api/branch/convert-to-energy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: convertToEnergyAmount }),
      });
      const data = await response.json();
      if (data.success) {
        showMessage('success', data.message || `转换成功：${data.data?.energyAdded}元→收益，${data.data?.pointsAdded}元→积分`);
        setShowConvertToEnergyDialog(false);
        setConvertToEnergyAmount('');
        // 更新本地用户数据
        const userDataStr = localStorage.getItem('userData');
        if (userDataStr && data.data) {
          const userData = JSON.parse(userDataStr);
          userData.balance = data.data.balance;
          userData.energy_value = data.data.energyValue;
          localStorage.setItem('userData', JSON.stringify(userData));
        }
        loadBranchRevenueRecords();
      } else {
        showMessage('error', data.error || '转换失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 加载分公司提现记录
  const loadBranchWithdrawRecords = async () => {
    const branchId = localStorage.getItem('userId');
    if (!branchId) return;
    try {
      const response = await authFetch(`/api/branch/withdraw?userId=${branchId}`);
      const data = await response.json();
      if (data.success) {
        setBranchWithdrawRecords(data.data || []);
      }
    } catch (error) {
      console.error('加载提现记录失败:', error);
    }
  };

  // 加载收益余额
  const loadEnergyBalance = async () => {
    const branchId = localStorage.getItem('userId');
    if (!branchId) return;

    try {
      const response = await authFetch(`/api/energy/account?userId=${branchId}`);
      const data = await response.json();
      if (data.success) {
        setBranchEnergyBalance(data.data?.balance || 0);
      }
    } catch (error) {
      console.error('加载收益余额失败:', error);
    }
  };

  // 加载转账对象列表
  const loadTransferTargets = async () => {
    const branchId = localStorage.getItem('userId');
    if (!branchId) return;

    try {
      const response = await authFetch(`/api/energy/transfer-targets?userId=${branchId}`);
      const data = await response.json();
      if (data.success) {
        // 确保数据是数组，避免渲染时报错
        const providers = Array.isArray(data.data?.transfer_targets?.providers) 
          ? data.data.transfer_targets.providers 
          : [];
        const members = Array.isArray(data.data?.transfer_targets?.members) 
          ? data.data.transfer_targets.members 
          : [];
        setTransferTargets(providers);
        setTransferMembers(members);
      } else {
        console.error('加载转账对象失败:', data.error);
        setTransferTargets([]);
        setTransferMembers([]);
      }
    } catch (error) {
      console.error('加载转账对象列表失败:', error);
      setTransferTargets([]);
      setTransferMembers([]);
    }
  };

  // 加载同级分公司列表
  const loadBranchList = async () => {
    try {
      const response = await authFetch('/api/admin/branch-management');
      const data = await response.json();
      if (data.success) {
        const branches = Array.isArray(data.data?.branches) 
          ? data.data.branches.filter((b: any) => b.id !== localStorage.getItem('userId')) // 排除自己
          : [];
        setBranchList(branches);
      } else {
        setBranchList([]);
      }
    } catch (error) {
      console.error('加载分公司列表失败:', error);
      setBranchList([]);
    }
  };

  // 处理收益转账
  const handleTransferEnergy = async () => {
    const branchId = localStorage.getItem('userId');
    if (!branchId || !transferUserId || !transferAmount) {
      showMessage('error', '请填写完整信息');
      return;
    }

    const amount = parseFloat(transferAmount);
    if (amount < 50) {
      showMessage('error', '转账金额不能少于50');
      return;
    }

    setSubmitting(true);
    try {
      const response = await authFetch('/api/energy/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_user_id: branchId,
          to_user_id: transferUserId,
          amount,
          note: transferNote,
        }),
      });

      const data = await response.json();
      if (data.success) {
        showMessage('success', data.message);
        setShowTransferDialog(false);
        setTransferUserId('');
        setTransferAmount('');
        setTransferNote('');
        loadData();
      } else {
        showMessage('error', data.error || '转账失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 向总公司申请收益
  const handleApplyEnergy = async () => {
    const branchId = localStorage.getItem('userId');
    if (!branchId || !energyApplyAmount) {
      showMessage('error', '请填写申请金额');
      return;
    }

    const amount = parseFloat(energyApplyAmount);
    if (amount <= 0) {
      showMessage('error', '申请金额必须大于0');
      return;
    }

    setSubmitting(true);
    try {
      const response = await authFetch('/api/energy/grant-to-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          amount,
          note: energyApplyNote,
        }),
      });

      const data = await response.json();
      if (data.success) {
        showMessage('success', data.message);
        setShowEnergyApplyDialog(false);
        setEnergyApplyAmount('');
        setEnergyApplyNote('');
        loadData();
      } else {
        showMessage('error', data.error || '申请失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 加载收益申请记录
  const loadEnergyRequests = async () => {
    const branchId = localStorage.getItem('userId');
    if (!branchId) return;

    try {
      const response = await authFetch(`/api/branch/approve-energy-request?branchId=${branchId}&status=pending`);
      const data = await response.json();
      if (data.success) {
        setEnergyRequests(data.data || []);
      }
    } catch (error) {
      console.error('加载收益申请失败:', error);
    }
  };

  // 加载服务商向本分公司申请收益的记录
  const loadProviderEnergyRequests = async () => {
    const branchId = localStorage.getItem('userId');
    if (!branchId) return;

    try {
      const response = await authFetch(`/api/branch/provider-energy-requests?branchId=${branchId}`);
      const data = await response.json();
      if (data.success) {
        setProviderEnergyRequests(data.data?.requests || []);
      }
    } catch (error) {
      console.error('加载服务商收益申请失败:', error);
    }
  };

  // 加载分公司向总公司申请收益的记录
  const loadMyEnergyRequests = async () => {
    const branchId = localStorage.getItem('userId');
    if (!branchId) return;

    try {
      const response = await authFetch(`/api/energy/branch-request?branchId=${branchId}`);
      const data = await response.json();
      if (data.success && data.data) {
        setMyEnergyRequests(data.data.records || []);
        setMyEnergyApplyPendingCount(data.data.stats?.pending?.count || 0);
      }
    } catch (error) {
      console.error('加载收益申请记录失败:', error);
    }
  };

  // 审核收益申请
  const handleApproveEnergyRequest = async (requestId: string, action: 'approve' | 'reject', note?: string) => {
    const branchId = localStorage.getItem('userId');
    if (!branchId) return;

    setSubmitting(true);
    try {
      const response = await authFetch('/api/branch/approve-energy-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          branchId,
          action,
          note,
        }),
      });

      const data = await response.json();
      if (data.success) {
        showMessage('success', data.message);
        loadEnergyRequests();
        loadData();
      } else {
        showMessage('error', data.error || '操作失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 审核服务商收益申请
  const handleApproveProviderEnergyRequestRequest = async (requestId: string, action: 'approve' | 'reject', note?: string) => {
    const branchId = localStorage.getItem('userId');
    if (!branchId) return;

    // 查找该申请的金额
    const request = providerEnergyRequests.find(r => r.id === requestId);
    if (!request) {
      showMessage('error', '申请不存在');
      return;
    }

    const requestedAmount = parseFloat(String(request.amount || request.requestedAmount || 0));

    // 通过申请时检查余额
    if (action === 'approve' && requestedAmount > branchEnergyBalance) {
      showMessage('error', `余额不足，当前余额 ${branchEnergyBalance.toLocaleString()}，申请金额 ${requestedAmount.toLocaleString()}`);
      return;
    }

    setSubmitting(true);
    try {
      const response = await authFetch('/api/branch/approve-provider-energy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          action,
          note,
        }),
      });

      const data = await response.json();
      if (data.success) {
        showMessage('success', data.message);
        loadProviderEnergyRequests();
        loadData();
        // 更新本地余额
        if (action === 'approve') {
          setBranchEnergyBalance(prev => prev - requestedAmount);
        }
      } else {
        showMessage('error', data.error || '操作失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 分公司收益转账
  const handleTransfer = async (targetUserId: string, amount: number) => {
    if (!amount || amount <= 0) {
      showMessage('error', '请输入有效金额');
      return;
    }

    try {
      setSubmitting(true);
      const branchId = localStorage.getItem('userId');
      if (!branchId) return;

      const response = await fetch('/api/energy/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromUserId: branchId,
          toUserId: targetUserId,
          amount: amount,
          note: '分公司收益转账'
        })
      });

      const data = await response.json();
      if (data.success) {
        showMessage('success', '转账成功');
        setTransferAmount('');
        setTransferTarget('');
        fetchEnergyRecords();
      } else {
        showMessage('error', data.message || '转账失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 获取收益记录
  const fetchEnergyRecords = async () => {
    try {
      const userId = localStorage.getItem('userId');
      if (!userId) return;

      const response = await fetch(`/api/energy/transactions?userId=${userId}`);
      const data = await response.json();

      if (data.success) {
        setEnergyTransactions(data.data?.records || []);
      }
    } catch (error) {
      console.error('获取收益记录失败:', error);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-16 h-16 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-200">
      {/* 消息提示 */}
      {message && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-lg ${
          message.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        } text-white shadow-lg`}>
          {message.text}
        </div>
      )}

      {/* 分配额度对话框 */}
      {showAllocateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle>分配额度给服务商</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 说明 */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
                <p className="font-medium mb-1">操作说明</p>
                <p>选择服务商并输入分配的额度金额，服务商获得额度后可直接选择总公司设定的产品模板生成算力产品。</p>
              </div>
              {/* 分公司额度信息 */}
              <div className="bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="w-4 h-4 text-violet-600" />
                  <span className="text-sm font-medium text-violet-800">我的算力额度</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-bold text-violet-700">{(stats.total_quota || 0).toLocaleString()}</p>
                    <p className="text-xs text-violet-500">总额度</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-green-600">{(stats.available_quota || 0).toLocaleString()}</p>
                    <p className="text-xs text-violet-500">可用额度</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-orange-600">{(stats.used_quota || 0).toLocaleString()}</p>
                    <p className="text-xs text-violet-500">已分配</p>
                  </div>
                </div>
                {/* 额度进度条 */}
                <div className="mt-2">
                  <div className="w-full bg-violet-200 rounded-full h-2">
                    <div 
                      className="bg-violet-600 h-2 rounded-full transition-all" 
                      style={{ width: `${stats.total_quota ? Math.min((stats.used_quota || 0) / stats.total_quota * 100, 100) : 0}%` }}
                    />
                  </div>
                  <p className="text-xs text-violet-500 mt-1 text-right">
                    已使用 {stats.total_quota ? ((stats.used_quota || 0) / stats.total_quota * 100).toFixed(1) : 0}%
                  </p>
                </div>
              </div>

              <div>
                <Label>选择服务商</Label>
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value)}
                  className="w-full border rounded px-3 py-2 mt-1"
                >
                  <option value="">请选择服务商</option>
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.username} (可用额度: {(p.available_quota ?? p.quota ?? 0).toLocaleString()})
                    </option>
                  ))}
                </select>
                {/* 选中服务商后显示其额度 */}
                {selectedProvider && (() => {
                  const provider = providers.find(p => p.id === selectedProvider);
                  if (!provider) return null;
                  return (
                    <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg p-2">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-blue-500">当前额度:</span>
                          <span className="font-medium ml-1">{(provider.quota ?? 0).toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-blue-500">已使用:</span>
                          <span className="font-medium ml-1">{(provider.used_quota ?? 0).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div>
                <Label>分配额度 (元)</Label>
                <Input
                  type="number"
                  value={quotaAmount}
                  onChange={(e) => setQuotaAmount(e.target.value)}
                  placeholder="输入额度金额"
                  className="mt-1"
                />
                <p className="text-sm text-gray-500 mt-1">服务商获得额度后，可自主选择产品模板生成算力产品</p>
                {/* 额度不足提示 */}
                {quotaAmount && parseFloat(quotaAmount) > (stats.available_quota || 0) && (
                  <div className="mt-1 flex items-center gap-1 text-red-600 text-sm">
                    <AlertCircle className="w-4 h-4" />
                    <span>额度不足！可用额度 {(stats.available_quota || 0).toLocaleString()} 元，需分配 {parseFloat(quotaAmount).toLocaleString()} 元</span>
                  </div>
                )}
                {/* 额度充足提示 */}
                {quotaAmount && parseFloat(quotaAmount) > 0 && parseFloat(quotaAmount) <= (stats.available_quota || 0) && (
                  <div className="mt-1 flex items-center gap-1 text-green-600 text-sm">
                    <CheckCircle className="w-4 h-4" />
                    <span>分配后剩余: {((stats.available_quota || 0) - parseFloat(quotaAmount)).toLocaleString()} 元</span>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setShowAllocateDialog(false)}>取消</Button>
                <Button 
                  className="bg-blue-600" 
                  onClick={handleAllocateQuota}
                  disabled={submitting || (quotaAmount ? parseFloat(quotaAmount) > (stats.available_quota || 0) : false)}
                >
                  {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                  确认分配
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 顶部导航 - 深紫色主题 */}
      <header className="bg-gradient-to-r from-violet-900 to-purple-900 shadow-lg sticky top-0 z-40">
        <div className="container mx-auto px-3 md:px-6 py-3 md:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-white/20 backdrop-blur flex items-center justify-center">
                <Building2 className="w-5 h-5 md:w-6 md:h-6 text-white" />
              </div>
              <div>
                <h1 className="text-base md:text-xl font-bold text-white">分公司管理后台</h1>
                <p className="text-xs text-white/70 hidden md:block">Branch Management System</p>
              </div>
            </div>
            <div className="flex items-center gap-2 md:gap-3">
              <Badge className="bg-white/20 text-white backdrop-blur text-xs">
                <Building2 className="w-3 h-3 mr-1" />分公司
              </Badge>
              <Button variant="ghost" onClick={logout} className="text-white hover:bg-white/20 text-sm">退出</Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 md:px-6 py-4 md:py-8">
        {/* 数据概览 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 mb-4 md:mb-8">
          <Card className="mobile-compact-card">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-500 mobile-icon" />
                <span className="text-gray-500 text-sm mobile-label">服务商数量</span>
              </div>
              <p className="text-2xl font-bold mt-2">{stats.provider_count}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-green-500 mobile-icon" />
                <span className="text-gray-500 text-sm mobile-label">会员数量</span>
              </div>
              <p className="text-2xl font-bold mt-2">{stats.member_count}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-500 mobile-icon" />
                <span className="text-gray-500 text-sm mobile-label">会员总收益</span>
              </div>
              <p className="text-2xl font-bold mt-2">{(stats.total_member_energy || 0).toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-blue-500 mobile-icon" />
                <span className="text-gray-500 text-sm mobile-label">待处理事项</span>
              </div>
              <p className="text-2xl font-bold mt-2">{stats.pending_sell_count + stats.pending_withdrawal_count}</p>
            </CardContent>
          </Card>
        </div>

        {/* 功能标签页 - 深紫色主题 */}
        <div className="space-y-3 md:space-y-6">
          <div className="flex justify-between items-center bg-gradient-to-r from-violet-900 to-purple-900 rounded-lg px-2 py-1">
            <div className="mobile-tab-nav flex gap-2 overflow-x-auto scrollbar-hide -mx-2 px-2">
              <button
                onClick={() => setActiveTab('profile')}
                className={`px-4 py-2 rounded-md transition-all flex items-center gap-1 ${
                  activeTab === 'profile' ? 'bg-white text-purple-900 font-semibold shadow-md' : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                <User className="w-4 h-4" />我的资料
              </button>
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-4 py-2 rounded-md transition-all ${
                  activeTab === 'overview' ? 'bg-white text-purple-900 font-semibold shadow-md' : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                数据总览
              </button>
              <button
                onClick={() => setActiveTab('quota-management')}
                className={`px-4 py-2 rounded-md transition-all flex items-center gap-1 ${
                  activeTab === 'quota-management' ? 'bg-white text-purple-900 font-semibold shadow-md' : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                <Database className="w-4 h-4" />算力额度管理
                {providerQuotaRequests.length > 0 && (
                  <Badge className="ml-1 bg-red-500 text-white text-xs">{providerQuotaRequests.length}</Badge>
                )}
              </button>
              <button
                onClick={() => setActiveTab('providers')}
                className={`px-4 py-2 rounded-md transition-all flex items-center gap-1 ${
                  activeTab === 'providers' ? 'bg-white text-purple-900 font-semibold shadow-md' : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                <Building2 className="w-4 h-4" />服务商管理
              </button>
              <button
                onClick={() => { loadMemberList(1); setActiveTab('members'); }}
                className={`px-4 py-2 rounded-md transition-all flex items-center gap-1 ${
                  activeTab === 'members' ? 'bg-white text-purple-900 font-semibold shadow-md' : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                <User className="w-4 h-4" />会员管理
              </button>
              <button
                onClick={() => setActiveTab('applications')}
                className={`px-4 py-2 rounded-md transition-all flex items-center gap-1 ${
                  activeTab === 'applications' ? 'bg-white text-purple-900 font-semibold shadow-md' : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                <FileCheck className="w-4 h-4" />审核申请
                {applications.length > 0 && (
                  <Badge className="ml-2 bg-red-500 text-white text-xs">{applications.length}</Badge>
                )}
              </button>

              <button
                onClick={() => { loadEnergyBalance(); loadEnergyRecords('all'); setActiveTab('energy'); setEnergySubTab('records'); }}
                className={`px-4 py-2 rounded-md transition-all flex items-center gap-1 ${
                  activeTab === 'energy' ? 'bg-white text-purple-900 font-semibold shadow-md' : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                <Zap className="w-4 h-4" />收益管理
                {(energyRequests.filter((r: any) => r.status === 'pending').length + providerEnergyRequests.filter((r: any) => r.status === 'pending').length) > 0 && (
                  <Badge className="ml-1 bg-red-500 text-white text-xs">{energyRequests.filter((r: any) => r.status === 'pending').length + providerEnergyRequests.filter((r: any) => r.status === 'pending').length}</Badge>
                )}
              </button>
              <button
                onClick={() => { loadPendingWithdrawals(); setActiveTab('withdraw-review'); }}
                className={`px-4 py-2 rounded-md transition-all flex items-center gap-1 ${
                  activeTab === 'withdraw-review' ? 'bg-white text-purple-900 font-semibold shadow-md' : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                <ClipboardCheck className="w-4 h-4" />提现审核
              </button>
              <button
                onClick={() => { loadBranchRevenueRecords(); setActiveTab('revenue'); }}
                className={`px-4 py-2 rounded-md transition-all flex items-center gap-1 ${
                  activeTab === 'revenue' ? 'bg-white text-purple-900 font-semibold shadow-md' : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                <Banknote className="w-4 h-4" />收益管理
              </button>
            </div>
          </div>

          {/* 我的资料 */}
          {activeTab === 'profile' && (
            <Card>
              <CardHeader>
                <CardTitle>我的资料</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* 基本信息 */}
                  <div className="space-y-4">
                    <h3 className="font-medium text-lg border-b pb-2">基本信息</h3>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between py-2 border-b">
                        <span className="text-gray-500">用户ID</span>
                        <span className="font-mono text-sm font-bold text-purple-700">{(user as any)?.unique_id || user?.id?.slice(0,8) || '-'}</span>
                      </div>
                      <div className="flex items-center justify-between py-2 border-b">
                        <span className="text-gray-500">邀请码</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-blue-600">{(user as any)?.invite_code || '未生成'}</span>
                          {(user as any)?.invite_code && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={() => {
                                navigator.clipboard.writeText((user as any).invite_code);
                                showMessage('success', '邀请码已复制');
                              }}
                            >
                              复制
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between py-2 border-b">
                        <span className="text-gray-500">用户名</span>
                        <span className="font-medium">{user?.username || '-'}</span>
                      </div>
                      <div className="flex items-center justify-between py-2 border-b">
                        <span className="text-gray-500">角色</span>
                        <Badge className="bg-purple-100 text-purple-700">分公司</Badge>
                      </div>
                      <div className="flex items-center justify-between py-2 border-b">
                        <span className="text-gray-500">手机号</span>
                        <span>{(user as any)?.phone || '-'}</span>
                      </div>
                      <div className="flex items-center justify-between py-2 border-b">
                        <span className="text-gray-500">真实姓名</span>
                        <span>{(user as any)?.real_name || '未填写'}</span>
                      </div>
                    </div>
                  </div>

                  {/* 账户信息 */}
                  <div className="space-y-4">
                    <h3 className="font-medium text-lg border-b pb-2">账户信息</h3>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between py-2 border-b">
                        <span className="text-gray-500">收益余额</span>
                        <span className="font-bold text-xl text-purple-600">{branchEnergyBalance.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between py-2 border-b">
                        <span className="text-gray-500">服务商数量</span>
                        <span className="font-medium">{stats.provider_count}</span>
                      </div>
                      <div className="flex items-center justify-between py-2 border-b">
                        <span className="text-gray-500">会员总数</span>
                        <span className="font-medium">{stats.member_count}</span>
                      </div>
                      <div className="flex items-center justify-between py-2 border-b">
                        <span className="text-gray-500">总分配额度</span>
                        <span className="font-medium">¥{allocations.reduce((sum: number, a: any) => sum + (parseFloat(a.quota_amount) || 0), 0).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 修改用户名 */}
                <div className="mt-6 pt-6 border-t">
                  <h3 className="font-medium text-lg mb-4">修改用户名</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>用户名</Label>
                      <Input 
                        value={editUsername}
                        onChange={(e) => setEditUsername(e.target.value)}
                        className="mt-1"
                        placeholder="请输入用户名（2-20个字符）"
                      />
                    </div>
                  </div>
                  <div className="mt-4">
                    <Button className="bg-purple-600 hover:bg-purple-700" onClick={handleSaveUsername}>
                      保存用户名
                    </Button>
                  </div>
                </div>

                {/* 修改姓名 */}
                <div className="mt-6 pt-6 border-t">
                  <h3 className="font-medium text-lg mb-4">修改姓名</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>真实姓名</Label>
                      <Input 
                        value={editRealName}
                        onChange={(e) => setEditRealName(e.target.value)}
                        className="mt-1"
                        placeholder="请输入真实姓名"
                      />
                    </div>
                    <div>
                      <Label>手机号</Label>
                      <Input 
                        value={user?.phone || ''} 
                        disabled
                        className="mt-1 bg-gray-100"
                        placeholder="手机号不可修改"
                      />
                    </div>
                  </div>
                  <div className="mt-4">
                    <Button className="bg-purple-600 hover:bg-purple-700" onClick={handleSaveProfile}>
                      保存姓名
                    </Button>
                  </div>
                </div>

                {/* 收款信息 */}
                <div className="mt-6 pt-6 border-t">
                  <h3 className="font-medium text-lg mb-4">收款信息</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>支付宝账号</Label>
                      <Input 
                        value={editAlipayAccount}
                        onChange={(e) => setEditAlipayAccount(e.target.value)}
                        className="mt-1"
                        placeholder="请输入支付宝账号（用于收款）"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">收款信息用于会员提现时向您转账，请确保账号正确</p>
                  <div className="mt-4">
                    <Button className="bg-purple-600 hover:bg-purple-700" onClick={handleSavePayment}>
                      保存收款信息
                    </Button>
                  </div>
                </div>

                {/* 修改密码 */}
                <div className="mt-6 pt-6 border-t">
                  <h3 className="font-medium text-lg mb-4">修改密码</h3>
                  <div className="space-y-4 max-w-md">
                    <div>
                      <Label>当前密码</Label>
                      <Input 
                        type="password"
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.target.value)}
                        className="mt-1"
                        placeholder="请输入当前密码"
                      />
                    </div>
                    <div>
                      <Label>新密码</Label>
                      <Input 
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="mt-1"
                        placeholder="请输入新密码（至少6个字符）"
                      />
                    </div>
                    <div>
                      <Label>确认新密码</Label>
                      <Input 
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="mt-1"
                        placeholder="请再次输入新密码"
                      />
                    </div>
                  </div>
                  <div className="mt-4">
                    <Button className="bg-purple-600 hover:bg-purple-700" onClick={handlePasswordChange}>
                      修改密码
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 概览 */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardContent className="pt-4">
                  <h3 className="font-medium mb-4">快捷操作</h3>
                  <div className="space-y-3">
                    <Button 
                      onClick={() => openAllocateDialog()} 
                      className="w-full bg-blue-600 hover:bg-blue-700"
                    >
                      <Send className="w-4 h-4 mr-2" />分配额度给服务商
                    </Button>
                    <Button 
                      onClick={() => setActiveTab('providers')} 
                      variant="outline" 
                      className="w-full"
                    >
                      <Users className="w-4 h-4 mr-2" />查看服务商列表
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <h3 className="font-medium mb-4">系统状态</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-gray-500">服务商数量</span>
                      <span className="font-medium">{stats.provider_count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">会员数量</span>
                      <span className="font-medium">{stats.member_count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">会员总余额</span>
                      <span className="text-green-600">¥{(stats.total_member_balance || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">已分配额度</span>
                      <span className="text-blue-600">
                        ¥{(allocations.reduce((sum: number, a: any) => sum + (parseFloat(a.quota_amount) || 0), 0)).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* 算力额度管理（统一） */}
          {activeTab === 'quota-management' && (
            <div className="space-y-3 md:space-y-6">
              {/* 子Tab导航 */}
              <div className="mobile-tab-nav flex gap-1 overflow-x-auto pb-1">
                {[
                  { key: 'overview', label: '额度总览', icon: Database },
                  { key: 'allocations', label: '额度分配', icon: Share2 },
                  { key: 'approve', label: '额度审批', icon: ClipboardList },
                ].map(sub => (
                  <button
                    key={sub.key}
                    onClick={() => setQuotaSubTab(sub.key)}
                    className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      quotaSubTab === sub.key
                        ? 'bg-purple-600 text-white shadow'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <sub.icon className="w-4 h-4" />
                    {sub.label}
                  </button>
                ))}
              </div>

              {/* 子Tab: 额度总览 */}
              {quotaSubTab === 'overview' && (
                <div className="space-y-3 md:space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
                    <Card className="mobile-compact-card bg-gradient-to-br from-purple-500 to-purple-600 text-white">
                      <CardContent className="pt-4">
                        <p className="text-sm opacity-80 mobile-label">总额度</p>
                        <p className="text-2xl font-bold mt-1 mobile-num">¥{stats.total_quota?.toLocaleString() || '0'}</p>
                      </CardContent>
                    </Card>
                    <Card className="mobile-compact-card bg-gradient-to-br from-green-500 to-green-600 text-white">
                      <CardContent className="pt-4">
                        <p className="text-sm opacity-80 mobile-label">可用额度</p>
                        <p className="text-2xl font-bold mt-1 mobile-num">¥{stats.available_quota?.toLocaleString() || '0'}</p>
                      </CardContent>
                    </Card>
                    <Card className="mobile-compact-card bg-gradient-to-br from-orange-500 to-orange-600 text-white">
                      <CardContent className="pt-4">
                        <p className="text-sm opacity-80 mobile-label">已分配</p>
                        <p className="text-2xl font-bold mt-1 mobile-num">¥{stats.used_quota?.toLocaleString() || '0'}</p>
                      </CardContent>
                    </Card>
                    <Card className="mobile-compact-card bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                      <CardContent className="pt-4">
                        <p className="text-sm opacity-80 mobile-label">服务商数</p>
                        <p className="text-2xl font-bold mt-1 mobile-num">{providers.length}</p>
                      </CardContent>
                    </Card>
                  </div>
                  {/* 额度使用进度 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">额度使用进度</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span>已分配 / 总额度</span>
                            <span>¥{(stats.used_quota || 0).toLocaleString()} / ¥{(stats.total_quota || 0).toLocaleString()}</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2.5">
                            <div
                              className="bg-purple-600 h-2.5 rounded-full transition-all"
                              style={{ width: `${stats.total_quota ? Math.min(((stats.used_quota || 0) / stats.total_quota) * 100, 100) : 0}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  {/* 服务商额度分布 */}
                  {providers.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">服务商额度分布</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {providers.map((p: any) => (
                            <div key={p.id} className="flex items-center justify-between p-3 border rounded-lg">
                              <div>
                                <p className="font-medium">{p.username || p.name || '服务商'}</p>
                                <p className="text-sm text-gray-500">可用: ¥{(p.available_quota || p.quota || 0).toLocaleString()}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-medium">¥{(p.quota || 0).toLocaleString()}</p>
                                <p className="text-xs text-gray-500">已用: ¥{(p.used_quota || 0).toLocaleString()}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  {/* 申请额度 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Send className="w-5 h-5 text-purple-600" />
                          向总公司申请额度
                        </div>
                        <Button size="sm" onClick={() => setShowQuotaApplyDialog(true)} className="bg-purple-600 hover:bg-purple-700">
                          申请额度
                        </Button>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b bg-gray-50">
                              <th className="text-left py-3 px-4">申请额度</th>
                              <th className="text-left py-3 px-4">批准额度</th>
                              <th className="text-left py-3 px-4">状态</th>
                              <th className="text-left py-3 px-4">申请时间</th>
                            </tr>
                          </thead>
                          <tbody>
                            {quotaRequests.map((request, idx) => (
                              <tr key={`quota-overview-${request.id}-${idx}`} className="border-b hover:bg-gray-50">
                                <td className="py-3 px-4">¥{(parseFloat(String((request as any).requested_amount)) || 0).toLocaleString()}</td>
                                <td className="py-3 px-4 text-green-600">¥{(parseFloat(String((request as any).approved_amount)) || 0).toLocaleString()}</td>
                                <td className="py-3 px-4">
                                  <Badge className={
                                    request.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                                    request.status === 'approved' ? 'bg-green-100 text-green-700' :
                                    'bg-red-100 text-red-700'
                                  }>
                                    {request.status === 'pending' ? '待审核' :
                                     request.status === 'approved' ? '已通过' : '已拒绝'}
                                  </Badge>
                                </td>
                                <td className="py-3 px-4 text-sm text-gray-500">
                                  {request.created_at ? new Date(request.created_at).toLocaleString() : '-'}
                                </td>
                              </tr>
                            ))}
                            {quotaRequests.length === 0 && (
                              <tr>
                                <td colSpan={4} className="py-8 text-center text-gray-500">
                                  暂无申请记录
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>

                  {/* 我的额度申请记录 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FileText className="w-5 h-5 text-blue-600" />
                          我的额度申请记录
                        </div>
                        <Button size="sm" onClick={() => setShowQuotaApplyDialog(true)}>
                          <PlusCircle className="w-4 h-4 mr-1" />申请额度
                        </Button>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b bg-gray-50">
                              <th className="text-left py-3 px-4">申请额度</th>
                              <th className="text-left py-3 px-4">批准额度</th>
                              <th className="text-left py-3 px-4">奖励比例</th>
                              <th className="text-left py-3 px-4">状态</th>
                              <th className="text-left py-3 px-4">申请时间</th>
                            </tr>
                          </thead>
                          <tbody>
                            {quotaRequests.map((request, idx) => (
                              <tr key={`quota-table-${request.id}-${idx}`} className="border-b hover:bg-gray-50">
                                <td className="py-3 px-4">¥{(parseFloat(String((request as any).requested_amount)) || 0).toLocaleString()}</td>
                                <td className="py-3 px-4 text-green-600">¥{(parseFloat(String((request as any).approved_amount)) || 0).toLocaleString()}</td>
                                <td className="py-3 px-4 text-orange-600">{(request as any).bonus_rate}%</td>
                                <td className="py-3 px-4">
                                  <Badge className={
                                    request.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                                    request.status === 'approved' ? 'bg-green-100 text-green-700' :
                                    'bg-red-100 text-red-700'
                                  }>
                                    {request.status === 'pending' ? '待审核' :
                                     request.status === 'approved' ? '已通过' : '已拒绝'}
                                  </Badge>
                                </td>
                                <td className="py-3 px-4 text-sm text-gray-500">
                                  {request.created_at ? new Date(request.created_at).toLocaleString() : '-'}
                                </td>
                              </tr>
                            ))}
                            {quotaRequests.length === 0 && (
                              <tr>
                                <td colSpan={5} className="py-8 text-center text-gray-500">
                                  暂无申请记录
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}


              {/* 子Tab: 额度分配 */}
              {quotaSubTab === 'allocations' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>额度分配记录</CardTitle>
                  <Button onClick={() => openAllocateDialog()} className="bg-blue-600">
                    <Plus className="w-4 h-4 mr-2" />分配额度
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="text-left py-3 px-4">服务商</th>
                        <th className="text-left py-3 px-4">分配额度</th>
                        <th className="text-left py-3 px-4">已用额度</th>
                        <th className="text-left py-3 px-4">状态</th>
                        <th className="text-left py-3 px-4">时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allocations.map(allocation => (
                        <tr key={allocation.id} className="border-b hover:bg-gray-50">
                          <td className="py-3 px-4">{(allocation as any).provider_name || '-'}</td>
                          <td className="py-3 px-4 text-green-600 font-medium">
                            ¥{(parseFloat(String(allocation.quota_amount)) || 0).toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-orange-600">
                            ¥{(parseFloat(String(allocation.used_amount)) || 0).toLocaleString()}
                          </td>
                          <td className="py-3 px-4">
                            <Badge className={
                              allocation.status === 'active' ? 'bg-green-100 text-green-700' :
                              allocation.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                              'bg-gray-100 text-gray-700'
                            }>
                              {allocation.status === 'active' ? '使用中' : 
                               allocation.status === 'completed' ? '已完成' : allocation.status}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-500">
                            {allocation.created_at?.slice(0, 10)}
                          </td>
                        </tr>
                      ))}
                      {allocations.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-gray-500">
                            暂无分配记录
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

              {/* 子Tab: 额度审批 */}
              {quotaSubTab === 'approve' && (
            <div className="space-y-3 md:space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="w-5 h-5 text-orange-600" />
                      服务商额度申请审批
                    </div>
                    {/* 状态筛选 */}
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant={quotaFilterStatus === 'pending' ? 'default' : 'outline'}
                        onClick={() => { setQuotaFilterStatus('pending'); }}
                      >
                        待审核
                      </Button>
                      <Button 
                        size="sm" 
                        variant={quotaFilterStatus === 'approved' ? 'default' : 'outline'}
                        onClick={() => { setQuotaFilterStatus('approved'); }}
                      >
                        已通过
                      </Button>
                      <Button 
                        size="sm" 
                        variant={quotaFilterStatus === 'rejected' ? 'default' : 'outline'}
                        onClick={() => { setQuotaFilterStatus('rejected'); }}
                      >
                        已拒绝
                      </Button>
                      <Button 
                        size="sm" 
                        variant={quotaFilterStatus === 'all' ? 'default' : 'outline'}
                        onClick={() => { setQuotaFilterStatus('all'); }}
                      >
                        全部
                      </Button>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {providerQuotaRequests.length > 0 ? providerQuotaRequests.map((request, idx) => (
                      <div key={`prov-quota-${request.id}-${idx}`} className="p-4 border rounded-lg hover:bg-gray-50">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium">
                                {request.provider?.name || request.provider?.username || request.requester_name || '服务商'} 
                              </p>
                              {/* 状态标签 */}
                              <Badge variant={
                                request.status === 'approved' ? 'default' : 
                                request.status === 'rejected' ? 'destructive' : 
                                'secondary'
                              }>
                                {request.status === 'pending' ? '待审核' : 
                                 request.status === 'approved' ? '已通过' : 
                                 request.status === 'rejected' ? '已拒绝' : request.status}
                              </Badge>
                            </div>
                            <p className="text-sm text-gray-500 mt-1">
                              申请额度: ¥{(parseFloat(String(request.requested_amount || request.amount)) || 0).toLocaleString()}
                              {request.approved_amount && request.approved_amount > 0 && (
                                <span className="ml-2 text-green-600">
                                  → 批准: ¥{parseFloat(String(request.approved_amount)).toLocaleString()}
                                </span>
                              )}
                            </p>
                            <p className="text-sm text-gray-500 mt-1">
                              申请时间: {request.created_at ? new Date(request.created_at).toLocaleString() : '-'}
                            </p>
                            {request.reject_reason && (
                              <p className="text-xs text-red-500 mt-1">拒绝原因: {request.reject_reason}</p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {request.status === 'pending' && (
                              <>
                                <Button 
                                  size="sm" 
                                  className="bg-green-600"
                                  onClick={() => {
                                    const approved = prompt('请输入批准金额:', request.requested_amount?.toString());
                                    if (approved && parseFloat(approved) > 0) {
                                      handleApproveProviderQuota(request.id, 'approve', parseFloat(approved));
                                    }
                                  }}
                                  disabled={submitting}
                                >
                                  通过
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="destructive"
                                  onClick={() => handleApproveProviderQuota(request.id, 'reject')}
                                  disabled={submitting}
                                >
                                  拒绝
                                </Button>
                              </>
                            )}
                            {request.status !== 'pending' && (
                              <span className="text-sm text-gray-400">
                                {request.status === 'approved' ? '已发放额度' : '已拒绝'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )) : (
                      <div className="py-8 text-center text-gray-500">
                        暂无{quotaFilterStatus === 'all' ? '' : quotaFilterStatus === 'pending' ? '待审核' : quotaFilterStatus === 'approved' ? '已通过' : '已拒绝'}的服务商额度申请
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
            </div>
          )}

          {/* 服务商管理 */}
          {activeTab === 'providers' && (
            <Card>
              <CardHeader>
                <CardTitle>服务商列表</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="text-left py-3 px-4">服务商</th>
                        <th className="text-left py-3 px-4">收益</th>
                        <th className="text-left py-3 px-4">余额</th>
                        <th className="text-left py-3 px-4">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {providers.map(provider => (
                        <tr key={provider.id} className="border-b hover:bg-gray-50">
                          <td className="py-3 px-4 font-medium">{provider.username}</td>
                          <td className="py-3 px-4 text-orange-600">{(provider.energy_value || 0).toLocaleString()}</td>
                          <td className="py-3 px-4 text-green-600">¥{(provider.balance || 0).toLocaleString()}</td>
                          <td className="py-3 px-4">
                            <Button
                              size="sm"
                              className="bg-blue-600"
                              onClick={() => {
                                setSelectedProvider(provider.id);
                                openAllocateDialog();
                              }}
                            >
                              <Send className="w-4 h-4 mr-1" />分配额度
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {providers.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-gray-500">
                            暂无服务商
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 审核申请 */}
          {activeTab === 'applications' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>服务商申请审核</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-blue-100 text-blue-700">
                      一代待审: {applications.filter(a => a.status === 'pending' && a.apply_type === 'first_gen').length}个
                    </Badge>
                    <Badge className="bg-amber-100 text-amber-700">
                      二代待终审: {applications.filter(a => a.status === 'provider_approved').length}个
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {applications.length === 0 ? (
                  <div className="py-12 text-center text-gray-500">
                    <ClipboardList className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>暂无待审核的申请</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {applications.map((app, idx) => (
                      <div key={`app-${app.id}-${idx}`} className="p-4 border rounded-lg hover:bg-gray-50">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h4 className="font-medium">{app.applicant_name || app.real_name || '申请人'}</h4>
                              <Badge className={
                                app.apply_type === 'first_gen' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                              }>
                                {app.apply_type === 'first_gen' ? '第一代申请' : '第二代申请'}
                              </Badge>
                              {app.status === 'provider_approved' && (
                                <Badge className="bg-amber-100 text-amber-700">
                                  上级已审核-待终审
                                </Badge>
                              )}
                              {app.status === 'pending' && (
                                <Badge className="bg-gray-100 text-gray-700">
                                  待审核
                                </Badge>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                              <div>
                                <span className="text-gray-400">用户名：</span>
                                {app.username || '-'}
                              </div>
                              <div>
                                <span className="text-gray-400">手机号：</span>
                                {app.phone || app.user_phone || '-'}
                              </div>
                              <div>
                                <span className="text-gray-400">申请额度：</span>
                                <span className="text-green-600 font-medium">¥{(parseFloat(String(app.quota_request || app.quota_approved || 0)) || 0).toLocaleString()}</span>
                              </div>
                              {app.status === 'provider_approved' && (app.quota_approved || 0) > 0 && (
                                <div>
                                  <span className="text-gray-400">上级已批额度：</span>
                                  <span className="text-amber-600 font-medium">¥{parseFloat(String(app.quota_approved || 0)).toLocaleString()}</span>
                                </div>
                              )}
                              {app.parent_provider_name && (
                                <div>
                                  <span className="text-gray-400">上级服务商：</span>
                                  {app.parent_provider_name}
                                </div>
                              )}
                            </div>
                            <div className="mt-2 text-xs text-gray-400">
                              申请时间: {app.created_at ? new Date(app.created_at).toLocaleString() : '-'}
                            </div>
                            {app.status === 'provider_approved' && (
                              <div className="mt-1 text-xs text-amber-600">
                                上级服务商已同意拆分 {app.quota_approved || 0} 额度，请确认线下合同签署后通过
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2 ml-4">
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700"
                              onClick={() => handleReviewApplication(app.id, 'approve')}
                              disabled={submitting}
                            >
                              <CheckCircle className="w-4 h-4 mr-1" />通过
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => {
                                const reason = prompt('请输入拒绝原因:');
                                if (reason) {
                                  handleReviewApplication(app.id, 'reject');
                                }
                              }}
                              disabled={submitting}
                            >
                              <XCircle className="w-4 h-4 mr-1" />拒绝
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* 收益申请记录 */}
          {activeTab === 'energy-apply' && (
            <div className="space-y-3 md:space-y-6">
              {/* 收益申请统计 */}
              <div className="grid grid-cols-4 gap-4">
                <Card className="bg-gradient-to-br from-purple-500 to-indigo-500 text-white">
                  <CardContent className="pt-4">
                    <p className="text-sm opacity-80">总申请次数</p>
                    <p className="text-2xl font-bold mt-1">{myEnergyRequests.length}</p>
                    <p className="text-xs opacity-70 mt-1">次</p>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-yellow-500 to-orange-500 text-white">
                  <CardContent className="pt-4">
                    <p className="text-sm opacity-80">待审核</p>
                    <p className="text-2xl font-bold mt-1">{myEnergyRequests.filter(r => r.status === 'pending').length}</p>
                    <p className="text-xs opacity-70 mt-1">次</p>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-green-500 to-emerald-500 text-white">
                  <CardContent className="pt-4">
                    <p className="text-sm opacity-80">已通过</p>
                    <p className="text-2xl font-bold mt-1">
                      {myEnergyRequests.filter(r => r.status === 'approved').reduce((sum, r) => sum + (r.amount || 0), 0).toLocaleString()}
                    </p>
                    <p className="text-xs opacity-70 mt-1">收益</p>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-gray-500 to-gray-600 text-white">
                  <CardContent className="pt-4">
                    <p className="text-sm opacity-80">已拒绝</p>
                    <p className="text-2xl font-bold mt-1">{myEnergyRequests.filter(r => r.status === 'rejected').length}</p>
                    <p className="text-xs opacity-70 mt-1">次</p>
                  </CardContent>
                </Card>
              </div>

              {/* 收益申请记录列表 */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Zap className="w-5 h-5 text-purple-600" />
                      我的收益申请记录
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => setShowEnergyApplyDialog(true)}
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        <Zap className="w-4 h-4 mr-2" />
                        申请收益
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {myEnergyRequests.length > 0 ? (
                    <div className="space-y-3">
                      {myEnergyRequests.map((request, idx) => (
                        <div key={`energy-apply-${request.id}-${idx}`} className="p-4 border rounded-lg hover:bg-gray-50">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-3">
                                <p className="font-medium text-lg">
                                  申请收益: 
                                  <span className="text-purple-600 ml-2">{request.amount?.toLocaleString()}</span>
                                </p>
                                <Badge className={
                                  request.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                                  request.status === 'approved' ? 'bg-green-100 text-green-700' :
                                  'bg-red-100 text-red-700'
                                }>
                                  {request.status === 'pending' ? '待审核' :
                                   request.status === 'approved' ? '已通过' : '已拒绝'}
                                </Badge>
                              </div>
                              <p className="text-sm text-gray-500 mt-1">
                                申请时间: {request.createdAt ? new Date(request.createdAt).toLocaleString() : '-'}
                              </p>
                              {request.note && (
                                <p className="text-xs text-gray-400 mt-1">备注: {request.note}</p>
                              )}
                              {request.reviewerNote && (
                                <p className="text-xs text-gray-400 mt-1">审核备注: {request.reviewerNote}</p>
                              )}
                              {request.status === 'approved' && request.reviewedAt && (
                                <p className="text-xs text-green-600 mt-1">
                                  审核通过时间: {new Date(request.reviewedAt).toLocaleString()}
                                </p>
                              )}
                            </div>
                            {request.status === 'pending' && (
                              <div className="text-sm text-gray-500">
                                等待总公司审核中...
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-12 text-center">
                      <Zap className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                      <p className="text-gray-500">暂无收益申请记录</p>
                      <p className="text-sm text-gray-400 mt-2">点击上方按钮向总公司申请收益</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 申请说明 */}
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="pt-6">
                  <h4 className="font-semibold text-blue-800 mb-2">收益申请说明</h4>
                  <ul className="text-sm text-blue-700 space-y-1">
                    <li>1. 分公司向总公司申请收益，最低申请金额为 50 收益</li>
                    <li>2. 提交申请后，需要等待总公司审核</li>
                    <li>3. 总公司审核通过后，收益会自动发放到您的账户</li>
                    <li>4. 收益用于给服务商下发，服务商给会员充值后产生收益</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          )}

          {/* 收益管理 */}
          {activeTab === 'energy' && (
            <div className="space-y-3 md:space-y-6">
              {/* 子Tab导航 */}
              <div className="flex gap-2 bg-white p-1 rounded-lg shadow-sm">
                <button
                  onClick={() => { setEnergySubTab('apply'); }}
                  className={`px-4 py-2 rounded-md transition-all ${
                    energySubTab === 'apply' ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-purple-50'
                  }`}
                >
                  向总公司申请
                </button>
                <button
                  onClick={() => { setEnergySubTab('records'); loadEnergyRecords(energyFilterType); }}
                  className={`px-4 py-2 rounded-md transition-all ${
                    energySubTab === 'records' ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-purple-50'
                  }`}
                >
                  流转记录
                </button>
                <button
                  onClick={() => { setEnergySubTab('review'); loadProviderEnergyRequests(); }}
                  className={`px-4 py-2 rounded-md transition-all flex items-center gap-2 ${
                    energySubTab === 'review' ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-purple-50'
                  }`}
                >
                  审核服务商申请
                  {providerEnergyRequests.filter(r => r.status === 'pending').length > 0 && (
                    <Badge className="bg-red-500 text-white text-xs">{providerEnergyRequests.filter(r => r.status === 'pending').length}</Badge>
                  )}
                </button>
                <button
                  onClick={() => { setEnergySubTab('transfer'); loadTransferTargets(); }}
                  className={`px-4 py-2 rounded-md transition-all ${
                    energySubTab === 'transfer' ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-purple-50'
                  }`}
                >
                  收益转账
                </button>
              </div>

              {/* 向总公司申请 */}
              {energySubTab === 'apply' && (
                <>
                  {/* 当前余额 */}
                  <Card className="bg-gradient-to-br from-purple-500 to-indigo-500 text-white">
                    <CardContent className="pt-4">
                      <p className="text-sm opacity-80">当前余额</p>
                      <p className="text-3xl font-bold mt-2">{branchEnergyBalance.toLocaleString()}</p>
                      <p className="text-xs opacity-70 mt-2">收益</p>
                    </CardContent>
                  </Card>

                  {/* 申请表单 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Zap className="w-5 h-5 text-purple-600" />
                        向总公司申请收益
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium mb-2">申请金额</label>
                          <input
                            type="number"
                            value={branchApplyAmount}
                            onChange={(e) => setBranchApplyAmount(e.target.value)}
                            placeholder="输入申请金额"
                            className="w-full p-2 border rounded-lg"
                          />
                          <p className="text-sm text-gray-500 mt-1">申请后需等待总公司审核</p>
                        </div>
                        <Button 
                          className="bg-purple-600"
                          onClick={handleBranchApplyEnergy}
                          disabled={!branchApplyAmount || submitting}
                        >
                          提交申请
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {/* 分公司向总公司申请记录 */}
                  {energyRequests.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Badge className="bg-purple-600">总公司</Badge>
                          申请记录（等待总公司审核）
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {energyRequests.map((request) => (
                            <div key={`er-${request.id}`} className="p-4 border rounded-lg">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="font-medium">申请收益</p>
                                  <p className="text-sm text-gray-500 mt-1">申请额度: {(parseFloat(String(request.amount || 0))).toLocaleString()} 收益</p>
                                  <p className="text-xs text-gray-400 mt-1">{request.created_at ? new Date(request.created_at).toLocaleString() : '-'}</p>
                                </div>
                                <Badge className={request.status === 'pending' ? 'bg-yellow-500' : request.status === 'approved' ? 'bg-green-500' : 'bg-red-500'}>
                                  {request.status === 'pending' ? '等待总公司审核' : request.status === 'approved' ? '已通过' : '已拒绝'}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}

              {/* 流转记录 */}
              {energySubTab === 'records' && (
                <>
                  {/* 收益概览 */}
                  <div className="grid grid-cols-3 gap-4">
                <Card className="bg-gradient-to-br from-purple-500 to-indigo-500 text-white">
                  <CardContent className="pt-4">
                    <p className="text-sm opacity-80">当前余额</p>
                    <p className="text-3xl font-bold mt-2">{branchEnergyBalance.toLocaleString()}</p>
                    <p className="text-xs opacity-70 mt-2">收益</p>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-green-500 to-emerald-500 text-white">
                  <CardContent className="pt-4">
                    <p className="text-sm opacity-80">累计收入</p>
                    <p className="text-2xl font-bold mt-2">{energyStats.totalIn.toLocaleString()}</p>
                    <p className="text-xs opacity-70 mt-2">充值 + 转入</p>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-orange-500 to-red-500 text-white">
                  <CardContent className="pt-4">
                    <p className="text-sm opacity-80">累计支出</p>
                    <p className="text-2xl font-bold mt-2">{energyStats.totalOut.toLocaleString()}</p>
                    <p className="text-xs opacity-70 mt-2">转出 + 提现</p>
                  </CardContent>
                </Card>
              </div>

              {/* 收益流转记录 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="w-5 h-5 text-purple-600" />
                      收益流转记录
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant={energyFilterType === 'all' ? 'default' : 'outline'} onClick={() => { setEnergyFilterType('all'); loadEnergyRecords('all'); }}>全部</Button>
                      <Button size="sm" variant={energyFilterType === 'transfer_in' ? 'default' : 'outline'} onClick={() => { setEnergyFilterType('transfer_in'); loadEnergyRecords('transfer_in'); }}>转入</Button>
                      <Button size="sm" variant={energyFilterType === 'transfer_out' ? 'default' : 'outline'} onClick={() => { setEnergyFilterType('transfer_out'); loadEnergyRecords('transfer_out'); }}>转出</Button>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {energyRecords.length > 0 ? (
                    <div className="space-y-3">
                      {energyRecords.map((record, idx) => (
                        <div key={`er-${record.id || idx}`} className="p-4 border rounded-lg flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${record.isIncome ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'}`}>
                              <Zap className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="font-medium">{record.isIncome ? '转入' : '转出'} {record.description || record.note || ''}</p>
                              <p className="text-xs text-gray-400">{record.created_at ? new Date(record.created_at).toLocaleString() : '-'}</p>
                            </div>
                          </div>
                          <div className={`text-xl font-bold ${record.isIncome ? 'text-green-600' : 'text-orange-600'}`}>
                            {record.isIncome ? '+' : '-'}{record.amount?.toLocaleString() || 0}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-8 text-center text-gray-500">暂无流转记录</div>
                  )}
                </CardContent>
              </Card>
                </>
              )}

              {/* 审核服务商申请 */}
              {energySubTab === 'review' && (
                <>
                  {/* 收益概览 */}
                  <div className="grid grid-cols-2 gap-4">
                    <Card className="bg-gradient-to-br from-purple-500 to-indigo-500 text-white">
                      <CardContent className="pt-4">
                        <p className="text-sm opacity-80">当前余额</p>
                        <p className="text-3xl font-bold mt-2">{branchEnergyBalance.toLocaleString()}</p>
                        <p className="text-xs opacity-70 mt-2">收益</p>
                      </CardContent>
                    </Card>
                    <Card className="bg-gradient-to-br from-orange-500 to-red-500 text-white">
                      <CardContent className="pt-4">
                        <p className="text-sm opacity-80">待审核</p>
                        <p className="text-3xl font-bold mt-2">{providerEnergyRequests.filter(r => r.status === 'pending').length}</p>
                        <p className="text-xs opacity-70 mt-2">服务商申请</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* 服务商向分公司申请记录 */}
                  {providerEnergyRequests.length > 0 ? (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Badge className="bg-blue-600">服务商</Badge>
                          服务商向分公司申请收益
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {providerEnergyRequests.map((request, idx) => (
                            <div key={`per-${request.id}`} className="p-4 border rounded-lg">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="font-medium">{request.provider?.name || request.provider?.username || request.providerName || '服务商'}</p>
                                  <p className="text-sm text-gray-500 mt-1">申请额度: {(parseFloat(String(request.amount || request.requestedAmount || 0))).toLocaleString()} 收益</p>
                                  <p className="text-xs text-gray-400 mt-1">{request.created_at ? new Date(request.created_at).toLocaleString() : '-'}</p>
                                </div>
                                <div className="flex gap-2 items-center">
                                  {request.status === 'pending' ? (
                                    <>
                                      <Button size="sm" className="bg-green-600" onClick={() => handleApproveProviderEnergyRequestRequest(request.id, 'approve')} disabled={submitting}>通过</Button>
                                      <Button size="sm" variant="destructive" onClick={() => handleApproveProviderEnergyRequestRequest(request.id, 'reject')} disabled={submitting}>拒绝</Button>
                                    </>
                                  ) : (
                                    <Badge className={request.status === 'approved' ? 'bg-green-500' : 'bg-red-500'}>
                                      {request.status === 'approved' ? '已通过' : '已拒绝'}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card>
                      <CardContent className="py-8 text-center text-gray-500">
                        暂无需要审核的服务商申请
                      </CardContent>
                    </Card>
                  )}
                </>
              )}

              {/* 收益转账 */}
              {energySubTab === 'transfer' && (
                <>
                  {/* 操作说明 */}
                  <Card className="bg-purple-50 border-purple-200">
                    <CardContent className="pt-4">
                      <div className="text-sm text-purple-800 space-y-1">
                        <p><strong>转账规则：</strong></p>
                        <p>• 给服务商转账：直接转账，不扣手续费</p>
                        <p>• 给会员转账：直接转账，不扣手续费</p>
                        <p>• 同级分公司互转：不扣手续费</p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* 操作按钮 */}
                  <div className="flex gap-4">
                    <Button className="bg-purple-600" onClick={() => { loadTransferTargets(); loadBranchList(); }}>转账</Button>
                  </div>

                  {/* 转账区域 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Zap className="w-5 h-5 text-purple-600" />
                        转账给下级
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="mb-4 flex gap-2 flex-wrap">
                        <button
                          onClick={() => setTransferUserType('provider')}
                          className={`px-4 py-2 rounded-lg transition-colors ${
                            transferUserType === 'provider'
                              ? 'bg-purple-600 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          服务商 ({transferTargets.length})
                        </button>
                        <button
                          onClick={() => setTransferUserType('member')}
                          className={`px-4 py-2 rounded-lg transition-colors ${
                            transferUserType === 'member'
                              ? 'bg-purple-600 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          会员 ({transferMembers.length})
                        </button>
                        <button
                          onClick={() => setTransferUserType('branch')}
                          className={`px-4 py-2 rounded-lg transition-colors ${
                            transferUserType === 'branch'
                              ? 'bg-purple-600 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          同级分公司 ({branchList.length})
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-2">
                            选择{transferUserType === 'provider' ? '服务商' : transferUserType === 'member' ? '会员' : '分公司'}
                          </label>
                          <select
                            value={transferTarget}
                            onChange={(e) => setTransferTarget(e.target.value)}
                            className="w-full p-2 border rounded-lg"
                          >
                            <option value="">选择{transferUserType === 'provider' ? '服务商' : transferUserType === 'member' ? '会员' : '分公司'}</option>
                            {(transferUserType === 'provider' ? transferTargets : transferUserType === 'member' ? transferMembers : branchList).map((target) => (
                              <option key={target.id} value={target.id}>
                                {target.username} ({target.role === 'provider' ? '服务商' : target.role === 'member' ? '会员' : target.role === 'branch' ? '分公司' : target.role})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">转账金额</label>
                          <input
                            type="number"
                            value={transferAmount}
                            onChange={(e) => setTransferAmount(e.target.value)}
                            placeholder="输入转账金额"
                            className="w-full p-2 border rounded-lg"
                          />
                        </div>
                      </div>
                      <div className="mt-4">
                        <label className="block text-sm font-medium mb-2">备注</label>
                        <input
                          type="text"
                          value={transferNote}
                          onChange={(e) => setTransferNote(e.target.value)}
                          placeholder="备注说明（可选）"
                          className="w-full p-2 border rounded-lg"
                        />
                      </div>
                      <div className="mt-4 flex items-center justify-between">
                        <p className="text-sm text-gray-500">当前余额: {branchEnergyBalance.toLocaleString()} 收益</p>
                        <Button 
                          className="bg-purple-600"
                          onClick={() => handleTransfer(transferTarget, parseFloat(transferAmount))}
                          disabled={!transferTarget || !transferAmount || submitting}
                        >
                          确认转账
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          )}

          {/* 提现审核 Tab */}
          {activeTab === 'withdraw-review' && (
            <div className="space-y-3 md:space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ClipboardCheck className="w-5 h-5" />
                    提现审核
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {pendingWithdrawals.length > 0 ? (
                    <div className="space-y-4">
                      {pendingWithdrawals.map((w: any) => (
                        <div key={w.id} className="border rounded-lg p-4 bg-orange-50">
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <p className="font-medium">{w.user?.username || w.real_name || '用户'}</p>
                              <p className="text-sm text-gray-500">角色: {w.user_role === 'member' ? '会员' : w.user_role === 'provider' ? '服务商' : w.user_role}</p>
                              <p className="text-sm text-gray-500">手机: {w.user?.phone || '-'}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-xl font-bold text-orange-600">¥{Number(w.amount).toLocaleString()}</p>
                              <p className="text-xs text-gray-500">手续费: ¥{Number(w.fee).toLocaleString()}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                            <div className="text-gray-600"><span className="font-medium">支付宝:</span> {w.alipay_account || '-'}</div>
                            <div className="text-gray-600"><span className="font-medium">姓名:</span> {w.real_name || '-'}</div>
                          </div>
                          <div className="flex items-center gap-2 mb-2">
                            <Badge className={w.status === 'pending' ? 'bg-yellow-500' : w.status === 'approved' ? 'bg-blue-500' : w.status === 'transferred' ? 'bg-green-500' : 'bg-gray-500'}>
                              {w.status === 'pending' ? '待审核' : w.status === 'approved' ? '已审核' : w.status === 'transferred' ? '已打款' : w.status}
                            </Badge>
                          </div>
                          <div className="flex gap-2">
                            {w.status === 'pending' && (
                              <>
                                <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleReviewWithdrawal(w.id, 'approve')} disabled={submitting}>
                                  <CheckCircle className="w-4 h-4 mr-1" /> 审核通过
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => handleReviewWithdrawal(w.id, 'reject')} disabled={submitting}>
                                  <XCircle className="w-4 h-4 mr-1" /> 拒绝
                                </Button>
                              </>
                            )}
                            {w.status === 'approved' && (
                              <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => handleReviewWithdrawal(w.id, 'confirm_transfer')} disabled={submitting}>
                                <CheckCircle className="w-4 h-4 mr-1" /> 确认已转账
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-center py-8">暂无待审核的提现申请</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* 收益管理 Tab */}
          {activeTab === 'revenue' && (
            <div className="space-y-3 md:space-y-6">
              {/* 收益统计卡片 */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="bg-gradient-to-br from-green-500 to-emerald-600 text-white">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="w-5 h-5" />
                      <span className="text-sm opacity-80">累计收益</span>
                    </div>
                    <p className="text-2xl font-bold">¥{Number(branchRevenueStats.totalRevenue || 0).toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-5 h-5" />
                      <span className="text-sm opacity-80">会员提现收益</span>
                    </div>
                    <p className="text-2xl font-bold">¥{Number(branchRevenueStats.memberWithdraw || 0).toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Building2 className="w-5 h-5" />
                      <span className="text-sm opacity-80">服务商提现收益</span>
                    </div>
                    <p className="text-2xl font-bold">¥{Number(branchRevenueStats.providerWithdraw || 0).toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign className="w-5 h-5" />
                      <span className="text-sm opacity-80">市场费分润</span>
                    </div>
                    <p className="text-2xl font-bold">¥{Number(branchRevenueStats.marketFeeShare || 0).toLocaleString()}</p>
                  </CardContent>
                </Card>
              </div>

              {/* 操作区 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Banknote className="w-5 h-5" />
                    收益操作
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">可提现余额</p>
                      <p className="text-2xl font-bold text-green-600">¥{Number(branchRevenueStats.totalRevenue || 0).toLocaleString()}</p>
                    </div>
                    <div className="flex gap-2">
                      {/* 收益转收益按钮已禁用 */}
                      <Button
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => setShowBranchWithdrawDialog(true)}
                      >
                        <Banknote className="w-4 h-4 mr-1" /> 提现到总公司
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 收益记录列表 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <History className="w-5 h-5" />
                    收益记录
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {branchRevenueRecords.length > 0 ? (
                    <div className="space-y-2">
                      {branchRevenueRecords.map((r: any) => (
                        <div key={r.id} className="flex items-center justify-between border rounded-lg p-3 hover:bg-gray-50">
                          <div>
                            <p className="font-medium text-green-600">+¥{Number(r.amount).toLocaleString()}</p>
                            <p className="text-xs text-gray-500">
                              {r.type === 'member_withdraw' ? '会员提现' : 
                               r.type === 'provider_withdraw' ? '服务商提现' :
                               r.type === 'market_fee_share' ? '市场费分润(5%)' :
                               r.type === 'provider_upstream' ? '上级服务商分润(10%)' : r.type}
                            </p>
                            <p className="text-xs text-gray-400">{r.created_at ? new Date(r.created_at).toLocaleString() : '-'}</p>
                          </div>
                          <Badge className={r.status === 'received' ? 'bg-blue-100 text-blue-700' : r.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}>
                            {r.status === 'received' ? '已入账' : r.status === 'paid' ? '已支出' : r.status === 'completed' ? '已完成' : r.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-center py-8">暂无收益记录</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* 会员管理 */}
          {activeTab === 'members' && (
            <div className="space-y-3 md:space-y-6">
              {/* 统计卡片 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-5 h-5" />
                      <span className="text-sm opacity-80">会员总数</span>
                    </div>
                    <p className="text-2xl font-bold">{memberTotal}</p>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="w-5 h-5" />
                      <span className="text-sm opacity-80">收益总额</span>
                    </div>
                    <p className="text-2xl font-bold">{memberList.reduce((sum: number, m: any) => sum + (m.energyValue || 0), 0).toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Package className="w-5 h-5" />
                      <span className="text-sm opacity-80">持有算力额度</span>
                    </div>
                    <p className="text-2xl font-bold">¥{memberList.reduce((sum: number, m: any) => sum + (m.totalInvestment || 0), 0).toLocaleString()}</p>
                  </CardContent>
                </Card>
              </div>

              {/* 筛选栏 */}
              <Card>
                <CardContent className="pt-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm text-gray-500">按服务商筛选:</Label>
                      <select
                        className="border rounded-md px-3 py-1.5 text-sm bg-white"
                        value={memberFilterProvider}
                        onChange={(e) => {
                          const val = e.target.value;
                          setMemberFilterProvider(val);
                          loadMemberList(1, val);
                        }}
                      >
                        <option value="all">全部服务商</option>
                        {providers.map((p: any) => (
                          <option key={p.id} value={p.id}>{p.username}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-sm text-gray-500">搜索:</Label>
                      <Input
                        className="w-48"
                        placeholder="姓名/ID/手机号"
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                      />
                    </div>
                    <Button size="sm" variant="outline" onClick={() => loadMemberList(memberPage)}>
                      <RefreshCw className="w-4 h-4 mr-1" />刷新
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* 会员列表 */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5" />
                      会员列表 ({memberTotal})
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  {memberLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                      <span className="ml-2 text-gray-500">加载中...</span>
                    </div>
                  ) : (() => {
                    const filteredMembers = memberList.filter((m: any) => {
                      if (!memberSearch) return true;
                      const s = memberSearch.toLowerCase();
                      return (
                        (m.username || '').toLowerCase().includes(s) ||
                        (m.realName || '').toLowerCase().includes(s) ||
                        (m.uniqueId || '').toLowerCase().includes(s) ||
                        (m.phone || '').includes(s)
                      );
                    });

                    return filteredMembers.length === 0 ? (
                      <div className="py-12 text-center text-gray-500">
                        <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                        <p>暂无会员数据</p>
                      </div>
                    ) : (
                      <>
                        {/* 表头 */}
                        <div className="hidden md:grid grid-cols-12 gap-2 text-sm font-medium text-gray-500 pb-2 border-b">
                          <div className="col-span-2">姓名</div>
                          <div className="col-span-1">专属ID</div>
                          <div className="col-span-2">手机号</div>
                          <div className="col-span-2">隶属服务商</div>
                          <div className="col-span-1">收益</div>
                          <div className="col-span-2">持有算力额度</div>
                          <div className="col-span-2">操作</div>
                        </div>

                        {/* 会员行 */}
                        <div className="space-y-1">
                          {filteredMembers.map((m: any) => (
                            <div key={m.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 py-3 border-b last:border-b-0 items-center hover:bg-gray-50 rounded px-1">
                              {/* 姓名 */}
                              <div className="col-span-2">
                                <p className="font-medium">{m.realName || m.username || '-'}</p>
                                <p className="text-xs text-gray-400 md:hidden">手机: {m.phone || '-'}</p>
                              </div>
                              {/* 专属ID */}
                              <div className="col-span-1">
                                <span className="font-mono text-sm text-purple-600">{m.uniqueId || '-'}</span>
                              </div>
                              {/* 手机号 */}
                              <div className="col-span-2 hidden md:block">
                                <span className="text-sm">{m.phone || '-'}</span>
                              </div>
                              {/* 隶属服务商 */}
                              <div className="col-span-2 hidden md:block">
                                <Badge className="bg-blue-100 text-blue-700">{m.providerName || '-'}</Badge>
                              </div>
                              {/* 收益 */}
                              <div className="col-span-1 hidden md:block">
                                <span className="text-sm font-medium text-emerald-600">{(m.energyValue || 0).toLocaleString()}</span>
                              </div>
                              {/* 持有算力额度 */}
                              <div className="col-span-2 hidden md:block">
                                <div>
                                  <span className="text-sm font-semibold text-orange-600">¥{(m.totalInvestment || 0).toLocaleString()}</span>
                                  <span className="text-xs text-gray-400 ml-1">({m.holdingProducts || 0}个产品)</span>
                                </div>
                              </div>
                              {/* 操作 */}
                              <div className="col-span-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-7 text-orange-600 border-orange-200 hover:bg-orange-50"
                                  onClick={() => openMemberTransfer(m)}
                                >
                                  <ArrowRightLeft className="w-3 h-3 mr-0.5" />转移
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* 分页 */}
                        {memberTotalPages > 1 && (
                          <div className="flex items-center justify-between mt-4 pt-3 border-t">
                            <span className="text-sm text-gray-500">共 {memberTotal} 个会员，第 {memberPage}/{memberTotalPages} 页</span>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={memberPage <= 1}
                                onClick={() => loadMemberList(memberPage - 1)}
                              >
                                上一页
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={memberPage >= memberTotalPages}
                                onClick={() => loadMemberList(memberPage + 1)}
                              >
                                下一页
                              </Button>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </main>

      {/* 申请额度对话框 */}
      {showQuotaApplyDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-[500px]">
            <CardHeader>
              <CardTitle>向总公司申请额度</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>申请额度（元）</Label>
                <Input
                  type="number"
                  value={applyQuotaAmount}
                  onChange={(e) => setApplyQuotaAmount(e.target.value)}
                  placeholder="请输入申请额度"
                  className="mt-1"
                />
              </div>
              <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                <p className="font-medium mb-1">💡 配比说明</p>
                <p>分公司申请额度配比20%收益</p>
                <p className="text-xs mt-1">例如：申请100,000元额度，将配比20,000收益</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowQuotaApplyDialog(false)}>取消</Button>
                <Button 
                  className="bg-blue-600"
                  onClick={handleApplyQuota}
                  disabled={submitting}
                >
                  {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  提交申请
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 收益转账对话框 */}
      {showTransferDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-[500px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-blue-600" />
                收益转账
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-700">
                  <strong>说明：</strong>可向服务商和会员转账收益，最低转账金额为50。
                </p>
              </div>
              
              {/* 转账类型切换 */}
              <div className="flex gap-2">
                <Button
                  variant={transferUserType === 'provider' ? 'default' : 'outline'}
                  onClick={() => { setTransferUserType('provider'); setTransferUserId(''); }}
                  className={transferUserType === 'provider' ? 'bg-blue-600' : ''}
                >
                  转给服务商 ({transferTargets.length})
                </Button>
                <Button
                  variant={transferUserType === 'member' ? 'default' : 'outline'}
                  onClick={() => { setTransferUserType('member'); setTransferUserId(''); }}
                  className={transferUserType === 'member' ? 'bg-purple-600' : ''}
                >
                  转给会员 ({transferMembers.length})
                </Button>
              </div>
              
              <div>
                <Label>选择{transferUserType === 'provider' ? '服务商' : '会员'}</Label>
                <select
                  className="w-full mt-1 p-2 border rounded-md bg-white"
                  value={transferUserId}
                  onChange={(e) => setTransferUserId(e.target.value)}
                >
                  <option value="">请选择{transferUserType === 'provider' ? '服务商' : '会员'}</option>
                  {(transferUserType === 'provider' ? transferTargets : transferMembers).map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.username} {p.unique_id ? `[${p.unique_id}]` : ''} {p.phone ? `(${p.phone})` : ''}（收益: {p.energy_value || 0}）
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>转账金额</Label>
                <Input
                  type="number"
                  placeholder="请输入转账收益（最低50）"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  min="50"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>备注（可选）</Label>
                <Input
                  placeholder="如: 业务合作转账"
                  value={transferNote}
                  onChange={(e) => setTransferNote(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setShowTransferDialog(false)}>取消</Button>
                <Button 
                  className="bg-blue-600"
                  onClick={handleTransferEnergy}
                  disabled={submitting || !transferUserId || !transferAmount}
                >
                  {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                  确认转账
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 向总公司申请收益对话框 */}
      {showEnergyApplyDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md bg-white">
            <CardHeader>
              <CardTitle className="text-gray-900">向总公司申请收益</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="energyAmount" className="text-gray-700">申请金额</Label>
                <Input
                  id="energyAmount"
                  type="number"
                  value={energyApplyAmount}
                  onChange={(e) => setEnergyApplyAmount(e.target.value)}
                  placeholder="请输入申请金额"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="energyNote" className="text-gray-700">备注（可选）</Label>
                <Input
                  id="energyNote"
                  value={energyApplyNote}
                  onChange={(e) => setEnergyApplyNote(e.target.value)}
                  placeholder="请输入备注信息"
                  className="mt-1"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setShowEnergyApplyDialog(false)}>取消</Button>
                <Button
                  className="bg-purple-600 hover:bg-purple-700"
                  onClick={handleApplyEnergy}
                  disabled={submitting || !energyApplyAmount}
                >
                  {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                  确认申请
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 会员隶属关系转移对话框 */}
      {showMemberTransferDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-lg bg-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-gray-900">
                <ArrowRightLeft className="w-5 h-5 text-orange-500" />
                会员隶属关系转移
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 被转移会员信息 */}
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-sm font-medium text-gray-700 mb-2">转移会员</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                    <User className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="font-medium">{transferMemberInfo?.realName || transferMemberInfo?.username}</p>
                    <p className="text-xs text-gray-500">{transferMemberInfo?.uniqueId} | {transferMemberInfo?.phone}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  当前隶属: <span className="text-blue-600 font-medium">{transferMemberInfo?.providerName || '未知'}</span>
                </p>
              </div>

              {/* 目标服务商选择 */}
              <div>
                <Label className="text-gray-700">转移到服务商</Label>
                <select
                  className="w-full mt-1 p-2 border rounded-md text-sm"
                  value={transferTargetProvider}
                  onChange={(e) => {
                    setTransferTargetProvider(e.target.value);
                    setTransferPreview(null);
                  }}
                >
                  <option value="">请选择目标服务商</option>
                  {providers
                    .filter(p => p.id !== transferMemberInfo?.providerId)
                    .map(p => (
                      <option key={p.id} value={p.id}>{p.username}</option>
                    ))
                  }
                </select>
              </div>

              {/* 转移规则说明 */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-sm font-medium text-amber-700 mb-1">转移规则说明</p>
                <ul className="text-xs text-amber-600 space-y-1">
                  <li>• 会员及其整条直推链将一并转移到新服务商</li>
                  <li>• 转移后会员只能购买新服务商的产品</li>
                  <li>• 推荐关系（inviter_id）不变，推荐收益仍归原推荐人</li>
                  <li>• 持有产品的会员不能被转移，必须先清空持仓</li>
                  <li>• 目标服务商必须在同一分公司下</li>
                </ul>
              </div>

              {/* 预览结果 */}
              {transferPreview && (
                <div className={`rounded-lg p-3 ${transferPreview.error ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
                  {transferPreview.error ? (
                    <p className="text-sm text-red-600">{transferPreview.error}</p>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-green-700">转移预览</p>
                      <p className="text-sm text-green-600">将转移 <strong>{transferPreview.treeSize}</strong> 个会员到 <strong>{transferPreview.targetProviderName}</strong></p>
                      {transferPreview.treeUsers && transferPreview.treeUsers.length > 0 && (
                        <div className="mt-2 max-h-24 overflow-y-auto">
                          {transferPreview.treeUsers.map((u: any) => (
                            <p key={u.id} className="text-xs text-green-600">• {u.username}{u.unique_id ? ` [${u.unique_id}]` : ''}</p>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => { setShowMemberTransferDialog(false); setTransferPreview(null); }}>取消</Button>
                {!transferPreview ? (
                  <Button
                    className="bg-orange-500 hover:bg-orange-600"
                    onClick={previewMemberTransfer}
                    disabled={transferLoading || !transferTargetProvider}
                  >
                    {transferLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
                    预览转移
                  </Button>
                ) : !transferPreview.error ? (
                  <Button
                    className="bg-red-500 hover:bg-red-600"
                    onClick={confirmMemberTransfer}
                    disabled={transferLoading}
                  >
                    {transferLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                    确认转移
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 分公司提现到总公司对话框 */}
      {showBranchWithdrawDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Banknote className="w-5 h-5 text-green-500" />
                收益提现到总公司
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-green-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">当前收益余额</p>
                <p className="text-2xl font-bold text-green-600">¥{Number(branchRevenueStats.totalRevenue || 0).toLocaleString()}</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">提现金额</label>
                <Input
                  type="number"
                  placeholder="请输入提现金额（最低100）"
                  value={branchWithdrawAmount}
                  onChange={(e) => setBranchWithdrawAmount(e.target.value)}
                />
                {branchWithdrawAmount && (
                  <p className="text-sm text-gray-500 mt-1">
                    手续费5%: {(parseFloat(branchWithdrawAmount) * 0.05).toFixed(2)}元 | 实际到账: {(parseFloat(branchWithdrawAmount) * 0.95).toFixed(2)}元
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">支付宝账号</label>
                <Input
                  placeholder="请输入支付宝账号"
                  value={branchWithdrawAlipay}
                  onChange={(e) => setBranchWithdrawAlipay(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">支付宝姓名</label>
                <Input
                  placeholder="请输入支付宝实名姓名"
                  value={branchWithdrawRealName}
                  onChange={(e) => setBranchWithdrawRealName(e.target.value)}
                />
              </div>
              <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-600">
                <p>• 最低提现金额: ¥100</p>
                <p>• 提现手续费: 5%（沉淀到总公司）</p>
                <p>• 提交后等待总公司审核打款</p>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setShowBranchWithdrawDialog(false)}>取消</Button>
                <Button
                  className="bg-green-600 hover:bg-green-700"
                  onClick={handleBranchWithdrawToCompany}
                  disabled={submitting || !branchWithdrawAmount || parseFloat(branchWithdrawAmount) < 100}
                >
                  {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Banknote className="w-4 h-4 mr-2" />}
                  确认提现
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 收益转收益对话框 - 已禁用 */}
      {false && showConvertToEnergyDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-blue-500" />
                收益转收益
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">当前收益余额</p>
                <p className="text-2xl font-bold text-blue-600">¥{Number(branchRevenueStats.totalRevenue || 0).toLocaleString()}</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">转换金额</label>
                <Input
                  type="number"
                  placeholder="请输入转换金额（最低10）"
                  value={convertToEnergyAmount}
                  onChange={(e) => setConvertToEnergyAmount(e.target.value)}
                />
                {convertToEnergyAmount && parseFloat(convertToEnergyAmount) > 0 && (
                  <p className="text-sm text-gray-500 mt-1">
                    收益: ¥{(parseFloat(convertToEnergyAmount) * 0.95).toFixed(2)} | 积分(5%): ¥{(parseFloat(convertToEnergyAmount) * 0.05).toFixed(2)}
                  </p>
                )}
              </div>
              <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-600">
                <p>• 最低转换金额: ¥10</p>
                <p>• 转换比例: 95%转为收益，5%转为积分</p>
                <p>• 转换后收益可用于支付市场费</p>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => { setShowConvertToEnergyDialog(false); setConvertToEnergyAmount(''); }}>取消</Button>
                <Button
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={handleConvertToEnergy}
                  disabled={submitting || !convertToEnergyAmount || parseFloat(convertToEnergyAmount) < 10}
                >
                  {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                  确认转换
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
