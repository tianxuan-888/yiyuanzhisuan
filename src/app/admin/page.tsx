'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { BranchesManagement } from '@/components/admin/BranchesManagement';
import { ProviderManagement } from '@/components/admin/ProviderManagement';
import { MyProfile } from '@/components/admin/MyProfile';
import { 
  LayoutDashboard, 
  Database, 
  Building2, 
  UserCog, 
  Users, 
  Package, 
  Zap, 
  TrendingUp, 
  Wallet, 
  Settings,
  Loader2,
  Shield,
  ChevronUp,
  ChevronDown,
  ClipboardList,
  AlertCircle,
  CheckCircle,
  XCircle,
  FileText,
  RefreshCw,
  Download,
  Eye,
  Edit,
  DollarSign,
	  Percent,
  Printer,
  Home,
  Plus,
  X,
  ShoppingCart,
  TrendingDown,
  BarChart3,
  PieChart as PieChartIcon,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRightLeft,
  MessageSquare,
  Trash2,
  Clock,
  AlertTriangle,
  User,
  Key,
  FileCheck,
  Cpu,
  Search,
  Ticket,
  Network,
  Briefcase,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from 'recharts';

// 菜单类型
type MenuItem = {
  id: string;
  name: string;
  icon: React.ReactNode;
  children?: { id: string; name: string }[];
};

// 导航菜单配置
const menuItems: MenuItem[] = [
  { id: 'my-profile', name: '我的', icon: <User className="w-5 h-5" /> },
  { id: 'release', name: '收益记录', icon: <TrendingUp className="w-5 h-5" /> },
  { id: 'quota', name: 'Token额度管理', icon: <Database className="w-5 h-5" /> },
  { id: 'withdraw', name: '提现审核', icon: <Wallet className="w-5 h-5" /> },
  { id: 'accounts', name: '账户管理', icon: <Users className="w-5 h-5" /> },
];

// 统计数据类型
interface Stats {
  branch_count: number;
  provider_count: number;
  member_count: number;
  total_energy: number;
  total_member_balance: number;
  pending_sell_count: number;
  pending_withdrawal_count: number;
  total_orders: number;
  total_revenue: number;
  today_orders: number;
  today_revenue: number;
}

// 会员类型
interface Member {
  id: string;
  username: string;
  phone?: string;
  real_name?: string;
  energy_value: number;
  balance: number;
  is_active: boolean;
  created_at: string;
  provider_id?: string;
  inviter_id?: string;
}

// 订单类型
interface Order {
  id: string;
  user_id: string;
  username: string;
  product_name: string;
  order_type: string;
  amount: number;
  status: string;
  created_at: string;
}

// 提现记录
interface Withdrawal {
  id: string;
  user_id: string;
  username: string;
  amount: number;
  alipay_account: string;
  status: string;
  created_at: string;
}

// 服务商
interface Provider {
  id: string;
  username: string;
  quota: number;
  used_quota: number;
  total_sales: number;
  member_count: number;
  status: string;
  created_at: string;
}

// 算力模板
interface ProductTemplate {
  id: string;
  name: string;
  code: string;
  period: number;
  total_rate: number;
  market_rate: number;
  profit_rate: number;
  status: string;
}

export default function AdminPage() {
  const { user, loading: authLoading, logout } = useAuth('admin');

  // 移动端侧边栏状态
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 算力额度管理子Tab
  const [quotaSubTab, setQuotaSubTab] = useState<'overview' | 'templates' | 'records' | 'requests'>('overview');

  // 菜单状态
  const [activeMenu, setActiveMenu] = useState('overview');
  const [expandedMenus, setExpandedMenus] = useState<string[]>(['orders', 'reports']);
  
  // 数据状态
  const [stats, setStats] = useState<Stats>({
    branch_count: 0,
    provider_count: 0,
    member_count: 0,
    total_energy: 0,
    total_member_balance: 0,
    pending_sell_count: 0,
    pending_withdrawal_count: 0,
    total_orders: 0,
    total_revenue: 0,
    today_orders: 0,
    today_revenue: 0,
  });
  const [members, setMembers] = useState<Member[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [templates, setTemplates] = useState<ProductTemplate[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [quotaRequests, setQuotaRequests] = useState<any[]>([]);
  const [adminData, setAdminData] = useState<any>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [branchWithdrawals, setBranchWithdrawals] = useState<any[]>([]);
  
  // 数据总览子 Tab 状态
  const [overviewTab, setOverviewTab] = useState<'product' | 'user' | 'energy'>('product');
  const [overviewData, setOverviewData] = useState<any>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  
  // 算力额度管理子 Tab 状态
  const [quotaAccounts, setQuotaAccounts] = useState<any[]>([]);
  const [quotaRecords, setQuotaRecords] = useState<any[]>([]);
  const [quotaStats, setQuotaStats] = useState({ totalIssued: 0, totalIdle: 0, totalUsed: 0 });

  // 释放收益记录相关state
  const [releaseRecords, setReleaseRecords] = useState<any[]>([]);
  const [releaseLoading, setReleaseLoading] = useState(false);
  const [releaseDateRange, setReleaseDateRange] = useState<{start: string; end: string}>({start: '', end: ''});

  // 人员账户Tab
  const [accountsTab, setAccountsTab] = useState('branches');
  
  // 算力额度对话框状态
  const [showCreateQuotaDialog, setShowCreateQuotaDialog] = useState(false);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createQuotaAmount, setCreateQuotaAmount] = useState('');
  const [createQuotaNote, setCreateQuotaNote] = useState('');
  const [createEnergyAmount, setCreateEnergyAmount] = useState('');
  const [createEnergyNote, setCreateEnergyNote] = useState('');
  const [transferTo, setTransferTo] = useState('');
  
  // 市场费分配子 Tab 状态
  const [incomeTab, setIncomeTab] = useState<'overview' | 'detail' | 'withdraw' | 'provider' | 'member' | 'branch'>('overview');
  const [incomeStats, setIncomeStats] = useState<any>({
    totalIncome: 0,
    todayIncome: 0,
    pendingSettlement: 0,
    distributed: 0,
    totalOrders: 0,
    todayOrders: 0,
    totalSales: 0,
    todaySales: 0,
  });
  const [shareBreakdown, setShareBreakdown] = useState<any>({
    provider: { amount: 0, rate: '70%' },
    directReward: { amount: 0, rate: '10%' },
    parentProvider: { amount: 0, rate: '10%' },
    branch: { amount: 0, rate: '5%' },
    company: { amount: 0, rate: '5%' },
  });
  const [incomeRecords, setIncomeRecords] = useState<any[]>([]);
  const [providerIncome, setProviderIncome] = useState<any[]>([]);
  const [memberIncome, setMemberIncome] = useState<any[]>([]);
  const [branchIncome, setBranchIncome] = useState<any[]>([]);
  const [incomeLoading, setIncomeLoading] = useState(false);
  const [incomeTypeFilter, setIncomeTypeFilter] = useState('all');
  const [withdrawStats, setWithdrawStats] = useState<any>({
    pendingCount: 0, pendingAmount: 0, approvedAmount: 0, actualPaid: 0, todayAmount: 0, totalRequests: 0,
  });
  const [withdrawList, setWithdrawList] = useState<any[]>([]);

  const [transferAmount, setTransferAmount] = useState('');
  const [transferNote, setTransferNote] = useState('');
  
  // 搜索和筛选
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  
  // 对话框状态
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templateForm, setTemplateForm] = useState({
    name: '',
    code: '',
    period: '7',
    total_rate: '10',
    market_rate: '5',
    profit_rate: '5',
    min_quota: 0,
  });
  
  // 消息提示
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 会员管理相关状态
  const [memberTab, setMemberTab] = useState<'upgrade' | 'energy' | 'stats' | 'users'>('upgrade');
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [memberStats, setMemberStats] = useState<any>(null);
  const [memberStatsLoading, setMemberStatsLoading] = useState(false);
  const [showEnergyAdjustDialog, setShowEnergyAdjustDialog] = useState(false);
  const [showEnergyRecordDialog, setShowEnergyRecordDialog] = useState(false);
  const [energyAdjustTarget, setEnergyAdjustTarget] = useState<any>(null);
  const [energyAdjustAmount, setEnergyAdjustAmount] = useState('');
  const [energyAdjustNote, setEnergyAdjustNote] = useState('');
  const [energyAdjustType, setEnergyAdjustType] = useState<'add' | 'deduct'>('add');
  const [energyRecordList, setEnergyRecordList] = useState<any[]>([]);
  const [energyRecordLoading, setEnergyRecordLoading] = useState(false);

  // 提现管理相关状态（提升到顶层避免 Hooks 规则违反）
  const [withdrawTab, setWithdrawTab] = useState<'deposit' | 'records'>('deposit');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [withdrawNote, setWithdrawNote] = useState('');

  // 市场费分配相关状态
  const [energyTab, setEnergyTab] = useState<'overview' | 'accounts' | 'transactions' | 'request' | 'withdraw'>('overview');
  const [energyData, setEnergyData] = useState<any>(null);
  const [energyAccounts, setEnergyAccounts] = useState<any[]>([]);
  const [energyTransactions, setEnergyTransactions] = useState<any[]>([]);
  const [energyLoading, setEnergyLoading] = useState(false);
  const [showReleaseDialog, setShowReleaseDialog] = useState(false);
  const [releaseForm, setReleaseForm] = useState({ toUserId: '', amount: '', note: '' });
  const [energyTransactionType, setEnergyTransactionType] = useState<string>('all');
  const [branchEnergyRequests, setBranchEnergyRequests] = useState<any[]>([]);
  const [branchEnergyPendingCount, setBranchEnergyPendingCount] = useState(0);

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

  // 系统配置类型
  type SystemConfig = Record<string, string>;

  // 系统配置 state
  const [systemConfig, setSystemConfig] = useState<SystemConfig>({});
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [systemSubTab, setSystemSubTab] = useState<'config' | 'data' | 'assign-role' | 'invite-code'>('config');
  
  // 数据清除 state
  const [clearDataPassword, setClearDataPassword] = useState('');
  const [clearDataLoading, setClearDataLoading] = useState(false);
  const [clearDataMessage, setClearDataMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

  // 账号赋权 state
  const [assignSearchKeyword, setAssignSearchKeyword] = useState('');
  const [assignSearchResults, setAssignSearchResults] = useState<any[]>([]);
  const [assignSearching, setAssignSearching] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignMessage, setAssignMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

  // 智算总台邀请码 state
  const [adminInviteCode, setAdminInviteCode] = useState('');
  const [inviteCodeLoading, setInviteCodeLoading] = useState(false);
  const [inviteCodeMessage, setInviteCodeMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

  // 加载系统配置
  const loadSystemConfig = useCallback(async () => {
    const token = localStorage.getItem('token');
    setConfigLoading(true);
    try {
      const res = await fetch('/api/admin/system-config', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setSystemConfig(data.data || {});
      }
    } catch (error) {
      console.error('加载系统配置失败:', error);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  // 保存配置
  const saveSystemConfig = useCallback(async () => {
    const token = localStorage.getItem('token');
    setConfigSaving(true);
    try {
      const res = await fetch('/api/admin/system-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ config: systemConfig })
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: '配置保存成功' });
      } else {
        setMessage({ type: 'error', text: data.error || '保存失败' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: '保存失败' });
    } finally {
      setConfigSaving(false);
    }
  }, [systemConfig]);

  // 配置变更处理
  const handleConfigChange = (key: string, value: string) => {
    setSystemConfig(prev => ({ ...prev, [key]: value }));
  };

  // 搜索用户（账号赋权用）
  const searchUsersForAssign = useCallback(async () => {
    if (!assignSearchKeyword || assignSearchKeyword.length < 2) return;
    setAssignSearching(true);
    setAssignMessage(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/assign-role?keyword=${encodeURIComponent(assignSearchKeyword)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setAssignSearchResults(data.data || []);
        if (data.data.length === 0) {
          setAssignMessage({ type: 'error', text: '未找到匹配的用户' });
        }
      } else {
        setAssignMessage({ type: 'error', text: data.error || '搜索失败' });
      }
    } catch (e) {
      setAssignMessage({ type: 'error', text: '搜索失败，请重试' });
    } finally {
      setAssignSearching(false);
    }
  }, [assignSearchKeyword]);

  // 赋权操作
  const handleAssignRole = useCallback(async (userId: string, targetRole: string, username: string) => {
    setAssignLoading(true);
    setAssignMessage(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/assign-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId, targetRole, adminId: user?.id })
      });
      const data = await res.json();
      if (data.success) {
        const roleLabels: Record<string, string> = { admin: '智算总台', branch: '服务网点', provider: '服务商', member: '会员' };
        setAssignMessage({ type: 'success', text: `已将用户 ${username} 角色变更为${roleLabels[targetRole]}` });
        // 刷新搜索结果
        searchUsersForAssign();
      } else {
        setAssignMessage({ type: 'error', text: data.error || '赋权失败' });
      }
    } catch (e) {
      setAssignMessage({ type: 'error', text: '赋权失败，请重试' });
    } finally {
      setAssignLoading(false);
    }
  }, [user, searchUsersForAssign]);

  // 加载/生成智算总台邀请码
  const loadAdminInviteCode = useCallback(async () => {
    setInviteCodeLoading(true);
    setInviteCodeMessage(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/invite-codes/generate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setAdminInviteCode(data.data.invite_code);
      } else {
        setInviteCodeMessage({ type: 'error', text: data.error || '获取邀请码失败' });
      }
    } catch (e) {
      setInviteCodeMessage({ type: 'error', text: '获取邀请码失败' });
    } finally {
      setInviteCodeLoading(false);
    }
  }, []);

  // 清除收益数据
  const handleClearEnergyData = async () => {
    if (clearDataPassword !== 'admin123') {
      setClearDataMessage({ type: 'error', text: '密码错误，请重试！' });
      return;
    }
    
    if (!confirm('确定要清除所有收益数据吗？此操作不可恢复！')) {
      return;
    }
    
    setClearDataLoading(true);
    setClearDataMessage(null);
    
    try {
      const res = await authFetch('/api/admin/clear-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'energy', password: clearDataPassword })
      });
      const data = await res.json();
      
      if (data.success) {
        setClearDataMessage({ type: 'success', text: '收益数据已清除！' });
        setClearDataPassword('');
      } else {
        setClearDataMessage({ type: 'error', text: data.error || '操作失败' });
      }
    } catch (error) {
      setClearDataMessage({ type: 'error', text: '网络错误，请重试' });
    } finally {
      setClearDataLoading(false);
    }
  };

  // 清除算力额度数据
  const handleClearQuotaData = async () => {
    if (clearDataPassword !== 'admin123') {
      setClearDataMessage({ type: 'error', text: '密码错误，请重试！' });
      return;
    }
    
    if (!confirm('确定要清除所有算力额度数据吗？此操作不可恢复！')) {
      return;
    }
    
    setClearDataLoading(true);
    setClearDataMessage(null);
    
    try {
      const res = await authFetch('/api/admin/clear-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'quota', password: clearDataPassword })
      });
      const data = await res.json();
      
      if (data.success) {
        setClearDataMessage({ type: 'success', text: '算力额度数据已清除！' });
        setClearDataPassword('');
      } else {
        setClearDataMessage({ type: 'error', text: data.error || '操作失败' });
      }
    } catch (error) {
      setClearDataMessage({ type: 'error', text: '网络错误，请重试' });
    } finally {
      setClearDataLoading(false);
    }
  };

  // 一键清除所有业务数据
  const handleClearAllData = async () => {
    if (clearDataPassword !== 'admin123') {
      setClearDataMessage({ type: 'error', text: '密码错误，请重试！' });
      return;
    }
    
    if (!confirm('⚠️ 警告：即将清除所有业务数据（收益、算力额度、产品、订单等），用户账号将保留。\n\n此操作不可恢复，确定继续吗？')) {
      return;
    }
    
    setClearDataLoading(true);
    setClearDataMessage(null);
    
    try {
      const res = await authFetch('/api/admin/clear-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'all', password: clearDataPassword })
      });
      const data = await res.json();
      
      if (data.success) {
        setClearDataMessage({ type: 'success', text: '所有业务数据已清除！收益和算力额度统计将显示为0。' });
        setClearDataPassword('');
      } else {
        setClearDataMessage({ type: 'error', text: data.error || '操作失败' });
      }
    } catch (error) {
      setClearDataMessage({ type: 'error', text: '网络错误，请重试' });
    } finally {
      setClearDataLoading(false);
    }
  };

  // 加载数据
  const loadData = useCallback(async () => {
    try {
      const [membersRes, ordersRes, templatesRes] = await Promise.all([
        authFetch('/api/admin/members'),
        authFetch('/api/admin/orders'),
        authFetch('/api/product-templates'),
      ]);

      const membersData = await membersRes.json();
      const ordersData = await ordersRes.json();
      const templatesData = await templatesRes.json();

      if (membersData.success) {
        setMembers(membersData.data || []);
        const providerCount = new Set(membersData.data?.filter((m: Member) => m.provider_id).map((m: Member) => m.provider_id)).size;
        setStats(prev => ({
          ...prev,
          member_count: membersData.data?.length || 0,
          provider_count: providerCount || 0,
          total_energy: membersData.data?.reduce((sum: number, m: Member) => sum + (m.energy_value || 0), 0) || 0,
          total_member_balance: membersData.data?.reduce((sum: number, m: Member) => sum + (m.balance || 0), 0) || 0,
        }));
      }

      if (ordersData.success) {
        setOrders(ordersData.data || []);
        const completedOrders = ordersData.data?.filter((o: Order) => o.status === 'completed') || [];
        setStats(prev => ({
          ...prev,
          total_orders: ordersData.data?.length || 0,
          total_revenue: completedOrders.reduce((sum: number, o: Order) => sum + (o.amount || 0), 0),
          pending_sell_count: ordersData.data?.filter((o: Order) => o.status === 'pending').length || 0,
        }));
      }

      if (templatesData.success) {
        setTemplates(templatesData.data || []);
      }

      // 模拟提现数据
      setWithdrawals([
        { id: '1', user_id: 'u1', username: 'test_user', amount: 5000, alipay_account: 'test@alipay.com', status: 'pending', created_at: '2026-04-02 10:00:00' },
        { id: '2', user_id: 'u2', username: 'member001', amount: 10000, alipay_account: 'member@alipay.com', status: 'pending', created_at: '2026-04-02 09:30:00' },
      ]);

      // 获取服务商列表
      try {
        const providersRes = await authFetch('/api/admin/provider-management');
        const providersData = await providersRes.json();
        if (providersData.success) {
          setProviders(providersData.data?.providers || []);
        }
      } catch (e) {
        console.error('获取服务商列表失败:', e);
      }

      // 获取服务网点列表
      try {
        const branchesRes = await authFetch('/api/admin/users?role=branch');
        const branchesData = await branchesRes.json();
        if (branchesData.success) {
          setBranches(branchesData.data || []);
        }
      } catch (e) {
        console.error('获取服务网点列表失败:', e);
      }

      // 获取额度申请
      try {
        const quotaRes = await authFetch('/api/quota-requests?status=pending&requesterType=branch');
        const quotaData = await quotaRes.json();
        if (quotaData.success) {
          setQuotaRequests(quotaData.data || []);
        }
      } catch (e) {
        console.error('获取额度申请失败:', e);
      }

      // 获取服务网点变现申请（智算总台审核）
      try {
        const withdrawRes = await authFetch('/api/admin/branch-withdraw-list');
        const withdrawData = await withdrawRes.json();
        if (withdrawData.success) {
          // API返回格式: { records: [...], stats: {...} }
          setBranchWithdrawals(withdrawData.data?.records || []);
        }
      } catch (e) {
        console.error('获取服务网点变现申请失败:', e);
      }

      // 获取管理员额度信息
      try {
        const adminId = localStorage.getItem('userId');
        if (adminId) {
          const adminRes = await authFetch(`/api/quota?userId=${adminId}`);
          const adminDataRes = await adminRes.json();
          if (adminDataRes.success) {
            setAdminData(adminDataRes.data);
          }
        }
      } catch (e) {
        console.error('获取管理员额度失败:', e);
      }

      // 获取算力额度数据（添加时间戳防止缓存）
      try {
        const ts = Date.now();
        const [accountsRes, recordsRes] = await Promise.all([
          authFetch(`/api/quota-accounts?_=${ts}`),
          authFetch(`/api/quota-records?_=${ts}`),
        ]);
        const accountsData = await accountsRes.json();
        const recordsData = await recordsRes.json();
        
        if (accountsData.success) {
          setQuotaAccounts(accountsData.data || []);
        } else {
          console.error('获取额度账户失败:', accountsData.error);
        }
        if (recordsData.success) {
          setQuotaRecords(recordsData.data || []);
          setQuotaStats(recordsData.stats || { totalIssued: 0, totalIdle: 0, totalUsed: 0 });
        }
      } catch (e) {
        console.error('获取算力额度数据失败:', e);
      }

      // 生成图表数据
      const days = ['04-01', '04-02', '04-03', '04-04', '04-05', '04-06', '04-07'];
      const chartDataGenerated = days.map((day) => ({
        date: `2025年${day}`,
        订单金额: Math.floor(Math.random() * 3000000 + 500000),
        收益金额: Math.floor(Math.random() * 2000000 + 300000),
        订单数: Math.floor(Math.random() * 100 + 50),
        新用户: Math.floor(Math.random() * 30 + 10),
      }));
      setChartData(chartDataGenerated);

    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载市场费分配数据
  const loadIncomeData = useCallback(async (subType: string = 'overview') => {
    try {
      setIncomeLoading(true);
      const res = await authFetch(`/api/admin/income-stats?subType=${subType}`);
      const data = await res.json();
      if (data.success) {
        if (subType === 'overview') {
          setIncomeStats({
            totalIncome: data.data.summary.totalIncome || 0,
            todayIncome: data.data.summary.todayIncome || 0,
            pendingSettlement: data.data.summary.pendingSettlement || 0,
            distributed: data.data.summary.distributed || 0,
            totalOrders: data.data.summary.totalOrders || 0,
            todayOrders: data.data.summary.todayOrders || 0,
            totalSales: data.data.summary.totalSales || 0,
            todaySales: data.data.summary.todaySales || 0,
          });
          // 更新真实分配数据
          if (data.data.shareBreakdown) {
            setShareBreakdown(data.data.shareBreakdown);
          }
          // 更新收益趋势图表
          if (data.data.trend?.length > 0) {
            setChartData(data.data.trend.map((t: any) => ({
              date: t.date,
              收益金额: t.marketFee,
              订单金额: t.sales,
              订单数: t.orders,
            })));
          }
        } else if (subType === 'detail') {
          setIncomeRecords(data.data.records || []);
        } else if (subType === 'withdraw') {
          // 提现数据从 energy_withdraw_requests 加载
          if (data.data.stats) {
            setWithdrawStats(data.data.stats);
          }
          if (data.data.withdrawList) {
            setWithdrawList(data.data.withdrawList);
          }
        }
      }
    } catch (e) {
      console.error('获取收益数据失败:', e);
    } finally {
      setIncomeLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!authLoading && user) {
      loadData();
    }
  }, [authLoading, user, loadData]);

  // 市场费分配 tab 切换时加载数据
  useEffect(() => {
    if (activeMenu === 'income' && user) {
      loadIncomeData(incomeTab === 'withdraw' ? 'withdraw' : incomeTab === 'detail' ? 'detail' : 'overview');
    }
  }, [activeMenu, incomeTab, user, loadIncomeData]);

  // 系统设置 tab 切换时加载配置
  useEffect(() => {
    if (activeMenu === 'settings') {
      loadSystemConfig();
    }
  }, [activeMenu, loadSystemConfig]);

  // 切换菜单展开
  const toggleMenu = (menuId: string) => {
    setExpandedMenus(prev => 
      prev.includes(menuId) 
        ? prev.filter(id => id !== menuId)
        : [...prev, menuId]
    );
  };

  // 选择菜单
  const selectMenu = (menuId: string) => {
    setActiveMenu(menuId);
    
    // 如果选择数据总览，加载数据
    if (menuId === 'overview' || menuId.startsWith('overview-')) {
      loadOverviewData();
    }
  };
  
  // 加载数据总览数据
  const loadOverviewData = async () => {
    setOverviewLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await authFetch('/api/admin/overview');
      const data = await response.json();
      if (data.success) {
        setOverviewData(data.data);
      }
    } catch (error) {
      console.error('加载数据总览失败:', error);
    } finally {
      setOverviewLoading(false);
    }
  };

  // 加载服务网点收益申请 pending 数量
  const loadBranchEnergyPendingCount = async () => {
    try {
      const response = await authFetch('/api/energy/branch-request?status=pending');
      const data = await response.json();
      if (data.success) {
        setBranchEnergyPendingCount(data.data?.stats?.pending?.count || 0);
      }
    } catch (error) {
      console.error('加载待审核申请数量失败:', error);
    }
  };

  // 格式化金额（转换为万）
  const formatWan = (amount: number | string | undefined | null) => {
    const num = Number(amount) || 0;
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + '万';
    }
    return num.toLocaleString();
  };

  // 加载所有用户列表
  const loadAllUsers = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await authFetch('/api/admin/all-users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        setAllUsers(data.data || []);
      }
    } catch (error) {
      console.error('加载用户列表失败:', error);
    }
  };

  // 重置用户密码
  const handleResetPassword = async (userId: string, username: string) => {
    if (!confirm(`确定要重置用户 "${username}" 的密码吗？\n重置后密码将变为: 123456`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await authFetch('/api/admin/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ userId })
      });
      const data = await response.json();
      if (data.success) {
        showMessage('success', `用户 ${username} 的密码已重置为 123456`);
        loadAllUsers(); // 刷新列表
      } else {
        showMessage('error', data.error || '重置失败');
      }
    } catch (error) {
      showMessage('error', '重置密码失败');
    }
  };

  // 显示消息
  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  // 审批额度申请
  const handleApproveQuotaRequest = async (requestId: string) => {
    const adminId = localStorage.getItem('userId');
    if (!adminId) return;

    setSubmitting(true);
    try {
      const response = await authFetch('/api/quota-requests/review', {
        method: 'POST',
        body: JSON.stringify({
          requestId,
          reviewerId: adminId,
          action: 'approve',
        }),
      });

      const data = await response.json();

      if (data.success) {
        showMessage('success', data.message || '额度申请已通过');
        loadData();
      } else {
        showMessage('error', data.error || '审批失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 拒绝额度申请
  const handleRejectQuotaRequest = async (requestId: string) => {
    const adminId = localStorage.getItem('userId');
    if (!adminId) return;

    const reason = prompt('请输入拒绝原因:');
    if (!reason) return;

    setSubmitting(true);
    try {
      const response = await authFetch('/api/quota-requests/review', {
        method: 'POST',
        body: JSON.stringify({
          requestId,
          reviewerId: adminId,
          action: 'reject',
          rejectReason: reason,
        }),
      });

      const data = await response.json();

      if (data.success) {
        showMessage('success', '额度申请已拒绝');
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

  // 加载收益总览数据
  const loadEnergyOverview = async () => {
    setEnergyLoading(true);
    try {
      const response = await authFetch('/api/energy?type=all');
      const data = await response.json();
      if (data.success) {
        setEnergyData(data.data);
      }
    } catch (error) {
      console.error('加载收益总览失败:', error);
    } finally {
      setEnergyLoading(false);
    }
  };

  // 加载收益账户列表
  const loadEnergyAccounts = async () => {
    setEnergyLoading(true);
    try {
      const response = await authFetch('/api/energy-accounts');
      const data = await response.json();
      if (data.success) {
        setEnergyAccounts(data.data?.accounts || []);
      }
    } catch (error) {
      console.error('加载收益账户失败:', error);
    } finally {
      setEnergyLoading(false);
    }
  };

  // 加载收益流水记录
  const loadEnergyTransactions = async (type?: string) => {
    setEnergyLoading(true);
    try {
      const url = type && type !== 'all' ? `/api/energy-transactions?type=${type}` : '/api/energy-transactions';
      const response = await authFetch(url);
      const data = await response.json();
      if (data.success) {
        setEnergyTransactions(data.data?.transactions || []);
      }
    } catch (error) {
      console.error('加载收益流水失败:', error);
    } finally {
      setEnergyLoading(false);
    }
  };

  // 释放收益给服务网点
  const handleReleaseEnergy = async () => {
    const adminId = localStorage.getItem('userId');
    if (!adminId || !releaseForm.toUserId || !releaseForm.amount) {
      showMessage('error', '请填写完整信息');
      return;
    }

    setSubmitting(true);
    try {
      const response = await authFetch('/api/energy/manual-release', {
        method: 'POST',
        body: JSON.stringify({
          fromUserId: adminId,
          toUserId: releaseForm.toUserId,
          amount: Number(releaseForm.amount),
          note: releaseForm.note,
        }),
      });

      const data = await response.json();
      if (data.success) {
        showMessage('success', '收益释放成功');
        setShowReleaseDialog(false);
        setReleaseForm({ toUserId: '', amount: '', note: '' });
        loadEnergyOverview();
      } else {
        showMessage('error', data.error || '操作失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 创建算力模板
  const handleCreateTemplate = async () => {
    setSubmitting(true);
    try {
      const response = await authFetch('/api/product-templates', {
        method: 'POST',
        body: JSON.stringify(templateForm),
      });

      const data = await response.json();

      if (data.success) {
        showMessage('success', '算力模板创建成功');
        setShowTemplateDialog(false);
        setTemplateForm({
          name: '',
          code: '',
          period: '7',
          total_rate: '10',
          market_rate: '5',
          profit_rate: '5',
          min_quota: 0,
        });
        loadData();
      } else {
        showMessage('error', data.error || '创建失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 创建收益
  const handleCreateEnergy = async () => {
    if (!createEnergyAmount || Number(createEnergyAmount) <= 0) {
      showMessage('error', '请输入有效的收益金额');
      return;
    }

    setSubmitting(true);
    try {
      const adminId = localStorage.getItem('userId');
      const response = await authFetch('/api/energy/admin-create', {
        method: 'POST',
        body: JSON.stringify({
          userId: adminId,
          amount: Number(createEnergyAmount),
          note: createEnergyNote,
        }),
      });

      const data = await response.json();

      if (data.success) {
        showMessage('success', data.message || '收益创建成功');
        setShowCreateDialog(false);
        setCreateEnergyAmount('');
        setCreateEnergyNote('');
        loadEnergyOverview();
        loadEnergyAccounts();
      } else {
        showMessage('error', data.error || '创建失败');
      }
    } catch (error) {
      showMessage('error', '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  // 认证加载中
  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-purple-900 flex items-center justify-center">
        <Loader2 className="w-16 h-16 text-white animate-spin" />
      </div>
    );
  }

  // 渲染左侧导航
  const renderSidebar = () => (
    <>
      {/* 移动端遮罩 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-purple-900 min-h-screen flex flex-col transform transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      {/* Logo */}
      <div className="p-6 border-b border-purple-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">算力中心</h1>
            <p className="text-xs text-purple-300">Order Snatching Center</p>
          </div>
        </div>
      </div>

      {/* 导航菜单 */}
      <nav className="flex-1 py-4 overflow-y-auto">
        {menuItems.map(menu => (
          <div key={menu.id}>
            <div
              onClick={() => {
                if (menu.children) {
                  toggleMenu(menu.id);
                } else {
                  selectMenu(menu.id);
                  setSidebarOpen(false);
                }
              }}
              className={`flex items-center justify-between px-6 py-3 cursor-pointer transition-colors ${
                activeMenu === menu.id ? 'bg-purple-700 text-white' : 'text-purple-200 hover:bg-purple-800 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                {menu.icon}
                <span>{menu.name}</span>
              </div>
              {menu.children && (
                expandedMenus.includes(menu.id) 
                  ? <ChevronUp className="w-4 h-4" />
                  : <ChevronDown className="w-4 h-4" />
              )}
            </div>
            {/* 子菜单 */}
            {menu.children && expandedMenus.includes(menu.id) && (
              <div className="bg-purple-950">
                {menu.children.map(child => (
                  <div
                    key={child.id}
                    onClick={() => { selectMenu(child.id); setSidebarOpen(false); }}
                    className={`pl-14 pr-6 py-2 cursor-pointer transition-colors ${
                      activeMenu === child.id ? 'bg-purple-600 text-white' : 'text-purple-300 hover:bg-purple-800 hover:text-white'
                    }`}
                  >
                    {child.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* 底部信息 */}
      <div className="p-4 border-t border-purple-700">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-white text-sm font-medium">智算总台</p>
            <p className="text-purple-300 text-xs">管理员</p>
          </div>
        </div>
        <Button onClick={logout} variant="ghost" className="w-full text-purple-200 hover:bg-purple-800 hover:text-white">
          退出登录
        </Button>
      </div>
      </aside>
    </>
  );

  // 渲染主页内容
  const renderHomeContent = () => (
    <div className="space-y-3 md:space-y-6">
      {/* 数据卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
        <Card className="mobile-compact-card bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">服务商数量</p>
                <p className="text-3xl font-bold mobile-num">{stats.provider_count}</p>
              </div>
              <UserCog className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="mobile-compact-card bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">会员数量</p>
                <p className="text-3xl font-bold mobile-num">{stats.member_count}</p>
              </div>
              <Users className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="mobile-compact-card bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">总收益</p>
                <p className="text-3xl font-bold mobile-num">{stats.total_energy.toLocaleString()}</p>
              </div>
              <TrendingUp className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="mobile-compact-card bg-gradient-to-br from-green-500 to-green-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">总订单数</p>
                <p className="text-3xl font-bold mobile-num">{stats.total_orders}</p>
              </div>
              <ClipboardList className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  // 渲染数据总览内容
  const renderOverviewContent = () => {
    if (overviewLoading) {
      return (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
        </div>
      );
    }
    
    return (
      <div className="space-y-3 md:space-y-6">
        {/* 子 Tab 导航 - 左侧标题 + 右侧Tab样式 */}
        <div className="flex items-stretch bg-gradient-to-r from-purple-900 to-purple-800 rounded-lg overflow-hidden">
          {/* 左侧标题 */}
          <div className="flex items-center gap-3 px-6 py-4 bg-purple-950/50">
            <LayoutDashboard className="w-5 h-5 text-white" />
            <span className="text-white font-semibold text-lg">数据总览</span>
          </div>
          {/* 右侧Tab选项 */}
          <div className="flex items-center gap-1 px-4">
            <button
              onClick={() => setOverviewTab('product')}
              className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
                overviewTab === 'product' ? 'bg-purple-500 text-white' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'
              }`}
            >
              <span className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" />
                算力数据
              </span>
            </button>
            <button
              onClick={() => setOverviewTab('user')}
              className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
                overviewTab === 'user' ? 'bg-purple-500 text-white' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'
              }`}
            >
              <span className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                用户数据
              </span>
            </button>
            <button
              onClick={() => setOverviewTab('energy')}
              className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
                overviewTab === 'energy' ? 'bg-purple-500 text-white' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'
              }`}
            >
              <span className="flex items-center gap-2">
                <Zap className="w-4 h-4" />
                能力值统计
              </span>
            </button>
          </div>
        </div>
        
        {/* 算力数据 Tab */}
        {overviewTab === 'product' && (
          <div className="space-y-3 md:space-y-6">
            {/* 核心指标卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
              <Card className="mobile-compact-card bg-gradient-to-br from-green-500 to-green-600 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">算力售卖总数</p>
                      <p className="text-3xl font-bold mt-2">{overviewData?.product?.totalSold || 0}</p>
                      <p className="text-xs opacity-70 mt-1">累计已售出</p>
                    </div>
                    <ShoppingCart className="w-10 h-10 opacity-50" />
                  </div>
                </CardContent>
              </Card>
              <Card className="mobile-compact-card bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">闲置算力数量</p>
                      <p className="text-3xl font-bold mt-2">{overviewData?.product?.idleCount || 0}</p>
                      <p className="text-xs opacity-70 mt-1">可上架销售</p>
                    </div>
                    <Package className="w-10 h-10 opacity-50" />
                  </div>
                </CardContent>
              </Card>
              <Card className="mobile-compact-card bg-gradient-to-br from-purple-500 to-purple-600 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">售卖总额度</p>
                      <p className="text-3xl font-bold mt-2">¥{(overviewData?.product?.totalSalesAmount || 0).toLocaleString()}</p>
                      <p className="text-xs opacity-70 mt-1">累计销售额</p>
                    </div>
                    <TrendingUp className="w-10 h-10 opacity-50" />
                  </div>
                </CardContent>
              </Card>
              <Card className="mobile-compact-card bg-gradient-to-br from-orange-500 to-orange-600 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">今日售卖</p>
                      <p className="text-3xl font-bold mt-2">{overviewData?.product?.todaySold || 0}</p>
                      <p className="text-xs opacity-70 mt-1">
                        今日销售额: ¥{(overviewData?.product?.todaySalesAmount || 0).toLocaleString()}
                      </p>
                    </div>
                    <ArrowUpRight className="w-10 h-10 opacity-50" />
                  </div>
                </CardContent>
              </Card>
            </div>
            
            {/* 销售趋势图表 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-purple-600" />
                  近7天销售趋势
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={overviewData?.product?.salesTrend || []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis yAxisId="left" orientation="left" stroke="#8b5cf6" />
                      <YAxis yAxisId="right" orientation="right" stroke="#10b981" />
                      <Tooltip />
                      <Legend />
                      <Bar yAxisId="left" dataKey="count" name="销售数量" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="right" dataKey="amount" name="销售额(元)" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            
            {/* 按周期分布 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChartIcon className="w-5 h-5 text-purple-600" />
                  算力周期分布
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="text-left py-3 px-4">算力周期</th>
                        <th className="text-right py-3 px-4">销售数量</th>
                        <th className="text-right py-3 px-4">销售额</th>
                        <th className="text-right py-3 px-4">占比</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(overviewData?.product?.productsByPeriod || []).map((item: any) => (
                        <tr key={item.period} className="border-b">
                          <td className="py-3 px-4 font-medium">{item.period}天</td>
                          <td className="py-3 px-4 text-right">{item.count}</td>
                          <td className="py-3 px-4 text-right text-green-600 font-medium">
                            ¥{item.amount.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {((item.amount / (overviewData?.product?.totalSalesAmount || 1)) * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                      {(!overviewData?.product?.productsByPeriod || overviewData?.product?.productsByPeriod.length === 0) && (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-gray-500">暂无数据</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        
        {/* 用户数据 Tab */}
        {overviewTab === 'user' && (
          <div className="space-y-3 md:space-y-6">
            {/* 核心指标卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
              <Card className="mobile-compact-card bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">总用户数</p>
                      <p className="text-3xl font-bold mt-2">{overviewData?.user?.totalUsers || 0}</p>
                      <p className="text-xs opacity-70 mt-1">全部注册用户</p>
                    </div>
                    <Users className="w-10 h-10 opacity-50" />
                  </div>
                </CardContent>
              </Card>
              <Card className="mobile-compact-card bg-gradient-to-br from-green-500 to-green-600 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">今日新增注册</p>
                      <p className="text-3xl font-bold mt-2">{overviewData?.user?.todayNewUsers || 0}</p>
                      <p className="text-xs opacity-70 mt-1">
                        其中会员: {overviewData?.user?.todayNewMembers || 0}
                      </p>
                    </div>
                    <ArrowUpRight className="w-10 h-10 opacity-50" />
                  </div>
                </CardContent>
              </Card>
              <Card className="mobile-compact-card bg-gradient-to-br from-purple-500 to-purple-600 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">今日新增购买</p>
                      <p className="text-3xl font-bold mt-2">¥{(overviewData?.user?.todayPurchaseAmount || 0).toLocaleString()}</p>
                      <p className="text-xs opacity-70 mt-1">今日订单金额</p>
                    </div>
                    <TrendingUp className="w-10 h-10 opacity-50" />
                  </div>
                </CardContent>
              </Card>
              <Card className="mobile-compact-card bg-gradient-to-br from-orange-500 to-orange-600 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">会员总数</p>
                      <p className="text-3xl font-bold mt-2">{overviewData?.user?.totalMembers || 0}</p>
                      <p className="text-xs opacity-70 mt-1">购买用户</p>
                    </div>
                    <UserCog className="w-10 h-10 opacity-50" />
                  </div>
                </CardContent>
              </Card>
            </div>
            
            {/* 用户增长趋势 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-purple-600" />
                  近7天用户增长趋势
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={overviewData?.user?.newUsersTrend || []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="count" name="新增用户" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            
            {/* 购买金额趋势 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                  近7天购买金额趋势
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={overviewData?.user?.purchaseTrend || []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip formatter={(value) => `¥${Number(value).toLocaleString()}`} />
                      <Legend />
                      <Bar dataKey="amount" name="购买金额" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        
        {/* 能力值统计 Tab */}
        {overviewTab === 'energy' && (
          <div className="space-y-3 md:space-y-6">
            {/* 核心指标卡片 - 市场费分配统计 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-4">
              <Card className="mobile-compact-card bg-gradient-to-br from-yellow-500 to-orange-500 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">能力值总额</p>
                      <p className="text-2xl font-bold mt-2">{(overviewData?.energy?.totalEnergy || 0).toLocaleString()}</p>
                      <p className="text-xs opacity-70 mt-1">平台总收益</p>
                    </div>
                    <Zap className="w-8 h-8 opacity-50" />
                  </div>
                </CardContent>
              </Card>
              <Card className="mobile-compact-card bg-gradient-to-br from-green-500 to-emerald-500 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">今日递增</p>
                      <p className="text-2xl font-bold mt-2 flex items-center gap-1">
                        {(overviewData?.energy?.todayEnergyChange || 0) >= 0 ? (
                          <ArrowUpRight className="w-5 h-5" />
                        ) : (
                          <ArrowDownRight className="w-5 h-5" />
                        )}
                        {Math.abs(overviewData?.energy?.todayEnergyChange || 0).toLocaleString()}
                      </p>
                      <p className="text-xs opacity-70 mt-1">会员收益转收益</p>
                    </div>
                    <TrendingUp className="w-8 h-8 opacity-50" />
                  </div>
                </CardContent>
              </Card>
              <Card className="mobile-compact-card bg-gradient-to-br from-amber-500 to-orange-500 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">智算总台收益</p>
                      <p className="text-2xl font-bold mt-2">
                        {(overviewData?.energy?.energyDistribution?.admin || 0).toLocaleString()}
                      </p>
                      <p className="text-xs opacity-70 mt-1">智算总台持有</p>
                    </div>
                    <Shield className="w-8 h-8 opacity-50" />
                  </div>
                </CardContent>
              </Card>
              <Card className="mobile-compact-card bg-gradient-to-br from-purple-500 to-indigo-500 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">服务网点收益</p>
                      <p className="text-2xl font-bold mt-2">
                        {(overviewData?.energy?.energyDistribution?.branch || 0).toLocaleString()}
                      </p>
                      <p className="text-xs opacity-70 mt-1">服务网点持有</p>
                    </div>
                    <Building2 className="w-8 h-8 opacity-50" />
                  </div>
                </CardContent>
              </Card>
              <Card className="mobile-compact-card bg-gradient-to-br from-blue-500 to-cyan-500 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">服务商收益</p>
                      <p className="text-2xl font-bold mt-2">
                        {(overviewData?.energy?.energyDistribution?.provider || 0).toLocaleString()}
                      </p>
                      <p className="text-xs opacity-70 mt-1">服务商持有</p>
                    </div>
                    <UserCog className="w-8 h-8 opacity-50" />
                  </div>
                </CardContent>
              </Card>
              <Card className="mobile-compact-card bg-gradient-to-br from-pink-500 to-rose-500 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">会员收益</p>
                      <p className="text-2xl font-bold mt-2">
                        {(overviewData?.energy?.energyDistribution?.member || 0).toLocaleString()}
                      </p>
                      <p className="text-xs opacity-70 mt-1">会员持有</p>
                    </div>
                    <Users className="w-8 h-8 opacity-50" />
                  </div>
                </CardContent>
              </Card>
            </div>
            
            {/* Top 10 用户 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-yellow-500" />
                  收益 Top 10 用户
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="text-left py-3 px-4">排名</th>
                        <th className="text-left py-3 px-4">用户名</th>
                        <th className="text-right py-3 px-4">收益</th>
                        <th className="text-right py-3 px-4">占比</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(overviewData?.energy?.topEnergyUsers || []).map((user: any, index: number) => (
                        <tr key={user.userId} className="border-b">
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                              index === 0 ? 'bg-yellow-100 text-yellow-700' :
                              index === 1 ? 'bg-gray-100 text-gray-700' :
                              index === 2 ? 'bg-orange-100 text-orange-700' :
                              'bg-gray-50 text-gray-600'
                            }`}>
                              {index + 1}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-medium">{user.username}</td>
                          <td className="py-3 px-4 text-right text-yellow-600 font-medium">
                            {user.energyValue.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {((user.energyValue / (overviewData?.energy?.totalEnergy || 1)) * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                      {(!overviewData?.energy?.topEnergyUsers || overviewData?.energy?.topEnergyUsers.length === 0) && (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-gray-500">暂无数据</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
            
            {/* 收益趋势 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-purple-600" />
                  近7天收益变化趋势
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={overviewData?.energy?.energyTrend || []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis yAxisId="left" orientation="left" stroke="#f59e0b" />
                      <YAxis yAxisId="right" orientation="right" stroke="#10b981" />
                      <Tooltip />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="totalEnergy" name="累计收益" stroke="#f59e0b" strokeWidth={2} />
                      <Bar yAxisId="right" dataKey="change" name="日变化" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 消息提示 */}
        {message && (
          <div className={`fixed top-4 right-4 px-4 py-2 rounded-md shadow-lg z-50 ${
            message.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
          }`}>
            {message.text}
          </div>
        )}
      </div>
    );
  };
  
  // 渲染算力额度管理（合并：额度总览+算力模板+分配记录+额度申请）
  const renderQuotaManagement = () => {
    const subTabs = [
      { key: 'overview' as const, label: '额度总览', icon: Database },
      { key: 'templates' as const, label: '算力模板', icon: Cpu },
      { key: 'records' as const, label: '分配记录', icon: FileText },
      { key: 'requests' as const, label: '额度申请', icon: ClipboardList },
    ];

    const renderSubContent = () => {
      if (quotaSubTab === 'templates') {
        return renderProductTemplates();
      }
      if (quotaSubTab === 'records') {
        return <QuotaRecordsPanel />;
      }
      if (quotaSubTab === 'requests') {
        return <QuotaRequestsPanel />;
      }
      // 默认：额度总览
      return renderQuotaOverview();
    };

    return (
      <div className="space-y-4">
        {/* 子Tab导航 */}
        <div className="flex gap-2 border-b pb-2 mobile-tab-nav">
          {subTabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setQuotaSubTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                  quotaSubTab === tab.key
                    ? 'bg-purple-100 text-purple-700 border-b-2 border-purple-600'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
        {renderSubContent()}
      </div>
    );
  };

  // 额度总览
  const renderQuotaOverview = () => {
    // 获取智算总台账户信息
    const adminAccount = quotaAccounts.find(a => a.role === 'admin');
    const branchAccounts = quotaAccounts.filter(a => a.role === 'branch');
    const providerAccounts = quotaAccounts.filter(a => a.role === 'provider');
    
    // 计算统计数据
    const totalIssued = quotaStats.totalIssued || 0;
    const totalIdle = quotaStats.totalIdle || 0;
    const totalSold = quotaStats.totalUsed || 0;
    
    // 创建额度处理
    const handleCreateQuota = async () => {
      if (!createQuotaAmount || Number(createQuotaAmount) <= 0) {
        showMessage('error', '请输入有效的金额');
        return;
      }
      setSubmitting(true);
      try {
        const res = await authFetch('/api/quota-accounts/create', {
          method: 'POST',
          body: JSON.stringify({
            amount: Number(createQuotaAmount),
            note: createQuotaNote,
          }),
        });
        const data = await res.json();
        if (data.success) {
          showMessage('success', '额度创建成功');
          setShowCreateQuotaDialog(false);
          setCreateQuotaAmount('');
          setCreateQuotaNote('');
          // 延迟刷新确保状态更新
          setTimeout(() => loadData(), 100);
        } else {
          showMessage('error', data.error || '创建失败');
        }
      } catch (e) {
        showMessage('error', '创建失败');
      } finally {
        setSubmitting(false);
      }
    };
    
    // 分配额度处理
    const handleTransfer = async () => {
      if (!transferTo || !transferAmount || Number(transferAmount) <= 0) {
        showMessage('error', '请选择分配对象并输入金额');
        return;
      }
      if (Number(transferAmount) < 10000) {
        showMessage('error', '最小分配额度为10000');
        return;
      }
      setSubmitting(true);
      try {
        // 智算总台→服务网点：调用 allocate-branch API（赠送20%收益）
        // 智算总台→服务商：暂不直接分配（通过服务网点分配）
        const res = await authFetch('/api/admin/allocate-branch', {
          method: 'POST',
          body: JSON.stringify({
            adminId: user?.id,
            branchId: transferTo,
            amount: Number(transferAmount),
            note: transferNote,
          }),
        });
        const data = await res.json();
        if (data.success) {
          showMessage('success', data.message || '额度分配成功');
          setShowTransferDialog(false);
          setTransferTo('');
          setTransferAmount('');
          setTransferNote('');
          setTimeout(() => loadData(), 500);
        } else {
          showMessage('error', data.error || '分配失败');
        }
      } catch (e) {
        showMessage('error', '分配失败');
      } finally {
        setSubmitting(false);
      }
    };
    
    return (
      <div className="space-y-3 md:space-y-6">
        {/* 额度统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
          <div className="mobile-compact-card p-4 md:p-6 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg">
            <p className="text-sm text-gray-600 mobile-label">智算总台额度</p>
            <p className="text-2xl md:text-3xl font-bold text-blue-600 mt-2 mobile-num">
              ¥{formatWan(adminAccount?.total_in)}
            </p>
            <p className="text-xs text-gray-500 mt-1 mobile-sub">
              已分配: ¥{formatWan(totalIssued)}
            </p>
          </div>
          <div className="mobile-compact-card p-4 md:p-6 bg-gradient-to-br from-green-50 to-green-100 rounded-lg">
            <p className="text-sm text-gray-600 mobile-label">已分配额度</p>
            <p className="text-2xl md:text-3xl font-bold text-green-600 mt-2 mobile-num">
              ¥{formatWan(totalIssued)}
            </p>
            <p className="text-xs text-gray-500 mt-1 mobile-sub">
              分配给 {branchAccounts.length} 个服务网点
            </p>
          </div>
          <div className="mobile-compact-card p-4 md:p-6 bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg">
            <p className="text-sm text-gray-600 mobile-label">可用余额</p>
            <p className="text-2xl md:text-3xl font-bold text-orange-600 mt-2 mobile-num">
              ¥{formatWan(adminAccount?.balance)}
            </p>
            <p className="text-xs text-gray-500 mt-1 mobile-sub">
              可继续分配
            </p>
          </div>
          <div className="mobile-compact-card p-4 md:p-6 bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg">
            <p className="text-sm text-gray-600 mobile-label">已购买额度</p>
            <p className="text-2xl md:text-3xl font-bold text-purple-600 mt-2 mobile-num">
              ¥{formatWan(totalSold)}
            </p>
            <p className="text-xs text-gray-500 mt-1 mobile-sub">
              会员累计购买
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={() => setShowTransferDialog(true)} variant="outline" className="border-green-500 text-green-600">
            <Zap className="w-4 h-4 mr-2" />分配额度
          </Button>
          <Button onClick={() => setShowCreateQuotaDialog(true)} className="bg-blue-600">
            <Plus className="w-4 h-4 mr-2" />创建额度
          </Button>
        </div>

        {/* 下属服务网点额度 */}
        <Card>
          <CardHeader>
            <CardTitle>下属服务网点额度</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {branchAccounts.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  暂无服务网点
                </div>
              )}
              {branchAccounts.map(account => (
                <div key={account.id} className="p-4 border rounded-lg">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">{account.username}</p>
                      <p className="text-sm text-gray-500">{account.phone || '-'}</p>
                      {account.unique_id && <p className="text-xs text-gray-400">专属ID: {account.unique_id}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-blue-600">
                        ¥{formatWan(account.balance)}
                      </p>
                      <p className="text-xs text-gray-500">
                        累计获得: ¥{formatWan(account.total_in)}
                      </p>
                    </div>
                  </div>
                  {account.total_in > 0 && (
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>额度使用</span>
                        <span>{account.total_in > 0 ? Math.round(((account.total_in - account.balance) / account.total_in) * 100) : 0}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-500 rounded-full h-2 transition-all"
                          style={{ width: `${account.total_in > 0 ? Math.round(((account.total_in - account.balance) / account.total_in) * 100) : 0}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 创建额度对话框 */}
        {showCreateQuotaDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle>创建算力额度</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>额度金额</Label>
                  <Input
                    type="number"
                    value={createQuotaAmount}
                    onChange={(e) => setCreateQuotaAmount(e.target.value)}
                    placeholder="请输入额度金额"
                  />
                </div>
                <div>
                  <Label>备注说明</Label>
                  <Input
                    value={createQuotaNote}
                    onChange={(e) => setCreateQuotaNote(e.target.value)}
                    placeholder="请输入备注（可选）"
                  />
                </div>
                <div className="flex gap-2 justify-end pt-4">
                  <Button variant="outline" onClick={() => setShowCreateQuotaDialog(false)}>
                    取消
                  </Button>
                  <Button onClick={handleCreateQuota} disabled={submitting}>
                    {submitting ? '创建中...' : '确认创建'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 分配额度对话框 */}
        {showTransferDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle>分配算力额度给服务网点</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                  分配额度给服务网点时，系统自动赠送20%收益给服务网点。例如分配10000元额度，服务网点额外获得2000收益。
                </div>
                <div>
                  <Label>选择服务网点</Label>
                  <select
                    className="w-full mt-1 p-2 border rounded-md"
                    value={transferTo}
                    onChange={(e) => setTransferTo(e.target.value)}
                  >
                    <option value="">请选择服务网点</option>
                    {branchAccounts.map(a => (
                        <option key={a.user_id} value={a.user_id}>{a.username} {a.phone ? `(${a.phone})` : ''}</option>
                      ))
                    }
                  </select>
                </div>
                <div>
                  <Label>分配金额（最低10000）</Label>
                  <Input
                    type="number"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    placeholder="请输入分配金额"
                  />
                </div>
                <div>
                  <Label>备注说明</Label>
                  <Input
                    value={transferNote}
                    onChange={(e) => setTransferNote(e.target.value)}
                    placeholder="请输入备注（可选）"
                  />
                </div>
                <div className="flex gap-2 justify-end pt-4">
                  <Button variant="outline" onClick={() => setShowTransferDialog(false)}>
                    取消
                  </Button>
                  <Button onClick={handleTransfer} disabled={submitting}>
                    {submitting ? '分配中...' : '确认分配'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    );
  };

  // 渲染额度审批
  const renderQuotaRequests = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>服务网点额度申请</CardTitle>
          <Badge className="bg-blue-100 text-blue-700">
            待审核: {quotaRequests.filter(r => r.status === 'pending').length}个
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {quotaRequests.length === 0 ? (
          <div className="py-12 text-center text-gray-500">
            <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>暂无额度申请</p>
          </div>
        ) : (
          <div className="space-y-4">
            {quotaRequests.map(request => (
              <div key={request.id} className="p-4 border rounded-lg hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-medium">{branches.find(b => b.id === request.requester_id)?.real_name || '服务网点'}</h4>
                      <Badge className={
                        request.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                        request.status === 'approved' ? 'bg-green-100 text-green-700' :
                        'bg-red-100 text-red-700'
                      }>
                        {request.status === 'pending' ? '待审核' :
                         request.status === 'approved' ? '已通过' : '已拒绝'}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm text-gray-600">
                      <div>
                        <span className="text-gray-400">申请额度：</span>
                        <span className="text-green-600 font-medium">¥{request.requested_amount?.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-gray-400">批准额度：</span>
                        <span className="text-blue-600 font-medium">¥{request.approved_amount?.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-gray-400">奖励比例：</span>
                        <span className="text-orange-600 font-medium">{request.bonus_rate}%</span>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-gray-400">
                      申请时间: {new Date(request.created_at).toLocaleString()}
                    </div>
                  </div>
                  {request.status === 'pending' && (
                    <div className="flex gap-2 ml-4">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => handleApproveQuotaRequest(request.id)}
                        disabled={submitting}
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />通过
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleRejectQuotaRequest(request.id)}
                        disabled={submitting}
                      >
                        <XCircle className="w-4 h-4 mr-1" />拒绝
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );

  // 分配记录Tab
  const QuotaRecordsPanel = React.memo(() => {
    const [records, setRecords] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterType, setFilterType] = useState('all');

    useEffect(() => {
      const fetchRecords = async () => {
        setLoading(true);
        try {
          const url = filterType === 'all' 
            ? '/api/quota-records' 
            : `/api/quota-records?type=${filterType}`;
          const res = await authFetch(url);
          const data = await res.json();
          if (data.success) {
            setRecords(data.data || []);
          }
        } catch (e) {
          console.error('获取分配记录失败:', e);
        } finally {
          setLoading(false);
        }
      };
      fetchRecords();
    }, [filterType]);

    const getTypeLabel = (type: string) => {
      const map: Record<string, string> = {
        transfer: '额度下发',
        allocate: '额度分配',
        create: '额度创建',
        return: '额度退回',
        use: '额度使用',
      };
      return map[type] || type;
    };

    const getTypeColor = (type: string) => {
      const map: Record<string, string> = {
        transfer: 'bg-blue-100 text-blue-700',
        allocate: 'bg-purple-100 text-purple-700',
        create: 'bg-green-100 text-green-700',
        return: 'bg-orange-100 text-orange-700',
        use: 'bg-red-100 text-red-700',
      };
      return map[type] || 'bg-gray-100 text-gray-700';
    };

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">分配记录</CardTitle>
          <div className="flex gap-2">
            {['all', 'transfer', 'allocate', 'create'].map(t => (
              <Button
                key={t}
                size="sm"
                variant={filterType === t ? 'default' : 'outline'}
                onClick={() => setFilterType(t)}
              >
                {t === 'all' ? '全部' : getTypeLabel(t)}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : records.length === 0 ? (
            <div className="text-center py-8 text-gray-500">暂无分配记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2">时间</th>
                    <th className="text-left py-3 px-2">类型</th>
                    <th className="text-left py-3 px-2">操作方</th>
                    <th className="text-left py-3 px-2">接收方</th>
                    <th className="text-right py-3 px-2">金额</th>
                    <th className="text-left py-3 px-2">备注</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r: any, i: number) => (
                    <tr key={i} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-2 text-gray-500 whitespace-nowrap">
                        {r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : '-'}
                      </td>
                      <td className="py-3 px-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getTypeColor(r.type)}`}>
                          {getTypeLabel(r.type)}
                        </span>
                      </td>
                      <td className="py-3 px-2">
                        {r.from_username ? (
                          <span>{r.from_username} <span className="text-gray-400 text-xs">({r.from_role})</span></span>
                        ) : <span className="text-gray-400">系统</span>}
                      </td>
                      <td className="py-3 px-2">
                        {r.to_username ? (
                          <span>{r.to_username} <span className="text-gray-400 text-xs">({r.to_role})</span></span>
                        ) : '-'}
                      </td>
                      <td className="py-3 px-2 text-right font-medium text-blue-600">
                        ¥{Number(r.amount).toLocaleString()}
                      </td>
                      <td className="py-3 px-2 text-gray-500 max-w-[200px] truncate">
                        {r.note || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  });

  // 额度申请Tab - 使用组件避免hooks规则违反
  const QuotaRequestsPanel = React.memo(() => {
    const [applications, setApplications] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const fetchApplications = async () => {
      setLoading(true);
      try {
        // 从 quota_requests 表读取（服务网点/服务商的申请都写在这里）
        const res = await authFetch('/api/quota-requests?requesterType=branch');
        const data = await res.json();
        if (data.success) {
          setApplications(data.data || []);
        }
      } catch (e) {
        console.error('获取额度申请失败:', e);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => { fetchApplications(); }, []);

    const handleAction = async (requestId: string, action: 'approve' | 'reject') => {
      setActionLoading(requestId);
      try {
        const userId = localStorage.getItem('userId') || '';
        const res = await authFetch('/api/quota-requests/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, reviewerId: userId, action }),
        });
        const data = await res.json();
        if (data.success) {
          showMessage('success', data.message);
          fetchApplications();
          loadData();
        } else {
          showMessage('error', data.error || '操作失败');
        }
      } catch (e) {
        showMessage('error', '操作失败');
      } finally {
        setActionLoading(null);
      }
    };

    const getStatusBadge = (status: string) => {
      const map: Record<string, string> = {
        pending: 'bg-yellow-100 text-yellow-700',
        approved: 'bg-green-100 text-green-700',
        rejected: 'bg-red-100 text-red-700',
      };
      const labelMap: Record<string, string> = {
        pending: '待审批',
        approved: '已通过',
        rejected: '已拒绝',
      };
      return (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || 'bg-gray-100 text-gray-700'}`}>
          {labelMap[status] || status}
        </span>
      );
    };

    const getTypeLabel = (type: string) => {
      const labels: Record<string, string> = {
        branch: '服务网点',
        provider: '服务商',
      };
      return labels[type] || type;
    };

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">服务网点额度申请</CardTitle>
          <Button size="sm" variant="outline" onClick={fetchApplications}>刷新</Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : applications.length === 0 ? (
            <div className="text-center py-8 text-gray-500">暂无额度申请</div>
          ) : (
            <div className="space-y-3">
              {applications.map((app: any) => (
                <div key={app.id} className="border rounded-lg p-4 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="font-medium">
                          {app.requester_name || '未知'}
                          <span className="text-xs text-gray-400 ml-2">{getTypeLabel(app.requester_type)}</span>
                        </p>
                        <p className="text-xs text-gray-500">{app.requester_phone || ''}</p>
                      </div>
                      {getStatusBadge(app.status)}
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-lg">¥{Number(app.requested_amount).toLocaleString()}</p>
                      {app.requester_type === 'branch' && (
                        <p className="text-xs text-orange-500">
                          配比收益: ¥{Math.floor(Number(app.requested_amount) * 0.2).toLocaleString()}
                        </p>
                      )}
                      <p className="text-xs text-gray-500">
                        {app.created_at ? new Date(app.created_at).toLocaleString('zh-CN') : ''}
                      </p>
                    </div>
                  </div>
                  {app.reject_reason && (
                    <p className="text-sm text-red-600 mt-2">拒绝原因: {app.reject_reason}</p>
                  )}
                  {app.status === 'pending' && (
                    <div className="flex gap-2 mt-3 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-green-600 border-green-300 hover:bg-green-50"
                        onClick={() => handleAction(app.id, 'approve')}
                        disabled={actionLoading === app.id}
                      >
                        通过
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 border-red-300 hover:bg-red-50"
                        onClick={() => handleAction(app.id, 'reject')}
                        disabled={actionLoading === app.id}
                      >
                        拒绝
                      </Button>
                    </div>
                  )}
                  {app.status === 'approved' && app.approved_amount && (
                    <p className="text-sm text-green-600 mt-2">审批额度: ¥{Number(app.approved_amount).toLocaleString()}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  });

  // 会员管理完整组件 - 使用 memo 优化防止不必要的重新渲染
  const MemberManagement = React.memo(() => {
    // 使用 ref 跟踪是否已初始化加载
    const initializedRef = useRef(false);
    
    // 组件挂载时自动加载所有数据
    useEffect(() => {
      if (!initializedRef.current) {
        initializedRef.current = true;
        handleRefreshUpgradeAudit();
        handleRefreshEnergyList();
        handleRefreshStats();
        loadAllUsers();
      }
    }, []);
    
    // State 定义
    const [upgradeAuditList, setUpgradeAuditList] = useState<any[]>([]);
    const [memberEnergyList, setMemberEnergyList] = useState<any[]>([]);
    const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
    const [memberDetail, setMemberDetail] = useState<any>(null);
    const [memberDetailLoading, setMemberDetailLoading] = useState(false);
    const [memberDetailTab, setMemberDetailTab] = useState<'holdings' | 'orders' | 'energy'>('holdings');
    
    // 加载会员详情
    const loadMemberDetail = async (userId: string) => {
      setSelectedMemberId(userId);
      setMemberDetailLoading(true);
      setMemberDetailTab('holdings');
      try {
        const res = await authFetch(`/api/admin/member-detail?userId=${userId}`);
        const data = await res.json();
        if (data.success) {
          setMemberDetail(data.data);
        } else {
          console.error('获取会员详情失败:', data.error);
        }
      } catch (err) {
        console.error('获取会员详情失败:', err);
      } finally {
        setMemberDetailLoading(false);
      }
    };
    
    // 关闭会员详情
    const closeMemberDetail = () => {
      setSelectedMemberId(null);
      setMemberDetail(null);
    };
    
    // 刷新函数 - 刷新升级审核列表
    const handleRefreshUpgradeAudit = () => {
      authFetch('/api/provider-applications?status=pending')
        .then(res => res.json())
        .then(data => {
          if (data.success) setUpgradeAuditList(data.data || []);
        })
        .catch(err => console.error('刷新升级审核列表失败:', err));
    };

    // 刷新函数 - 刷新会员收益列表
    const handleRefreshEnergyList = () => {
      authFetch('/api/admin/members-energy')
        .then(res => res.json())
        .then(data => {
          if (data.success) setMemberEnergyList(data.data || []);
        })
        .catch(err => console.error('刷新会员收益列表失败:', err));
    };

    // 刷新函数 - 刷新会员统计
    const handleRefreshStats = () => {
      setMemberStatsLoading(true);
      authFetch('/api/admin/members-stats')
        .then(res => res.json())
        .then(data => {
          if (data.success) setMemberStats(data.data);
        })
        .catch(err => console.error('刷新会员统计失败:', err))
        .finally(() => setMemberStatsLoading(false));
    };

    // 处理升级审核
    const handleUpgradeAudit = (id: string, action: 'approve' | 'reject') => {
      authFetch('/api/provider-applications/review', {
        method: 'POST',
        body: JSON.stringify({ id, action }),
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            alert(action === 'approve' ? '审核通过' : '已拒绝');
            setUpgradeAuditList(prev => prev.filter(item => item.id !== id));
          } else {
            alert(data.error || '操作失败');
          }
        })
        .catch(() => alert('网络错误'));
    };

    // 收益调整
    const handleEnergyAdjust = (user: any) => {
      setEnergyAdjustTarget(user);
      setEnergyAdjustAmount('');
      setEnergyAdjustNote('');
      setEnergyAdjustType('add');
      setShowEnergyAdjustDialog(true);
    };

    const submitEnergyAdjust = async () => {
      if (!energyAdjustTarget || !energyAdjustAmount) return alert('请填写调整金额');
      const amount = parseFloat(energyAdjustAmount);
      if (isNaN(amount) || amount <= 0) return alert('请输入有效金额');

      try {
        const res = await authFetch('/api/admin/energy-adjust', {
          method: 'POST',
          body: JSON.stringify({
            userId: energyAdjustTarget.id,
            type: energyAdjustType,
            amount,
            note: energyAdjustNote || (energyAdjustType === 'add' ? '管理员调整增加' : '管理员调整扣除'),
          }),
        });
        const data = await res.json();
        if (data.success) {
          alert('收益调整成功');
          setShowEnergyAdjustDialog(false);
          // 刷新收益列表
          loadMemberEnergyList();
        } else {
          alert(data.error || '调整失败');
        }
      } catch {
        alert('网络错误');
      }
    };

    // 查看收益记录
    const handleViewEnergyRecord = async (user: any) => {
      setEnergyAdjustTarget(user);
      setShowEnergyRecordDialog(true);
      setEnergyRecordLoading(true);
      try {
        const res = await authFetch(`/api/energy-transactions?userId=${user.id}`);
        const data = await res.json();
        if (data.success) {
          setEnergyRecordList(data.data || []);
        }
      } catch {
        setEnergyRecordList([]);
      }
      setEnergyRecordLoading(false);
    };

    // 加载会员收益列表
    const loadMemberEnergyList = async () => {
      try {
        const res = await authFetch('/api/admin/members-energy');
        const data = await res.json();
        if (data.success) {
          setAllUsers(prev => {
            // 合并收益数据
            const energyMap = new Map((data.data || []).map((u: any) => [u.id, u]));
            return prev.map(u => {
              const e = energyMap.get(u.id);
              return e ? { ...u, ...e } : u;
            });
          });
        }
      } catch {}
    };

    // 升级审核Tab
    const renderUpgradeAuditTab = () => (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>升级审核</CardTitle>
            <Button variant="outline" onClick={handleRefreshUpgradeAudit}>
              <RefreshCw className="w-4 h-4 mr-2" />刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left py-3 px-4">申请人</th>
                  <th className="text-left py-3 px-4">手机号</th>
                  <th className="text-left py-3 px-4">申请类型</th>
                  <th className="text-left py-3 px-4">申请时间</th>
                  <th className="text-left py-3 px-4">状态</th>
                  <th className="text-left py-3 px-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {upgradeAuditList.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-gray-500">暂无待审核申请</td>
                  </tr>
                ) : (
                  upgradeAuditList.map(item => (
                    <tr key={item.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4 font-medium">{item.applicant_name || item.username || '-'}</td>
                      <td className="py-3 px-4 text-gray-600">{item.phone || '-'}</td>
                      <td className="py-3 px-4">
                        <Badge className={item.apply_type === 'first' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}>
                          {item.apply_type === 'first' ? '第一代申请' : '第二代申请'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-500">{item.created_at ? new Date(item.created_at).toLocaleDateString() : '-'}</td>
                      <td className="py-3 px-4">
                        <Badge className="bg-yellow-100 text-yellow-700">{item.status}</Badge>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex gap-2">
                          <Button size="sm" className="bg-green-600" onClick={() => handleUpgradeAudit(item.id, 'approve')}>通过</Button>
                          <Button size="sm" variant="destructive" onClick={() => handleUpgradeAudit(item.id, 'reject')}>拒绝</Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    );

    // 市场费分配Tab
    const renderEnergyManageTab = () => (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>市场费分配</CardTitle>
            <Button variant="outline" onClick={handleRefreshEnergyList}>
              <RefreshCw className="w-4 h-4 mr-2" />刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left py-3 px-4">会员</th>
                  <th className="text-left py-3 px-4">手机号</th>
                  <th className="text-left py-3 px-4">当前余额</th>
                  <th className="text-left py-3 px-4">累计充值</th>
                  <th className="text-left py-3 px-4">累计转出</th>
                  <th className="text-left py-3 px-4">服务商</th>
                  <th className="text-left py-3 px-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {memberEnergyList.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-500">暂无数据</td>
                  </tr>
                ) : (
                  memberEnergyList.map(item => (
                    <tr key={item.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4 font-medium">{item.username}</td>
                      <td className="py-3 px-4 text-gray-600">{item.phone || '-'}</td>
                      <td className="py-3 px-4 text-orange-600 font-medium">{Number(item.balance || 0).toLocaleString()}</td>
                      <td className="py-3 px-4 text-green-600">{Number(item.total_in || 0).toLocaleString()}</td>
                      <td className="py-3 px-4 text-red-600">{Number(item.total_out || 0).toLocaleString()}</td>
                      <td className="py-3 px-4">{item.provider_name || '-'}</td>
                      <td className="py-3 px-4">
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleEnergyAdjust(item)}>调整</Button>
                          <Button size="sm" variant="outline" onClick={() => handleViewEnergyRecord(item)}>记录</Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    );

    // 会员统计Tab
    const renderMemberStatsTab = () => (
      <div className="space-y-3 md:space-y-6">
        {/* 概览卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
          <Card className="mobile-compact-card bg-gradient-to-br from-purple-500 to-purple-700 text-white">
            <CardContent className="p-4">
              <div className="text-sm opacity-80">会员总数</div>
              <div className="text-3xl font-bold mt-1">{memberStats?.totalMembers || 0}</div>
              <div className="text-xs opacity-70 mt-2">较昨日 +{memberStats?.yesterdayNewMembers || 0}</div>
            </CardContent>
          </Card>
          <Card className="mobile-compact-card bg-gradient-to-br from-blue-500 to-blue-700 text-white">
            <CardContent className="p-4">
              <div className="text-sm opacity-80">活跃会员</div>
              <div className="text-3xl font-bold mt-1">{memberStats?.activeMembers || 0}</div>
              <div className="text-xs opacity-70 mt-2">本周购买 ≥1</div>
            </CardContent>
          </Card>
          <Card className="mobile-compact-card bg-gradient-to-br from-green-500 to-green-700 text-white">
            <CardContent className="p-4">
              <div className="text-sm opacity-80">总投资金额</div>
              <div className="text-3xl font-bold mt-1">¥{(memberStats?.totalInvestment || 0).toLocaleString()}</div>
              <div className="text-xs opacity-70 mt-2">累计购买总额</div>
            </CardContent>
          </Card>
          <Card className="mobile-compact-card bg-gradient-to-br from-orange-500 to-orange-700 text-white">
            <CardContent className="p-4">
              <div className="text-sm opacity-80">持有收益</div>
              <div className="text-3xl font-bold mt-1">{(memberStats?.totalEnergy || 0).toLocaleString()}</div>
              <div className="text-xs opacity-70 mt-2">所有会员持有</div>
            </CardContent>
          </Card>
        </div>

        {/* 增长趋势图表区域 */}
        <Card>
          <CardHeader>
            <CardTitle>会员增长趋势</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {memberStats?.newUsersTrend?.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={memberStats.newUsersTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(v: string) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="count" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} name="新增会员" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400">暂无趋势数据</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Top榜单 */}
        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>投资金额 Top 10</CardTitle>
            </CardHeader>
            <CardContent>
              {memberStats?.topInvestors?.length > 0 ? (
                <div className="space-y-3">
                  {memberStats.topInvestors.map((item: any, idx: number) => (
                    <div key={item.id} className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        idx === 0 ? 'bg-yellow-400 text-white' : 
                        idx === 1 ? 'bg-gray-400 text-white' : 
                        idx === 2 ? 'bg-orange-400 text-white' : 
                        'bg-gray-200 text-gray-600'
                      }`}>
                        {idx + 1}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">{item.username}</div>
                        <div className="text-xs text-gray-500">{item.phone}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-green-600">¥{item.totalInvestment?.toLocaleString()}</div>
                        <div className="text-xs text-gray-500">{item.productCount} 个产品</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">暂无数据</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>收益 Top 10</CardTitle>
            </CardHeader>
            <CardContent>
              {memberStats?.topEnergyUsers?.length > 0 ? (
                <div className="space-y-3">
                  {memberStats.topEnergyUsers.map((item: any, idx: number) => (
                    <div key={item.id} className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        idx === 0 ? 'bg-yellow-400 text-white' : 
                        idx === 1 ? 'bg-gray-400 text-white' : 
                        idx === 2 ? 'bg-orange-400 text-white' : 
                        'bg-gray-200 text-gray-600'
                      }`}>
                        {idx + 1}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">{item.username}</div>
                        <div className="text-xs text-gray-500">{item.phone}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-orange-600">{Number(item.energyValue || 0).toLocaleString()}</div>
                        <div className="text-xs text-gray-500">收益</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">暂无数据</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );

    // 用户管理Tab
    const renderUsersManagementTab = () => (
      <div className="space-y-3 md:space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>用户管理</CardTitle>
            <Button size="sm" variant="outline" onClick={loadAllUsers}>
              <RefreshCw className="w-4 h-4 mr-2" />刷新
            </Button>
          </CardHeader>
          <CardContent>
            {allUsers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left p-3 font-medium text-gray-600">用户名</th>
                      <th className="text-left p-3 font-medium text-gray-600">手机号</th>
                      <th className="text-left p-3 font-medium text-gray-600">角色</th>
                      <th className="text-left p-3 font-medium text-gray-600">所属服务网点</th>
                      <th className="text-left p-3 font-medium text-gray-600">所属服务商</th>
                      <th className="text-left p-3 font-medium text-gray-600">收益</th>
                      <th className="text-left p-3 font-medium text-gray-600">余额</th>
                      <th className="text-left p-3 font-medium text-gray-600">注册时间</th>
                      <th className="text-left p-3 font-medium text-gray-600">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allUsers.map((user) => (
                      <tr key={user.id} className="border-b hover:bg-gray-50">
                        <td className="p-3">
                          <div className="font-medium">{user.username}</div>
                        </td>
                        <td className="p-3 text-gray-600">{user.phone || '-'}</td>
                        <td className="p-3">
                          <Badge className={
                            user.role === 'admin' ? 'bg-red-100 text-red-700' :
                            user.role === 'branch' ? 'bg-blue-100 text-blue-700' :
                            user.role === 'provider' ? 'bg-purple-100 text-purple-700' :
                            'bg-green-100 text-green-700'
                          }>
                            {user.roleName}
                          </Badge>
                        </td>
                        <td className="p-3 text-gray-600">{user.branchName || '-'}</td>
                        <td className="p-3 text-gray-600">{user.providerName || '-'}</td>
                        <td className="p-3">
                          <span className="text-orange-600 font-medium">{Number(user.energyValue || 0).toLocaleString()}</span>
                        </td>
                        <td className="p-3">
                          <span className="text-green-600 font-medium">¥{Number(user.balance || 0).toLocaleString()}</span>
                        </td>
                        <td className="p-3 text-gray-500 text-sm">
                          {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}
                        </td>
                        <td className="p-3">
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => loadMemberDetail(user.id)}
                            >
                              <Eye className="w-4 h-4 mr-1" />详情
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                              onClick={() => handleResetPassword(user.id, user.username)}
                            >
                              <Key className="w-4 h-4 mr-1" />重置
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-400">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>暂无用户数据</p>
                <Button size="sm" variant="outline" className="mt-4" onClick={loadAllUsers}>
                  加载用户列表
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 会员详情弹窗 */}
        {selectedMemberId && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={closeMemberDetail}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden" onClick={e => e.stopPropagation()}>
              {memberDetailLoading ? (
                <div className="flex items-center justify-center py-20">
                  <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
                  <span className="ml-3 text-gray-500">加载中...</span>
                </div>
              ) : memberDetail ? (
                <div className="flex flex-col h-full">
                  {/* 头部 */}
                  <div className="p-6 border-b bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xl font-bold">{memberDetail.user.username}</h3>
                        <p className="text-sm text-gray-500 mt-1">{memberDetail.user.phone} · {memberDetail.user.branchName} · {memberDetail.user.providerName}</p>
                      </div>
                      <button onClick={closeMemberDetail} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
                    </div>
                    {/* 统计卡片 */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
                      <div className="bg-white rounded-lg p-3 border">
                        <div className="text-xs text-gray-500">收益余额</div>
                        <div className="text-lg font-bold text-orange-600">{Number(memberDetail.stats.energyBalance || 0).toLocaleString()}</div>
                      </div>
                      <div className="bg-white rounded-lg p-3 border">
                        <div className="text-xs text-gray-500">累计充值</div>
                        <div className="text-lg font-bold text-green-600">{Number(memberDetail.stats.energyTotalIn || 0).toLocaleString()}</div>
                      </div>
                      <div className="bg-white rounded-lg p-3 border">
                        <div className="text-xs text-gray-500">累计转出</div>
                        <div className="text-lg font-bold text-red-600">{Number(memberDetail.stats.energyTotalOut || 0).toLocaleString()}</div>
                      </div>
                      <div className="bg-white rounded-lg p-3 border">
                        <div className="text-xs text-gray-500">购买次数</div>
                        <div className="text-lg font-bold text-blue-600">{memberDetail.stats.buyCount}</div>
                      </div>
                      <div className="bg-white rounded-lg p-3 border">
                        <div className="text-xs text-gray-500">持有产品</div>
                        <div className="text-lg font-bold text-purple-600">{memberDetail.stats.holdingCount}</div>
                      </div>
                    </div>
                  </div>
                  {/* 子Tab */}
                  <div className="flex border-b px-6 pt-2">
                    <button
                      onClick={() => setMemberDetailTab('holdings')}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        memberDetailTab === 'holdings' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >持仓记录 ({memberDetail.holdings?.length || 0})</button>
                    <button
                      onClick={() => setMemberDetailTab('orders')}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        memberDetailTab === 'orders' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >订单记录 ({memberDetail.orders?.length || 0})</button>
                    <button
                      onClick={() => setMemberDetailTab('energy')}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        memberDetailTab === 'energy' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >收益流水 ({memberDetail.energyRecords?.length || 0})</button>
                  </div>
                  {/* 内容 */}
                  <div className="flex-1 overflow-y-auto p-6">
                    {/* 持仓记录 */}
                    {memberDetailTab === 'holdings' && (
                      memberDetail.holdings?.length > 0 ? (
                        <table className="w-full">
                          <thead>
                            <tr className="border-b bg-gray-50">
                              <th className="text-left p-2 text-sm text-gray-600">产品</th>
                              <th className="text-left p-2 text-sm text-gray-600">周期</th>
                              <th className="text-left p-2 text-sm text-gray-600">购买价</th>
                              <th className="text-left p-2 text-sm text-gray-600">预期收益</th>
                              <th className="text-left p-2 text-sm text-gray-600">市场费</th>
                              <th className="text-left p-2 text-sm text-gray-600">购买日期</th>
                              <th className="text-left p-2 text-sm text-gray-600">状态</th>
                            </tr>
                          </thead>
                          <tbody>
                            {memberDetail.holdings.map((h: any) => (
                              <tr key={h.id} className="border-b hover:bg-gray-50">
                                <td className="p-2 text-sm">{h.productName}</td>
                                <td className="p-2 text-sm">{h.period}天</td>
                                <td className="p-2 text-sm font-medium">¥{Number(h.purchasePrice).toLocaleString()}</td>
                                <td className="p-2 text-sm text-green-600">¥{Number(h.expectedProfit).toLocaleString()}</td>
                                <td className="p-2 text-sm text-orange-600">¥{Number(h.marketFee).toLocaleString()}</td>
                                <td className="p-2 text-sm text-gray-500">{h.purchaseDate ? new Date(h.purchaseDate).toLocaleDateString() : '-'}</td>
                                <td className="p-2">
                                  <Badge className={
                                    h.status === 'holding' ? 'bg-green-100 text-green-700' :
                                    h.status === 'expired' ? 'bg-yellow-100 text-yellow-700' :
                                    'bg-gray-100 text-gray-700'
                                  }>
                                    {h.status === 'holding' ? '持有中' : h.status === 'expired' ? '已到期' : h.status}
                                  </Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : <div className="text-center py-8 text-gray-400">暂无持仓记录</div>
                    )}
                    {/* 订单记录 */}
                    {memberDetailTab === 'orders' && (
                      memberDetail.orders?.length > 0 ? (
                        <table className="w-full">
                          <thead>
                            <tr className="border-b bg-gray-50">
                              <th className="text-left p-2 text-sm text-gray-600">类型</th>
                              <th className="text-left p-2 text-sm text-gray-600">金额</th>
                              <th className="text-left p-2 text-sm text-gray-600">状态</th>
                              <th className="text-left p-2 text-sm text-gray-600">时间</th>
                            </tr>
                          </thead>
                          <tbody>
                            {memberDetail.orders.map((o: any) => (
                              <tr key={o.id} className="border-b hover:bg-gray-50">
                                <td className="p-2 text-sm">
                                  <Badge className={o.orderType === 'buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                                    {o.orderType === 'buy' ? '购买' : '卖出'}
                                  </Badge>
                                </td>
                                <td className="p-2 text-sm font-medium">¥{Number(o.amount).toLocaleString()}</td>
                                <td className="p-2 text-sm">
                                  <Badge className={
                                    o.status === 'completed' ? 'bg-green-100 text-green-700' :
                                    o.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                                    'bg-gray-100 text-gray-700'
                                  }>
                                    {o.status === 'completed' ? '已完成' : o.status === 'pending' ? '待处理' : o.status}
                                  </Badge>
                                </td>
                                <td className="p-2 text-sm text-gray-500">{o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : <div className="text-center py-8 text-gray-400">暂无订单记录</div>
                    )}
                    {/* 收益流水 */}
                    {memberDetailTab === 'energy' && (
                      memberDetail.energyRecords?.length > 0 ? (
                        <table className="w-full">
                          <thead>
                            <tr className="border-b bg-gray-50">
                              <th className="text-left p-2 text-sm text-gray-600">类型</th>
                              <th className="text-left p-2 text-sm text-gray-600">金额</th>
                              <th className="text-left p-2 text-sm text-gray-600">时间</th>
                            </tr>
                          </thead>
                          <tbody>
                            {memberDetail.energyRecords.map((e: any) => {
                              const typeMap: Record<string, string> = {
                                create: '系统创建', quota_match: '额度匹配', purchase: '购买',
                                transfer_in: '转入', transfer_out: '转出', withdraw_freeze: '变现冻结',
                                withdraw: '变现发放', burn: '销毁', recharge: '充值',
                              };
                              const isIn = ['create', 'quota_match', 'transfer_in', 'recharge'].includes(e.type);
                              return (
                                <tr key={e.id} className="border-b hover:bg-gray-50">
                                  <td className="p-2 text-sm">
                                    <Badge className={isIn ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                                      {typeMap[e.type] || e.type}
                                    </Badge>
                                  </td>
                                  <td className={`p-2 text-sm font-medium ${isIn ? 'text-green-600' : 'text-red-600'}`}>
                                    {isIn ? '+' : '-'}{Number(e.amount).toLocaleString()}
                                  </td>
                                  <td className="p-2 text-sm text-gray-500">{e.createdAt ? new Date(e.createdAt).toLocaleDateString() : '-'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      ) : <div className="text-center py-8 text-gray-400">暂无收益流水</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-20 text-gray-400">加载失败</div>
              )}
            </div>
          </div>
        )}
      </div>
    );

    // 渲染当前Tab内容
    const renderTabContent = () => {
      switch (memberTab) {
        case 'upgrade': return renderUpgradeAuditTab();
        case 'energy': return renderEnergyManageTab();
        case 'stats': return renderMemberStatsTab();
        case 'users': return renderUsersManagementTab();
        default: return renderUpgradeAuditTab();
      }
    };

    return (
      <div className="space-y-6 relative z-10">
        {/* 子Tab导航 */}
        <div className="flex gap-1">
          <button
            onClick={() => setMemberTab('upgrade')}
            className={`px-4 py-2 rounded-t-md transition-colors cursor-pointer relative z-10 ${
              memberTab === 'upgrade' 
                ? 'bg-purple-600 text-white' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            升级审核
            {upgradeAuditList.length > 0 && (
              <Badge className="ml-2 bg-red-500 text-white text-xs">{upgradeAuditList.length}</Badge>
            )}
          </button>
          <button
            onClick={() => setMemberTab('energy')}
            className={`px-4 py-2 rounded-t-md transition-colors cursor-pointer relative z-10 ${
              memberTab === 'energy' 
                ? 'bg-purple-600 text-white' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            市场费分配
          </button>
          <button
            onClick={() => setMemberTab('stats')}
            className={`px-4 py-2 rounded-t-md transition-colors cursor-pointer relative z-10 ${
              memberTab === 'stats' 
                ? 'bg-purple-600 text-white' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            会员统计
          </button>
          <button
            onClick={() => { setMemberTab('users'); loadAllUsers(); }}
            className={`px-4 py-2 rounded-t-md transition-colors cursor-pointer relative z-10 ${
              memberTab === 'users' 
                ? 'bg-purple-600 text-white' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            用户管理
          </button>
        </div>
        {renderTabContent()}
      </div>
    );
  });

  // 渲染会员审核
  const renderMemberAudit = () => (
    <Card>
      <CardHeader>
        <CardTitle>会员审核</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-12 text-gray-500">
          <CheckCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg">暂无待审核的会员</p>
          <p className="text-sm">新注册会员将在此显示</p>
        </div>
      </CardContent>
    </Card>
  );

  // 渲染订单统计
  const renderOrderStats = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>订单统计</CardTitle>
          <div className="flex items-center gap-2">
            <Label>时间范围：</Label>
            <Input type="month" defaultValue="2025-04" className="w-40" />
            <Button variant="outline" size="sm"><Printer className="w-4 h-4 mr-1" />打印</Button>
            <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-1" />导出</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis tickFormatter={(value) => `${(value / 10000).toFixed(0)}万`} />
              <Tooltip formatter={(value: number) => `¥${value.toLocaleString()}`} />
              <Legend />
              <Bar dataKey="订单金额" fill="#ef4444" name="订单金额" />
              <Bar dataKey="收益金额" fill="#3b82f6" name="收益金额" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 text-center">
          <div className="p-4 bg-purple-50 rounded-lg">
            <p className="text-sm text-gray-500">总订单数</p>
            <p className="text-2xl font-bold text-purple-600">{stats.total_orders}</p>
          </div>
          <div className="p-4 bg-blue-50 rounded-lg">
            <p className="text-sm text-gray-500">总金额</p>
            <p className="text-2xl font-bold text-blue-600">¥{(stats.total_revenue / 10000).toFixed(0)}万</p>
          </div>
          <div className="p-4 bg-green-50 rounded-lg">
            <p className="text-sm text-gray-500">已完成</p>
            <p className="text-2xl font-bold text-green-600">{orders.filter(o => o.status === 'completed').length}</p>
          </div>
          <div className="p-4 bg-orange-50 rounded-lg">
            <p className="text-sm text-gray-500">待处理</p>
            <p className="text-2xl font-bold text-orange-600">{stats.pending_sell_count}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  // 渲染收益统计
  const renderRevenueStats = () => (
    <Card>
      <CardHeader>
        <CardTitle>收益统计</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis tickFormatter={(value) => `${(value / 10000).toFixed(0)}万`} />
              <Tooltip formatter={(value: number) => `¥${value.toLocaleString()}`} />
              <Legend />
              <Line type="monotone" dataKey="收益金额" stroke="#10b981" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );

  // 渲染收益总览
  const renderIncomeOverview = () => (
    <div className="space-y-3 md:space-y-6">
      {/* 子Tab导航 - 左侧标题 + 右侧Tab样式 */}
      <div className="flex items-stretch bg-gradient-to-r from-purple-900 to-purple-800 rounded-lg overflow-hidden">
        {/* 左侧标题 */}
        <div className="flex items-center gap-3 px-6 py-4 bg-purple-950/50">
          <TrendingUp className="w-5 h-5 text-white" />
          <span className="text-white font-semibold text-lg">市场费分配</span>
        </div>
        {/* 右侧Tab选项 - 简化版3Tab */}
        <div className="flex items-center gap-1 px-4">
          <button
            onClick={() => setIncomeTab('overview')}
            className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
              incomeTab === 'overview' ? 'bg-purple-500 text-white' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'
            }`}
          >
            收益总览
          </button>
          <button
            onClick={() => setIncomeTab('detail')}
            className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
              incomeTab === 'detail' ? 'bg-purple-500 text-white' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'
            }`}
          >
            收益明细
          </button>
          <button
            onClick={() => setIncomeTab('withdraw')}
            className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
              incomeTab === 'withdraw' ? 'bg-purple-500 text-white' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'
            }`}
          >
            提现管理
          </button>
        </div>
      </div>
      
      {/* 收益总览内容 */}
      {incomeTab === 'overview' && (
        <>
          {/* 统计卡片 - 市场费总额 + 今日 + 订单数 + 销售额 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
            <Card className="mobile-compact-card bg-gradient-to-br from-purple-500 to-purple-700 text-white">
              <CardContent className="p-4">
                <div className="text-sm opacity-80 mobile-label">市场费总额</div>
                <div className="text-3xl font-bold mt-1 mobile-num">¥{incomeStats.totalIncome.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card className="mobile-compact-card bg-gradient-to-br from-green-500 to-green-700 text-white">
              <CardContent className="p-4">
                <div className="text-sm opacity-80 mobile-label">今日市场费</div>
                <div className="text-3xl font-bold mt-1 mobile-num">¥{incomeStats.todayIncome.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card className="mobile-compact-card bg-gradient-to-br from-orange-500 to-orange-700 text-white">
              <CardContent className="p-4">
                <div className="text-sm opacity-80 mobile-label">总订单数</div>
                <div className="text-3xl font-bold mt-1 mobile-num">{incomeStats.totalOrders || 0}</div>
              </CardContent>
            </Card>
            <Card className="mobile-compact-card bg-gradient-to-br from-blue-500 to-blue-700 text-white">
              <CardContent className="p-4">
                <div className="text-sm opacity-80 mobile-label">总销售额</div>
                <div className="text-3xl font-bold mt-1 mobile-num">¥{(incomeStats.totalSales || 0).toLocaleString()}</div>
              </CardContent>
            </Card>
          </div>

          {/* 市场费分配比例卡片 - 使用真实分配数据 */}
          <div className="grid grid-cols-5 gap-2 md:gap-3">
            <Card className="mobile-compact-card text-center">
              <CardContent className="p-3">
                <div className="text-xs text-gray-500 mobile-label">服务商 {shareBreakdown.provider.rate}</div>
                <div className="text-lg font-bold text-purple-600 mobile-num">¥{shareBreakdown.provider.amount.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card className="mobile-compact-card text-center">
              <CardContent className="p-3">
                <div className="text-xs text-gray-500 mobile-label">直推奖励 {shareBreakdown.directReward.rate}</div>
                <div className="text-lg font-bold text-pink-600 mobile-num">¥{shareBreakdown.directReward.amount.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card className="mobile-compact-card text-center">
              <CardContent className="p-3">
                <div className="text-xs text-gray-500 mobile-label">上级服务商 {shareBreakdown.parentProvider.rate}</div>
                <div className="text-lg font-bold text-indigo-600 mobile-num">¥{shareBreakdown.parentProvider.amount.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card className="mobile-compact-card text-center">
              <CardContent className="p-3">
                <div className="text-xs text-gray-500 mobile-label">服务网点 {shareBreakdown.branch.rate}</div>
                <div className="text-lg font-bold text-teal-600 mobile-num">¥{shareBreakdown.branch.amount.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card className="mobile-compact-card text-center">
              <CardContent className="p-3">
                <div className="text-xs text-gray-500 mobile-label">公司运营 {shareBreakdown.company.rate}</div>
                <div className="text-lg font-bold text-emerald-600 mobile-num">¥{shareBreakdown.company.amount.toLocaleString()}</div>
              </CardContent>
            </Card>
          </div>

          {/* 收益趋势图表 */}
          <Card>
            <CardHeader>
              <CardTitle>收益趋势</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis tickFormatter={(value) => value >= 10000 ? `${(value / 10000).toFixed(0)}万` : `${value}`} />
                    <Tooltip formatter={(value: number) => `¥${value.toLocaleString()}`} />
                    <Legend />
                    <Line type="monotone" dataKey="收益金额" stroke="#8b5cf6" strokeWidth={2} name="收益金额" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* 收益来源分布 - 市场费分配比例 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6">
            <Card>
              <CardHeader>
                <CardTitle>市场费分配比例</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: `服务商 ${shareBreakdown.provider.rate}`, value: Math.max(shareBreakdown.provider.amount, 1), color: '#8b5cf6' },
                          { name: `直推奖励 ${shareBreakdown.directReward.rate}`, value: Math.max(shareBreakdown.directReward.amount, 1), color: '#ec4899' },
                          { name: `上级服务商 ${shareBreakdown.parentProvider.rate}`, value: Math.max(shareBreakdown.parentProvider.amount, 1), color: '#6366f1' },
                          { name: `服务网点 ${shareBreakdown.branch.rate}`, value: Math.max(shareBreakdown.branch.amount, 1), color: '#14b8a6' },
                          { name: `公司运营 ${shareBreakdown.company.rate}`, value: Math.max(shareBreakdown.company.amount, 1), color: '#10b981' },
                        ]}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {[
                          { color: '#8b5cf6' },
                          { color: '#ec4899' },
                          { color: '#6366f1' },
                          { color: '#14b8a6' },
                          { color: '#10b981' },
                        ].map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>服务商收益排行 TOP5</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {providers.slice(0, 5).map((p: any, idx: number) => {
                    const energy = p.energyValue || p.energy_value || p.totalEnergy || 0;
                    const maxEnergy = (providers[0] as any)?.energyValue || (providers[0] as any)?.energy_value || (providers[0] as any)?.totalEnergy || 1;
                    const percent = Math.max(Math.round((energy / maxEnergy) * 100), 5);
                    return (
                      <div key={p.id || idx} className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          idx === 0 ? 'bg-yellow-500 text-white' :
                          idx === 1 ? 'bg-gray-400 text-white' :
                          idx === 2 ? 'bg-amber-600 text-white' :
                          'bg-gray-200 text-gray-600'
                        }`}>
                          {idx + 1}
                        </div>
                        <div className="flex-1">
                          <div className="flex justify-between text-sm">
                            <span>{p.username || p.name || `服务商${idx + 1}`}</span>
                            <span className="font-medium">{energy.toLocaleString()} 收益</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                            <div
                              className="bg-purple-600 h-1.5 rounded-full"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {providers.length === 0 && (
                    <div className="text-center text-gray-400 py-4">暂无服务商数据</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );

  // 渲染收益明细
  // 渲染收益明细
  const renderIncomeDetail = () => (
    <div className="space-y-3 md:space-y-6">
      {/* 子Tab导航 - 左侧标题 + 右侧Tab样式 */}
      <div className="flex items-stretch bg-gradient-to-r from-purple-900 to-purple-800 rounded-lg overflow-hidden">
        {/* 左侧标题 */}
        <div className="flex items-center gap-3 px-6 py-4 bg-purple-950/50">
          <TrendingUp className="w-5 h-5 text-white" />
          <span className="text-white font-semibold text-lg">市场费分配</span>
        </div>
        {/* 右侧Tab选项 - 简化版3Tab */}
        <div className="flex items-center gap-1 px-4">
          <button
            onClick={() => setIncomeTab('overview')}
            className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
              incomeTab === 'overview' ? 'bg-purple-500 text-white' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'
            }`}
          >
            收益总览
          </button>
          <button
            onClick={() => setIncomeTab('detail')}
            className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
              incomeTab === 'detail' ? 'bg-purple-500 text-white' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'
            }`}
          >
            收益明细
          </button>
          <button
            onClick={() => setIncomeTab('withdraw')}
            className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
              incomeTab === 'withdraw' ? 'bg-purple-500 text-white' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'
            }`}
          >
            提现管理
          </button>
        </div>
      </div>

      {/* 收益明细内容 - 每笔购买订单的市场费分配 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>收益明细（市场费分配）</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => loadIncomeData('detail')}>
                <RefreshCw className="w-4 h-4 mr-2" />刷新
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日期</TableHead>
                <TableHead>产品</TableHead>
                <TableHead>购买价</TableHead>
                <TableHead>市场费</TableHead>
                <TableHead>会员2%</TableHead>
                <TableHead>直推0.3%</TableHead>
                <TableHead>服务商2%</TableHead>
                <TableHead>上级0.3%</TableHead>
                <TableHead>高级0.15%</TableHead>
                <TableHead>网点0.15%</TableHead>
                <TableHead>运营0.10%</TableHead>
                <TableHead>买家</TableHead>
                <TableHead>服务商</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incomeRecords.length > 0 ? incomeRecords.map((record: any) => (
                <TableRow key={record.id}>
                  <TableCell className="font-mono text-sm whitespace-nowrap">{record.date?.substring(0, 10)}</TableCell>
                  <TableCell>
                    <div className="text-sm">{record.productName || '-'}</div>
                    <div className="text-xs text-gray-400">{record.period}天</div>
                  </TableCell>
                  <TableCell className="font-medium">¥{(record.purchasePrice || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-purple-600 font-medium">¥{(record.marketFee || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-purple-500">¥{(record.shareDetail?.member || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-purple-500">¥{(record.shareDetail?.directReward || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-purple-500">¥{(record.shareDetail?.provider || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-teal-500">¥{(record.shareDetail?.parentProvider || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-teal-500">¥{(record.shareDetail?.seniorProvider || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-emerald-500">¥{(record.shareDetail?.branch || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-emerald-500">¥{(record.shareDetail?.company || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-sm">{record.buyerName || '-'}</TableCell>
                  <TableCell className="text-sm">{record.providerName || '-'}</TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-gray-400 py-8">
                    {incomeLoading ? '加载中...' : '暂无收益记录'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );

  // 渲染提现管理（市场费分配Tab）
  const renderWithdrawManagement = () => (
    <div className="space-y-3 md:space-y-6">
      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
        <Card className="mobile-compact-card bg-gradient-to-br from-purple-500 to-purple-700 text-white">
          <CardContent className="p-4">
            <div className="text-sm opacity-80 mobile-label">待审核</div>
            <div className="text-3xl font-bold mt-1 mobile-num">{withdrawStats.pendingCount || 0}</div>
          </CardContent>
        </Card>
        <Card className="mobile-compact-card bg-gradient-to-br from-orange-500 to-orange-700 text-white">
          <CardContent className="p-4">
            <div className="text-sm opacity-80 mobile-label">待发放</div>
            <div className="text-3xl font-bold mt-1 mobile-num">¥{(withdrawStats.pendingAmount || 0).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="mobile-compact-card bg-gradient-to-br from-green-500 to-green-700 text-white">
          <CardContent className="p-4">
            <div className="text-sm opacity-80 mobile-label">已发放</div>
            <div className="text-3xl font-bold mt-1 mobile-num">¥{(withdrawStats.actualPaid || 0).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="mobile-compact-card bg-gradient-to-br from-blue-500 to-blue-700 text-white">
          <CardContent className="p-4">
            <div className="text-sm opacity-80 mobile-label">本月总额</div>
            <div className="text-3xl font-bold mt-1 mobile-num">¥{(withdrawStats.todayAmount || 0).toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      {/* 提现申请表格 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>提现申请列表</CardTitle>
            <Button variant="outline" onClick={() => loadIncomeData('withdraw')}>
              <RefreshCw className="w-4 h-4 mr-2" />刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>申请时间</TableHead>
                <TableHead>申请人</TableHead>
                <TableHead>提现金额</TableHead>
                <TableHead>手续费(5%)</TableHead>
                <TableHead>实发金额</TableHead>
                <TableHead>支付宝</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {withdrawList.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-gray-500 py-8">
                    暂无提现申请记录
                  </TableCell>
                </TableRow>
              ) : withdrawList.map((w: any) => (
                <TableRow key={w.id}>
                  <TableCell className="text-xs">{w.createdAt?.substring(0, 16) || '-'}</TableCell>
                  <TableCell>{w.username || w.userId?.substring(0, 8) || '-'}</TableCell>
                  <TableCell>¥{(w.amount || 0).toLocaleString()}</TableCell>
                  <TableCell>¥{(w.fee || 0).toLocaleString()}</TableCell>
                  <TableCell>¥{(w.actualAmount || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{w.alipayAccount || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={w.status === 'pending' ? 'outline' : w.status === 'approved' ? 'default' : 'secondary'}>
                      {w.status === 'pending' ? '待审核' : w.status === 'approved' ? '已通过' : w.status === 'rejected' ? '已拒绝' : w.status === 'completed' ? '已发放' : w.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {w.status === 'pending' && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="default" onClick={async () => {
                          await authFetch('/api/energy/approve-withdraw', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ requestId: w.id, reviewerId: user!.id, action: 'approve' }),
                          });
                          loadIncomeData('withdraw');
                        }}>通过</Button>
                        <Button size="sm" variant="destructive" onClick={async () => {
                          await authFetch('/api/energy/approve-withdraw', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ requestId: w.id, reviewerId: user!.id, action: 'reject' }),
                          });
                          loadIncomeData('withdraw');
                        }}>拒绝</Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );

  // 渲染财务管理（不使用内部状态，通过父组件financeTab管理）
  const FinanceManagementPanel = React.memo(() => {
    // 加载服务网点提现和手续费记录
    const [branchWithdrawals, setBranchWithdrawals] = useState<any[]>([]);
    const [feeRecords, setFeeRecords] = useState<any[]>([]);
    const [feeStats, setFeeStats] = useState<any>({});
    const [financeLoading, setFinanceLoading] = useState(false);
    const [financeSubTab, setFinanceSubTab] = useState<'overview' | 'withdraw-review' | 'fee-records'>('overview');
    const [feeTypeFilter, setFeeTypeFilter] = useState<string>('all');
    const [feeRoleFilter, setFeeRoleFilter] = useState<string>('all');
    const [feeDateFrom, setFeeDateFrom] = useState<string>('');
    const [feeDateTo, setFeeDateTo] = useState<string>('');
    const [feeSearch, setFeeSearch] = useState<string>('');

    const loadFinanceData = async () => {
      setFinanceLoading(true);
      try {
        const [withdrawalRes, feeRes] = await Promise.all([
          authFetch('/api/admin/withdraw-review'),
          authFetch('/api/admin/fee-records'),
        ]);
        const withdrawalData = await withdrawalRes.json();
        const feeData = await feeRes.json();
        if (withdrawalData.success) setBranchWithdrawals(withdrawalData.data || []);
        if (feeData.success) {
          setFeeRecords(feeData.data?.records || []);
          setFeeStats(feeData.data?.stats || {});
        }
      } catch (err) {
        console.error('加载财务数据失败', err);
      } finally {
        setFinanceLoading(false);
      }
    };

    const handleReviewBranchWithdrawal = async (withdrawalId: string, action: string) => {
      try {
        const res = await authFetch('/api/admin/withdraw-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ withdrawalId, action }),
        });
        const data = await res.json();
        if (data.success) {
          alert(data.data?.message || '操作成功');
          loadFinanceData();
        } else {
          alert(data.error || '操作失败');
        }
      } catch (err) {
        alert('网络错误');
      }
    };

    useEffect(() => { loadFinanceData(); }, []);

    const totalFee = Number(feeStats.total_fee || 0);
    const withdrawFee = Number(feeStats.total_withdrawal_fee || 0);
    const marketFeeOps = Number(feeStats.total_market_fee_ops || 0);
    const pendingWithdrawals = branchWithdrawals.filter((w: any) => w.status === 'pending');

    return (
      <div className="space-y-3 md:space-y-6">
        {/* 子Tab导航 */}
        <div className="flex items-stretch bg-gradient-to-r from-purple-900 to-purple-800 rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 bg-purple-950/50">
            <Wallet className="w-5 h-5 text-white" />
            <span className="text-white font-semibold text-lg">财务管理</span>
          </div>
          <div className="flex items-center gap-1 px-4">
            <button onClick={() => setFinanceSubTab('overview')} className={`px-4 py-2 rounded-md transition-colors ${financeSubTab === 'overview' ? 'bg-purple-500 text-white' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'}`}>财务总览</button>
            <button onClick={() => setFinanceSubTab('withdraw-review')} className={`px-4 py-2 rounded-md transition-colors flex items-center gap-1 ${financeSubTab === 'withdraw-review' ? 'bg-purple-500 text-white' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'}`}>服务网点提现审核{pendingWithdrawals.length > 0 && <Badge className="bg-red-500 text-white text-xs ml-1">{pendingWithdrawals.length}</Badge>}</button>
            <button onClick={() => setFinanceSubTab('fee-records')} className={`px-4 py-2 rounded-md transition-colors ${financeSubTab === 'fee-records' ? 'bg-purple-500 text-white' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'}`}>手续费记录</button>
          </div>
        </div>

        {financeSubTab === 'overview' && (
          <>
            {/* 统计卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
              <Card className="mobile-compact-card bg-gradient-to-br from-purple-500 to-purple-700 text-white">
                <CardContent className="p-4">
                  <div className="text-sm opacity-80">累计手续费沉淀</div>
                  <div className="text-3xl font-bold mt-1">¥{totalFee.toLocaleString()}</div>
                </CardContent>
              </Card>
              <Card className="mobile-compact-card bg-gradient-to-br from-green-500 to-green-700 text-white">
                <CardContent className="p-4">
                  <div className="text-sm opacity-80">提现手续费</div>
                  <div className="text-3xl font-bold mt-1">¥{withdrawFee.toLocaleString()}</div>
                </CardContent>
              </Card>
              <Card className="mobile-compact-card bg-gradient-to-br from-orange-500 to-orange-700 text-white">
                <CardContent className="p-4">
                  <div className="text-sm opacity-80">市场费运营沉淀</div>
                  <div className="text-3xl font-bold mt-1">¥{marketFeeOps.toLocaleString()}</div>
                </CardContent>
              </Card>
              <Card className="mobile-compact-card bg-gradient-to-br from-blue-500 to-blue-700 text-white">
                <CardContent className="p-4">
                  <div className="text-sm opacity-80">待审核服务网点提现</div>
                  <div className="text-3xl font-bold mt-1">{pendingWithdrawals.length}</div>
                </CardContent>
              </Card>
            </div>

            {/* 最近手续费记录 */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>最近手续费记录</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => setFinanceSubTab('fee-records')}>查看全部</Button>
                </div>
              </CardHeader>
              <CardContent>
                {feeRecords.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>时间</TableHead>
                        <TableHead>类型</TableHead>
                        <TableHead>金额</TableHead>
                        <TableHead>来源角色</TableHead>
                        <TableHead>说明</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {feeRecords.slice(0, 10).map((r: any) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-sm">{r.created_at ? new Date(r.created_at).toLocaleDateString() : '-'}</TableCell>
                          <TableCell>{r.type === 'withdrawal_fee' ? '提现手续费' : r.type === 'market_fee_ops' ? '市场费运营' : r.type}</TableCell>
                          <TableCell className="text-green-600 font-medium">+¥{Number(r.amount).toLocaleString()}</TableCell>
                          <TableCell>{r.source_role === 'member' ? '会员' : r.source_role === 'provider' ? '服务商' : r.source_role === 'branch' ? '服务网点' : r.source_role}</TableCell>
                          <TableCell className="text-sm text-gray-500 max-w-xs truncate">{r.note || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-gray-500 text-center py-8">暂无手续费记录</p>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {financeSubTab === 'withdraw-review' && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <FileCheck className="w-5 h-5" />
                  服务网点提现审核
                </CardTitle>
                <Button variant="outline" size="sm" onClick={loadFinanceData} disabled={financeLoading}>
                  <RefreshCw className={`w-4 h-4 mr-1 ${financeLoading ? 'animate-spin' : ''}`} />刷新
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {branchWithdrawals.length > 0 ? (
                <div className="space-y-4">
                  {branchWithdrawals.map((w: any) => (
                    <div key={w.id} className="border rounded-lg p-4 hover:bg-gray-50">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="font-medium">{w.username || '服务网点'}</p>
                          <p className="text-sm text-gray-500">申请时间: {w.created_at ? new Date(w.created_at).toLocaleString() : '-'}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold text-orange-600">¥{Number(w.amount).toLocaleString()}</p>
                          <p className="text-xs text-gray-500">手续费: ¥{Number(w.fee).toLocaleString()} | 实际: ¥{Number(w.actual_amount).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                        <div className="text-gray-600"><span className="font-medium">支付宝:</span> {w.alipay_account || '-'}</div>
                        <div className="text-gray-600"><span className="font-medium">姓名:</span> {w.real_name || '-'}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={w.status === 'pending' ? 'bg-yellow-500' : w.status === 'approved' ? 'bg-blue-500' : w.status === 'transferred' ? 'bg-green-500' : w.status === 'completed' ? 'bg-gray-500' : 'bg-red-500'}>
                          {w.status === 'pending' ? '待审核' : w.status === 'approved' ? '已审核' : w.status === 'transferred' ? '已打款' : w.status === 'completed' ? '已完成' : '已拒绝'}
                        </Badge>
                        {w.status === 'pending' && (
                          <div className="flex gap-2 ml-2">
                            <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleReviewBranchWithdrawal(w.id, 'approve')}>审核通过</Button>
                            <Button size="sm" variant="destructive" onClick={() => handleReviewBranchWithdrawal(w.id, 'reject')}>拒绝</Button>
                          </div>
                        )}
                        {w.status === 'approved' && (
                          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 ml-2" onClick={() => handleReviewBranchWithdrawal(w.id, 'confirm_transfer')}>确认已转账</Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">暂无服务网点提现申请</p>
              )}
            </CardContent>
          </Card>
        )}

        {financeSubTab === 'fee-records' && (() => {
          // 筛选逻辑（使用组件级state）
          const filteredFeeRecords = feeRecords.filter((r: any) => {
            if (feeTypeFilter !== 'all') {
              if (feeTypeFilter === 'withdrawal_fee' && r.type !== 'withdrawal_fee') return false;
              if (feeTypeFilter === 'market_fee_ops' && r.type !== 'market_fee_ops') return false;
            }
            if (feeRoleFilter !== 'all' && r.source_role !== feeRoleFilter) return false;
            if (feeDateFrom && r.created_at && new Date(r.created_at) < new Date(feeDateFrom)) return false;
            if (feeDateTo && r.created_at && new Date(r.created_at) > new Date(feeDateTo + 'T23:59:59')) return false;
            if (feeSearch) {
              const s = feeSearch.toLowerCase();
              const matchNote = (r.note || '').toLowerCase().includes(s);
              const matchAmount = String(r.amount).includes(s);
              const matchRole = (r.source_role === 'member' ? '会员' : r.source_role === 'provider' ? '服务商' : r.source_role === 'branch' ? '服务网点' : r.source_role || '').includes(s);
              if (!matchNote && !matchAmount && !matchRole) return false;
            }
            return true;
          });

          // 统计筛选结果
          const filteredTotal = filteredFeeRecords.reduce((sum: number, r: any) => sum + Number(r.amount), 0);
          const filteredWithdrawFee = filteredFeeRecords.filter((r: any) => r.type === 'withdrawal_fee').reduce((sum: number, r: any) => sum + Number(r.amount), 0);
          const filteredMarketFee = filteredFeeRecords.filter((r: any) => r.type === 'market_fee_ops').reduce((sum: number, r: any) => sum + Number(r.amount), 0);

          return (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle>手续费沉淀记录</CardTitle>
                <div className="flex gap-2 flex-wrap">
                  <div className="bg-green-50 px-3 py-1 rounded text-sm text-green-700">筛选合计: ¥{filteredTotal.toLocaleString()}</div>
                  <div className="bg-blue-50 px-3 py-1 rounded text-sm text-blue-700">提现手续费: ¥{filteredWithdrawFee.toLocaleString()}</div>
                  <div className="bg-orange-50 px-3 py-1 rounded text-sm text-orange-700">市场费运营: ¥{filteredMarketFee.toLocaleString()}</div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* 筛选栏 */}
              <div className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 font-medium">类型筛选</label>
                    <select value={feeTypeFilter} onChange={(e) => setFeeTypeFilter(e.target.value)} className="border rounded-md px-3 py-1.5 text-sm bg-white">
                      <option value="all">全部类型</option>
                      <option value="withdrawal_fee">提现手续费</option>
                      <option value="market_fee_ops">市场费运营</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 font-medium">来源角色</label>
                    <select value={feeRoleFilter} onChange={(e) => setFeeRoleFilter(e.target.value)} className="border rounded-md px-3 py-1.5 text-sm bg-white">
                      <option value="all">全部角色</option>
                      <option value="member">会员</option>
                      <option value="provider">服务商</option>
                      <option value="branch">服务网点</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 font-medium">开始日期</label>
                    <input type="date" value={feeDateFrom} onChange={(e) => setFeeDateFrom(e.target.value)} className="border rounded-md px-3 py-1.5 text-sm bg-white" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 font-medium">结束日期</label>
                    <input type="date" value={feeDateTo} onChange={(e) => setFeeDateTo(e.target.value)} className="border rounded-md px-3 py-1.5 text-sm bg-white" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 font-medium">搜索</label>
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type="text" placeholder="金额/说明/角色" value={feeSearch} onChange={(e) => setFeeSearch(e.target.value)} className="border rounded-md pl-8 pr-3 py-1.5 text-sm bg-white w-40" />
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => { setFeeTypeFilter('all'); setFeeRoleFilter('all'); setFeeDateFrom(''); setFeeDateTo(''); setFeeSearch(''); }} className="h-8">重置</Button>
                </div>
                <div className="text-xs text-gray-400">共 {filteredFeeRecords.length} 条记录</div>
              </div>

              {filteredFeeRecords.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>金额</TableHead>
                      <TableHead>来源角色</TableHead>
                      <TableHead>说明</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredFeeRecords.map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">{r.created_at ? new Date(r.created_at).toLocaleString() : '-'}</TableCell>
                        <TableCell>{r.type === 'withdrawal_fee' ? '提现手续费' : r.type === 'market_fee_ops' ? '市场费运营' : r.type}</TableCell>
                        <TableCell className="text-green-600 font-medium">+¥{Number(r.amount).toLocaleString()}</TableCell>
                        <TableCell>{r.source_role === 'member' ? '会员' : r.source_role === 'provider' ? '服务商' : r.source_role === 'branch' ? '服务网点' : r.source_role}</TableCell>
                        <TableCell className="text-sm text-gray-500 max-w-xs truncate">{r.note || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-gray-500 text-center py-8">暂无匹配的手续费记录</p>
              )}
            </CardContent>
          </Card>
          );
        })()}
      </div>
    );
  });

  // 渲染用户统计
  const renderUserStats = () => (
    <Card>
      <CardHeader>
        <CardTitle>用户统计</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="新用户" fill="#8b5cf6" name="新用户" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );

  // 渲染订单列表
  const renderOrderList = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>普通订单列表</CardTitle>
          <div className="flex gap-2">
            <select 
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border rounded px-3 py-2"
            >
              <option value="all">全部状态</option>
              <option value="pending">待处理</option>
              <option value="completed">已完成</option>
              <option value="cancelled">已取消</option>
            </select>
            <Button variant="outline" onClick={loadData}>
              <RefreshCw className="w-4 h-4 mr-2" />刷新
            </Button>
            <Button className="bg-purple-600">
              <Download className="w-4 h-4 mr-2" />导出
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left py-3 px-4">订单ID</th>
                <th className="text-left py-3 px-4">用户</th>
                <th className="text-left py-3 px-4">算力</th>
                <th className="text-left py-3 px-4">类型</th>
                <th className="text-left py-3 px-4">金额</th>
                <th className="text-left py-3 px-4">状态</th>
                <th className="text-left py-3 px-4">时间</th>
                <th className="text-left py-3 px-4">操作</th>
              </tr>
            </thead>
            <tbody>
              {orders
                .filter(o => statusFilter === 'all' || o.status === statusFilter)
                .map(order => (
                  <tr key={order.id} className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4 text-sm font-mono">{order.id.slice(0, 8)}</td>
                    <td className="py-3 px-4 font-medium">{order.username}</td>
                    <td className="py-3 px-4">{order.product_name}</td>
                    <td className="py-3 px-4">
                      <Badge variant={order.order_type === 'buy' ? 'default' : 'secondary'}>
                        {order.order_type === 'buy' ? '购买' : '卖出'}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-green-600 font-medium">¥{order.amount.toLocaleString()}</td>
                    <td className="py-3 px-4">
                      <Badge className={
                        order.status === 'completed' ? 'bg-green-100 text-green-700' :
                        order.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }>
                        {order.status === 'completed' ? '已完成' : order.status === 'pending' ? '待处理' : '已取消'}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-500">{order.created_at?.slice(0, 16)}</td>
                    <td className="py-3 px-4">
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" title="查看详情"><Eye className="w-4 h-4" /></Button>
                        {order.status === 'pending' && (
                          <>
                            <Button size="sm" variant="ghost" className="text-green-600" title="通过"><CheckCircle className="w-4 h-4" /></Button>
                            <Button size="sm" variant="ghost" className="text-red-600" title="拒绝"><XCircle className="w-4 h-4" /></Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  // 渲染平台仓单管理
  const renderWarehouseOrders = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>平台仓单管理</CardTitle>
          <Button className="bg-purple-600"><Plus className="w-4 h-4 mr-2" />新增仓单</Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left py-3 px-4">仓单编号</th>
                <th className="text-left py-3 px-4">算力名称</th>
                <th className="text-left py-3 px-4">数量</th>
                <th className="text-left py-3 px-4">状态</th>
                <th className="text-left py-3 px-4">创建时间</th>
                <th className="text-left py-3 px-4">操作</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3].map(i => (
                <tr key={i} className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 font-mono">WH{String(i).padStart(6, '0')}</td>
                  <td className="py-3 px-4">Token存储包 {i}</td>
                  <td className="py-3 px-4">{i * 10} 份</td>
                  <td className="py-3 px-4"><Badge className="bg-green-100 text-green-700">可匹配</Badge></td>
                  <td className="py-3 px-4 text-sm text-gray-500">2026-04-0{i}</td>
                  <td className="py-3 px-4">
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost"><Eye className="w-4 h-4" /></Button>
                      <Button size="sm" variant="ghost"><Edit className="w-4 h-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  // 渲染平台仓单匹配
  const renderWarehouseMatch = () => (
    <Card>
      <CardHeader>
        <CardTitle>平台仓单匹配</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h4 className="font-medium mb-3">待匹配订单</h4>
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="p-3 border rounded-lg flex justify-between items-center">
                  <div>
                    <p className="font-medium">订单 #ORD{String(i).padStart(6, '0')}</p>
                    <p className="text-sm text-gray-500">金额: ¥{(i * 10000).toLocaleString()}</p>
                  </div>
                  <Button size="sm">匹配</Button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4 className="font-medium mb-3">可匹配仓单</h4>
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="p-3 border rounded-lg flex justify-between items-center">
                  <div>
                    <p className="font-medium">仓单 #WH{String(i).padStart(6, '0')}</p>
                    <p className="text-sm text-gray-500">剩余: {i * 5} 份</p>
                  </div>
                  <Badge className="bg-green-100 text-green-700">可用</Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  // 渲染预约仓单
  const renderReserveOrders = () => (
    <Card>
      <CardHeader>
        <CardTitle>预约仓单</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left py-3 px-4">预约编号</th>
                <th className="text-left py-3 px-4">用户</th>
                <th className="text-left py-3 px-4">算力</th>
                <th className="text-left py-3 px-4">预约金额</th>
                <th className="text-left py-3 px-4">状态</th>
                <th className="text-left py-3 px-4">预约时间</th>
                <th className="text-left py-3 px-4">操作</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2].map(i => (
                <tr key={i} className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 font-mono">RSV{String(i).padStart(6, '0')}</td>
                  <td className="py-3 px-4">user00{i}</td>
                  <td className="py-3 px-4">Token存储包 {i}</td>
                  <td className="py-3 px-4 text-green-600">¥{(i * 5000).toLocaleString()}</td>
                  <td className="py-3 px-4"><Badge className="bg-blue-100 text-blue-700">等待中</Badge></td>
                  <td className="py-3 px-4 text-sm text-gray-500">2026-04-0{i}</td>
                  <td className="py-3 px-4">
                    <div className="flex gap-2">
                      <Button size="sm">分配</Button>
                      <Button size="sm" variant="ghost">取消</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  // 渲染释放收益记录
  const loadReleaseRecords = async (startDate?: string, endDate?: string) => {
    setReleaseLoading(true);
    try {
      const userStr = localStorage.getItem('user');
      if (!userStr) return;
      const user = JSON.parse(userStr);
      let url = `/api/admin/release-records?adminId=${user.id}`;
      if (startDate) url += `&startDate=${startDate}`;
      if (endDate) url += `&endDate=${endDate}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setReleaseRecords(data.data || []);
      }
    } catch (e) {
      console.error('加载释放收益记录失败', e);
    } finally {
      setReleaseLoading(false);
    }
  };

  const renderReleaseRecords = () => (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            释放收益记录
          </CardTitle>
          <CardDescription>产品购买时总台释放5%收益，按7项比例分配</CardDescription>
        </CardHeader>
        <CardContent>
          {/* 筛选区 */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <Input type="date" className="w-40" value={releaseDateRange.start} onChange={e => setReleaseDateRange(prev => ({...prev, start: e.target.value}))} />
            <span className="text-muted-foreground">至</span>
            <Input type="date" className="w-40" value={releaseDateRange.end} onChange={e => setReleaseDateRange(prev => ({...prev, end: e.target.value}))} />
            <Button onClick={() => loadReleaseRecords(releaseDateRange.start, releaseDateRange.end)}>查询</Button>
            <Button variant="outline" onClick={() => { setReleaseDateRange({start: '', end: ''}); loadReleaseRecords(); }}>全部</Button>
          </div>
          {/* 统计卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <Card className="bg-primary/5">
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">释放总金额</div>
                <div className="text-2xl font-bold text-primary">¥{releaseRecords.reduce((s: number, r: any) => s + (Number(r.release_amount) || 0), 0).toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card className="bg-primary/5">
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">释放笔数</div>
                <div className="text-2xl font-bold text-primary">{releaseRecords.length}</div>
              </CardContent>
            </Card>
            <Card className="bg-primary/5">
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">会员分配</div>
                <div className="text-2xl font-bold text-primary">¥{releaseRecords.reduce((s: number, r: any) => s + (Number(r.member_share) || 0), 0).toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card className="bg-primary/5">
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">服务商分配</div>
                <div className="text-2xl font-bold text-primary">¥{releaseRecords.reduce((s: number, r: any) => s + (Number(r.provider_share) || 0), 0).toLocaleString()}</div>
              </CardContent>
            </Card>
          </div>
          {/* 表格 */}
          {releaseLoading ? (
            <div className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
          ) : releaseRecords.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">暂无释放收益记录</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>产品编号</TableHead>
                    <TableHead>释放时间</TableHead>
                    <TableHead>产品价格</TableHead>
                    <TableHead>释放金额</TableHead>
                    <TableHead>会员</TableHead>
                    <TableHead>会员分配</TableHead>
                    <TableHead>服务商</TableHead>
                    <TableHead>服务商分配</TableHead>
                    <TableHead>服务网点分配</TableHead>
                    <TableHead>平台运营</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {releaseRecords.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.product_name || '-'}</TableCell>
                      <TableCell className="text-xs">{new Date(r.created_at).toLocaleString('zh-CN')}</TableCell>
                      <TableCell>¥{Number(r.product_price).toLocaleString()}</TableCell>
                      <TableCell className="font-bold text-primary">¥{Number(r.release_amount).toLocaleString()}</TableCell>
                      <TableCell>{r.member_name || '-'}</TableCell>
                      <TableCell>¥{Number(r.member_share).toLocaleString()}</TableCell>
                      <TableCell>-</TableCell>
                      <TableCell>¥{Number(r.provider_share).toLocaleString()}</TableCell>
                      <TableCell>¥{Number(r.branch_share).toLocaleString()}</TableCell>
                      <TableCell>¥{Number(r.company_share).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  // 渲染人员账户管理
  const renderAccountsManagement = () => {
    // 加载账户数据
    const loadAccountsData = async () => {
      try {
        const res = await authFetch('/api/admin/accounts');
        const data = await res.json();
        if (data.success) {
          // 存储到state
        }
      } catch (e) {
        console.error('加载账户数据失败', e);
      }
    };

    // 加载财务报表
    const loadFinancialReport = async () => {
      try {
        const res = await authFetch('/api/admin/financial-report');
        const data = await res.json();
        if (data.success) {
          // 存储到state
        }
      } catch (e) {
        console.error('加载财务报表失败', e);
      }
    };

    return (
    <div className="space-y-4">
      {/* 子Tab切换 */}
      <div className="flex gap-2">
        <Button variant={accountsTab === 'list' ? 'default' : 'outline'} size="sm" onClick={() => setAccountsTab('list')}>
          <Users className="w-4 h-4 mr-1" />账户列表
        </Button>
        <Button variant={accountsTab === 'hierarchy' ? 'default' : 'outline'} size="sm" onClick={() => setAccountsTab('hierarchy')}>
          <Network className="w-4 h-4 mr-1" />层级明细
        </Button>
        <Button variant={accountsTab === 'finance' ? 'default' : 'outline'} size="sm" onClick={() => setAccountsTab('finance')}>
          <BarChart3 className="w-4 h-4 mr-1" />财务报表
        </Button>
      </div>

      {/* 账户列表 */}
      {accountsTab === 'list' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              账户列表
            </CardTitle>
            <CardDescription>管理所有账户信息，支持修改身份、状态管控</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 mb-4">
              <Button variant="outline" size="sm" onClick={() => { /* load branches */ }}>
                <Building2 className="w-4 h-4 mr-1" />服务网点
              </Button>
              <Button variant="outline" size="sm" onClick={() => { /* load providers */ }}>
                <Briefcase className="w-4 h-4 mr-1" />服务商
              </Button>
              <Button variant="outline" size="sm" onClick={() => { /* load members */ }}>
                <UserCheck className="w-4 h-4 mr-1" />会员
              </Button>
            </div>
            <BranchesManagement />
          </CardContent>
        </Card>
      )}

      {/* 层级明细 */}
      {accountsTab === 'hierarchy' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Network className="w-5 h-5" />
              层级明细
            </CardTitle>
            <CardDescription>服务网点 → 服务商 → 会员 层级关系</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">加载层级数据中...</div>
          </CardContent>
        </Card>
      )}

      {/* 财务报表 */}
      {accountsTab === 'finance' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              财务报表
            </CardTitle>
            <CardDescription>额度分配与收益比例分析，收益超额度30%预警</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">加载报表数据中...</div>
          </CardContent>
        </Card>
      )}
    </div>
    );
  };

  // 渲染提现审核
  const renderWithdrawAudit = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>提现审核</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" onClick={loadData}>
              <RefreshCw className="w-4 h-4 mr-2" />刷新
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left py-3 px-4">申请ID</th>
                <th className="text-left py-3 px-4">用户</th>
                <th className="text-left py-3 px-4">提现金额</th>
                <th className="text-left py-3 px-4">支付宝账号</th>
                <th className="text-left py-3 px-4">状态</th>
                <th className="text-left py-3 px-4">申请时间</th>
                <th className="text-left py-3 px-4">操作</th>
              </tr>
            </thead>
            <tbody>
              {withdrawals.map(w => (
                <tr key={w.id} className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 font-mono">{w.id}</td>
                  <td className="py-3 px-4 font-medium">{w.username}</td>
                  <td className="py-3 px-4 text-green-600 font-medium">¥{w.amount.toLocaleString()}</td>
                  <td className="py-3 px-4">{w.alipay_account}</td>
                  <td className="py-3 px-4">
                    <Badge className={
                      w.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                      w.status === 'approved' ? 'bg-green-100 text-green-700' :
                      'bg-red-100 text-red-700'
                    }>
                      {w.status === 'pending' ? '待审核' : w.status === 'approved' ? '已通过' : '已拒绝'}
                    </Badge>
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-500">{w.created_at}</td>
                  <td className="py-3 px-4">
                    {w.status === 'pending' && (
                      <div className="flex gap-2">
                        <Button size="sm" className="bg-green-600 hover:bg-green-700">
                          <CheckCircle className="w-4 h-4 mr-1" />通过
                        </Button>
                        <Button size="sm" variant="destructive">
                          <XCircle className="w-4 h-4 mr-1" />拒绝
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  // 渲染充值记录
  const renderRechargeList = () => (
    <Card>
      <CardHeader>
        <CardTitle>充值记录</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-12 text-gray-500">
          <DollarSign className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg">暂无充值记录</p>
        </div>
      </CardContent>
    </Card>
  );

  // 渲染交易流水
  const renderTransactionList = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>交易流水</CardTitle>
          <div className="flex gap-2">
            <Input placeholder="搜索..." className="w-64" />
            <Input type="date" className="w-40" />
            <Button className="bg-purple-600"><Download className="w-4 h-4 mr-2" />导出</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left py-3 px-4">流水号</th>
                <th className="text-left py-3 px-4">用户</th>
                <th className="text-left py-3 px-4">类型</th>
                <th className="text-left py-3 px-4">金额</th>
                <th className="text-left py-3 px-4">余额变化</th>
                <th className="text-left py-3 px-4">时间</th>
                <th className="text-left py-3 px-4">备注</th>
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 5).map((order, i) => (
                <tr key={order.id} className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 font-mono text-sm">{order.id.slice(0, 8)}</td>
                  <td className="py-3 px-4">{order.username}</td>
                  <td className="py-3 px-4">
                    <Badge variant={order.order_type === 'buy' ? 'default' : 'secondary'}>
                      {order.order_type === 'buy' ? '购买' : '卖出'}
                    </Badge>
                  </td>
                  <td className="py-3 px-4 text-green-600">+¥{order.amount.toLocaleString()}</td>
                  <td className="py-3 px-4 text-sm">¥{order.amount.toLocaleString()}</td>
                  <td className="py-3 px-4 text-sm text-gray-500">{order.created_at?.slice(0, 16)}</td>
                  <td className="py-3 px-4 text-sm text-gray-500">-</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  // 渲染聊天管理
  const renderChatManagement = () => (
    <Card>
      <CardHeader>
        <CardTitle>聊天管理</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-12 text-gray-500">
          <MessageSquare className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg">聊天管理功能</p>
          <p className="text-sm">管理用户聊天记录和客服对话</p>
        </div>
      </CardContent>
    </Card>
  );

  // 渲染服务商列表
  const renderProviderList = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>服务商列表</CardTitle>
          <div className="flex gap-2">
            <Input placeholder="搜索服务商..." className="w-64" />
            <Button className="bg-purple-600"><Plus className="w-4 h-4 mr-2" />添加服务商</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left py-3 px-4">ID</th>
                <th className="text-left py-3 px-4">服务商</th>
                <th className="text-left py-3 px-4">总额度</th>
                <th className="text-left py-3 px-4">已用额度</th>
                <th className="text-left py-3 px-4">总销售额</th>
                <th className="text-left py-3 px-4">会员数</th>
                <th className="text-left py-3 px-4">状态</th>
                <th className="text-left py-3 px-4">操作</th>
              </tr>
            </thead>
            <tbody>
              {providers.map(provider => (
                <tr key={provider.id} className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 font-mono text-sm">{provider.id}</td>
                  <td className="py-3 px-4 font-medium">{provider.username}</td>
                  <td className="py-3 px-4">¥{provider.quota.toLocaleString()}</td>
                  <td className="py-3 px-4 text-orange-600">¥{provider.used_quota.toLocaleString()}</td>
                  <td className="py-3 px-4 text-green-600">¥{provider.total_sales.toLocaleString()}</td>
                  <td className="py-3 px-4">{provider.member_count}</td>
                  <td className="py-3 px-4">
                    <Badge className="bg-green-100 text-green-700">正常</Badge>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost"><Eye className="w-4 h-4" /></Button>
                      <Button size="sm" variant="ghost"><Edit className="w-4 h-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  // 渲染服务商审核
  const renderProviderAudit = () => (
    <Card>
      <CardHeader>
        <CardTitle>服务商审核</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-12 text-gray-500">
          <CheckCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg">暂无待审核的服务商</p>
        </div>
      </CardContent>
    </Card>
  );

  // 渲染算力模板
  const renderProductTemplates = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>算力模板</CardTitle>
          <Button onClick={() => setShowTemplateDialog(true)} className="bg-purple-600">
            <Plus className="w-4 h-4 mr-2" />新建模板
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.length > 0 ? templates.map(template => (
            <Card key={template.id} className="border-purple-200 hover:shadow-lg transition-shadow">
              <CardContent className="pt-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h4 className="font-medium text-sm md:text-lg truncate">{template.name}</h4>
                    <p className="text-sm text-gray-500">代码: {template.code}</p>
                  </div>
                  <Badge className={template.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}>
                    {template.status === 'active' ? '启用中' : '已禁用'}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-purple-50 rounded">
                    <p className="text-gray-500">周期</p>
                    <p className="font-medium text-purple-600">{template.period}天</p>
                  </div>
                  <div className="p-2 bg-green-50 rounded">
                    <p className="text-gray-500">总收益率</p>
                    <p className="font-medium text-green-600">{template.total_rate}%</p>
                  </div>
                  <div className="p-2 bg-orange-50 rounded">
                    <p className="text-gray-500">市场费率</p>
                    <p className="font-medium text-orange-600">{template.market_rate}%</p>
                  </div>
                  <div className="p-2 bg-blue-50 rounded">
                    <p className="text-gray-500">会员收益</p>
                    <p className="font-medium text-blue-600">{template.profit_rate}%</p>
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t flex justify-end items-center gap-1">
                  <div className="flex gap-1">

                    <Button size="sm" variant="ghost"><Edit className="w-4 h-4" /></Button>
                    <Button size="sm" variant="ghost" className="text-red-600"><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )) : (
            <div className="col-span-1 md:col-span-2 text-center py-12 text-gray-500">
              <Package className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p>暂无算力模板，点击上方按钮创建</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  // 渲染算力列表
  const renderProductList = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>算力列表</CardTitle>
          <div className="flex gap-2">
            <select className="border rounded px-3 py-2">
              <option value="all">全部状态</option>
              <option value="available">可购买</option>
              <option value="sold">已售出</option>
            </select>
            <Button className="bg-purple-600"><Download className="w-4 h-4 mr-2" />导出</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-center py-12 text-gray-500">
          <Package className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg">算力列表</p>
          <p className="text-sm">服务商创建的算力将在此显示</p>
        </div>
      </CardContent>
    </Card>
  );

  // 渲染系统设置
  const renderSystemConfig = () => {
    if (configLoading) {
      return (
        <Card>
          <CardContent className="p-8 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-3 md:space-y-6">
        {/* 子Tab导航 */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
          <button
            onClick={() => setSystemSubTab('config')}
            className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
              systemSubTab === 'config' 
                ? 'bg-purple-600 text-white' 
                : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            参数配置
          </button>
          <button
            onClick={() => setSystemSubTab('data')}
            className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
              systemSubTab === 'data' 
                ? 'bg-purple-600 text-white' 
                : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            数据管理
          </button>
          <button
            onClick={() => setSystemSubTab('assign-role')}
            className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
              systemSubTab === 'assign-role' 
                ? 'bg-purple-600 text-white' 
                : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            账号赋权
          </button>
          <button
            onClick={() => { setSystemSubTab('invite-code'); if (!adminInviteCode) loadAdminInviteCode(); }}
            className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
              systemSubTab === 'invite-code' 
                ? 'bg-purple-600 text-white' 
                : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            邀请码
          </button>
        </div>

        {systemSubTab === 'config' && (
          <>
        {/* 产品收益配置 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              产品收益配置
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div>
                <Label className="text-sm text-gray-500">3天产品收益率</Label>
                <div className="flex items-center mt-1">
                  <Input 
                    type="number" 
                    value={systemConfig['profit_rate_3d'] || ''}
                    onChange={(e) => handleConfigChange('profit_rate_3d', e.target.value)}
                    className="text-lg font-semibold"
                  />
                  <span className="ml-2 text-gray-500">%</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">会员实际到手: {(parseFloat(systemConfig['profit_rate_3d'] || '0') / 2)}%</p>
              </div>
              <div>
                <Label className="text-sm text-gray-500">7天产品收益率</Label>
                <div className="flex items-center mt-1">
                  <Input 
                    type="number" 
                    value={systemConfig['profit_rate_7d'] || ''}
                    onChange={(e) => handleConfigChange('profit_rate_7d', e.target.value)}
                    className="text-lg font-semibold"
                  />
                  <span className="ml-2 text-gray-500">%</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">会员实际到手: {(parseFloat(systemConfig['profit_rate_7d'] || '0') / 2)}%</p>
              </div>
              <div>
                <Label className="text-sm text-gray-500">15天产品收益率</Label>
                <div className="flex items-center mt-1">
                  <Input 
                    type="number" 
                    value={systemConfig['profit_rate_15d'] || ''}
                    onChange={(e) => handleConfigChange('profit_rate_15d', e.target.value)}
                    className="text-lg font-semibold"
                  />
                  <span className="ml-2 text-gray-500">%</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">会员实际到手: {(parseFloat(systemConfig['profit_rate_15d'] || '0') / 2)}%</p>
              </div>
              <div>
                <Label className="text-sm text-gray-500">30天产品收益率</Label>
                <div className="flex items-center mt-1">
                  <Input 
                    type="number" 
                    value={systemConfig['profit_rate_30d'] || ''}
                    onChange={(e) => handleConfigChange('profit_rate_30d', e.target.value)}
                    className="text-lg font-semibold"
                  />
                  <span className="ml-2 text-gray-500">%</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">会员实际到手: {(parseFloat(systemConfig['profit_rate_30d'] || '0') / 2)}%</p>
              </div>
              <div>
                <Label className="text-sm text-gray-500">90天产品收益率</Label>
                <div className="flex items-center mt-1">
                  <Input 
                    type="number" 
                    value={systemConfig['profit_rate_90d'] || ''}
                    onChange={(e) => handleConfigChange('profit_rate_90d', e.target.value)}
                    className="text-lg font-semibold"
                  />
                  <span className="ml-2 text-gray-500">%</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">会员实际到手: {(parseFloat(systemConfig['profit_rate_90d'] || '0') / 2)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 市场费分配配置 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5" />
              市场费分配比例
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <Label className="text-sm text-gray-500">服务商</Label>
                <div className="flex items-center mt-1">
                  <Input 
                    type="number" 
                    value={systemConfig['energy_allocation_provider'] || ''}
                    onChange={(e) => handleConfigChange('energy_allocation_provider', e.target.value)}
                    className="text-lg font-semibold"
                  />
                  <span className="ml-2 text-gray-500">%</span>
                </div>
              </div>
              <div>
                <Label className="text-sm text-gray-500">公司运营</Label>
                <div className="flex items-center mt-1">
                  <Input 
                    type="number" 
                    value={systemConfig['energy_allocation_company'] || ''}
                    onChange={(e) => handleConfigChange('energy_allocation_company', e.target.value)}
                    className="text-lg font-semibold"
                  />
                  <span className="ml-2 text-gray-500">%</span>
                </div>
              </div>
              <div>
                <Label className="text-sm text-gray-500">直推奖励</Label>
                <div className="flex items-center mt-1">
                  <Input 
                    type="number" 
                    value={systemConfig['energy_allocation_direct'] || ''}
                    onChange={(e) => handleConfigChange('energy_allocation_direct', e.target.value)}
                    className="text-lg font-semibold"
                  />
                  <span className="ml-2 text-gray-500">%</span>
                </div>
              </div>
              <div>
                <Label className="text-sm text-gray-500">上级服务商</Label>
                <div className="flex items-center mt-1">
                  <Input 
                    type="number" 
                    value={systemConfig['energy_allocation_parent_provider'] || ''}
                    onChange={(e) => handleConfigChange('energy_allocation_parent_provider', e.target.value)}
                    className="text-lg font-semibold"
                  />
                  <span className="ml-2 text-gray-500">%</span>
                </div>
              </div>
              <div>
                <Label className="text-sm text-gray-500">服务网点</Label>
                <div className="flex items-center mt-1">
                  <Input 
                    type="number" 
                    value={systemConfig['energy_allocation_branch'] || ''}
                    onChange={(e) => handleConfigChange('energy_allocation_branch', e.target.value)}
                    className="text-lg font-semibold"
                  />
                  <span className="ml-2 text-gray-500">%</span>
                </div>
              </div>
            </div>
            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600">
                <strong>分配说明：</strong>会员卖出产品时，需要用收益支付市场费。市场费按比例分配给各方。
                <br />
                <span className="text-xs text-gray-400">
                  总计: {(parseFloat(systemConfig['energy_allocation_provider'] || '0') + 
                    parseFloat(systemConfig['energy_allocation_company'] || '0') + 
                    parseFloat(systemConfig['energy_allocation_direct'] || '0') + 
                    parseFloat(systemConfig['energy_allocation_parent_provider'] || '0') + 
                    parseFloat(systemConfig['energy_allocation_branch'] || '0'))}%
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 额度与变现配置 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="w-5 h-5" />
              额度与变现配置
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-sm text-gray-500">额度申请赠送收益比例</Label>
                <div className="flex items-center mt-1">
                  <Input 
                    type="number" 
                    value={systemConfig['quota_energy_bonus_ratio'] || ''}
                    onChange={(e) => handleConfigChange('quota_energy_bonus_ratio', e.target.value)}
                    className="text-lg font-semibold"
                  />
                  <span className="ml-2 text-gray-500">%</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">申请1万额度赠送N收益</p>
              </div>
              <div>
                <Label className="text-sm text-gray-500">变现手续费率</Label>
                <div className="flex items-center mt-1">
                  <Input 
                    type="number" 
                    value={systemConfig['withdraw_fee_rate'] || ''}
                    onChange={(e) => handleConfigChange('withdraw_fee_rate', e.target.value)}
                    className="text-lg font-semibold"
                  />
                  <span className="ml-2 text-gray-500">%</span>
                </div>
              </div>
              <div>
                <Label className="text-sm text-gray-500">最低提现金额</Label>
                <div className="flex items-center mt-1">
                  <span className="text-gray-500 mr-1">¥</span>
                  <Input 
                    type="number" 
                    value={systemConfig['min_withdraw_amount'] || ''}
                    onChange={(e) => handleConfigChange('min_withdraw_amount', e.target.value)}
                    className="text-lg font-semibold"
                  />
                </div>
              </div>
              <div>
                <Label className="text-sm text-gray-500">收益兑换比例</Label>
                <div className="flex items-center mt-1">
                  <span className="text-gray-500 mr-1">1收益=</span>
                  <Input 
                    type="number" 
                    step="0.01"
                    value={systemConfig['energy_to_money_ratio'] || ''}
                    onChange={(e) => handleConfigChange('energy_to_money_ratio', e.target.value)}
                    className="text-lg font-semibold w-20"
                  />
                  <span className="ml-1 text-gray-500">元</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 平台基础配置 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              平台基础配置
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm text-gray-500">平台名称</Label>
                <Input 
                  value={systemConfig['platform_name'] || ''}
                  onChange={(e) => handleConfigChange('platform_name', e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm text-gray-500">客服电话</Label>
                <Input 
                  value={systemConfig['service_phone'] || ''}
                  onChange={(e) => handleConfigChange('service_phone', e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm text-gray-500">流转有效期</Label>
                <div className="flex items-center mt-1">
                  <Input 
                    type="number" 
                    value={systemConfig['transfer_expire_hours'] || ''}
                    onChange={(e) => handleConfigChange('transfer_expire_hours', e.target.value)}
                    className="text-lg font-semibold"
                  />
                  <span className="ml-2 text-gray-500">小时</span>
                </div>
              </div>
              <div>
                <Label className="text-sm text-gray-500">收益积分比例</Label>
                <div className="flex items-center mt-1">
                  <Input 
                    type="number" 
                    value={systemConfig['profit_points_ratio'] || ''}
                    onChange={(e) => handleConfigChange('profit_points_ratio', e.target.value)}
                    className="text-lg font-semibold"
                  />
                  <span className="ml-2 text-gray-500">%</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 保存按钮 */}
        <div className="flex justify-end gap-3">
          <Button 
            variant="outline" 
            onClick={() => loadSystemConfig()}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            重置
          </Button>
          <Button 
            className="bg-purple-600 hover:bg-purple-700"
            onClick={saveSystemConfig}
            disabled={configSaving}
          >
            {configSaving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4 mr-2" />
            )}
            保存配置
          </Button>
        </div>
          </>
        )}

        {systemSubTab === 'data' && (
          /* 数据管理Tab */
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-600">
                <Trash2 className="w-5 h-5" />
                数据管理
              </CardTitle>
              <CardDescription>开发阶段专用功能，清除测试数据</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 md:space-y-6">
              {/* 操作说明 */}
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-yellow-800 font-medium">危险操作警告</p>
                    <p className="text-xs text-yellow-700 mt-1">此操作将永久清除以下数据，且无法恢复：</p>
                    <ul className="text-xs text-yellow-700 mt-2 list-disc list-inside space-y-1">
                      <li>所有收益账户和流水记录</li>
                      <li>所有算力额度和分配记录</li>
                      <li>所有服务商配置信息</li>
                      <li>所有产品、订单和持仓数据</li>
                      <li>重置所有用户的收益和余额为0</li>
                    </ul>
                    <p className="text-xs text-yellow-700 mt-2">操作前请确认已备份重要数据！</p>
                  </div>
                </div>
              </div>

              {/* 密码验证 */}
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">请输入管理员密码确认操作</Label>
                  <Input 
                    type="password"
                    placeholder="请输入密码"
                    value={clearDataPassword}
                    onChange={(e) => setClearDataPassword(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div className="flex gap-3">
                  <Button 
                    variant="destructive"
                    onClick={handleClearEnergyData}
                    disabled={clearDataLoading || !clearDataPassword}
                  >
                    {clearDataLoading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-2" />
                    )}
                    清除收益数据
                  </Button>
                  <Button 
                    variant="destructive"
                    onClick={handleClearQuotaData}
                    disabled={clearDataLoading || !clearDataPassword}
                  >
                    {clearDataLoading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-2" />
                    )}
                    清除算力额度数据
                  </Button>
                  <Button 
                    variant="destructive"
                    onClick={handleClearAllData}
                    disabled={clearDataLoading || !clearDataPassword}
                  >
                    {clearDataLoading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-2" />
                    )}
                    一键清除所有业务数据
                  </Button>
                </div>
                {clearDataMessage && (
                  <div className={`p-3 rounded-lg text-sm ${
                    clearDataMessage.type === 'success' 
                      ? 'bg-green-50 text-green-700 border border-green-200' 
                      : 'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    {clearDataMessage.text}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 账号赋权Tab */}
        {systemSubTab === 'assign-role' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                账号赋权
              </CardTitle>
              <CardDescription>指定账号赋予任意角色身份（智算总台/服务网点/服务商/会员）</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 搜索区域 */}
              <div className="flex gap-2">
                <Input
                  placeholder="输入用户名/手机号/专属ID搜索"
                  value={assignSearchKeyword}
                  onChange={(e) => setAssignSearchKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchUsersForAssign()}
                  className="flex-1"
                />
                <Button 
                  onClick={searchUsersForAssign} 
                  disabled={assignSearching || assignSearchKeyword.length < 2}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  {assignSearching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
                  搜索
                </Button>
              </div>

              {/* 操作提示 */}
              {assignMessage && (
                <div className={`p-3 rounded-lg text-sm ${
                  assignMessage.type === 'success' 
                    ? 'bg-green-50 text-green-700 border border-green-200' 
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {assignMessage.text}
                </div>
              )}

              {/* 搜索结果 */}
              {assignSearchResults.length > 0 && (
                <div className="space-y-3">
                  {assignSearchResults.map((u: any) => {
                    const roleLabels: Record<string, string> = { admin: '智算总台', branch: '服务网点', provider: '服务商', member: '会员' };
                    const roleColors: Record<string, string> = { 
                      admin: 'bg-red-100 text-red-700', 
                      branch: 'bg-blue-100 text-blue-700', 
                      provider: 'bg-purple-100 text-purple-700', 
                      member: 'bg-green-100 text-green-700' 
                    };
                    return (
                      <div key={u.id} className="p-4 border rounded-lg flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{u.username}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${roleColors[u.role] || 'bg-gray-100 text-gray-700'}`}>
                              {roleLabels[u.role] || u.role}
                            </span>
                            {u.unique_id && <span className="text-xs text-gray-400">[{u.unique_id}]</span>}
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            {u.phone && <span>{u.phone}</span>}
                            {u.branch_name && <span className="ml-3">服务网点: {u.branch_name}</span>}
                            {u.provider_name && <span className="ml-3">服务商: {u.provider_name}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <select 
                            id={`role-select-${u.id}`}
                            className="text-sm border rounded-md px-3 py-1.5 bg-white"
                            defaultValue=""
                          >
                            <option value="" disabled>选择角色</option>
                            <option value="admin">智算总台</option>
                            <option value="branch">服务网点</option>
                            <option value="provider">服务商</option>
                            <option value="member">会员</option>
                          </select>
                          <Button 
                            size="sm"
                            onClick={() => {
                              const select = document.getElementById(`role-select-${u.id}`) as HTMLSelectElement;
                              if (select && select.value) {
                                handleAssignRole(u.id, select.value, u.username);
                              }
                            }}
                            disabled={assignLoading}
                            className="bg-purple-600 hover:bg-purple-700"
                          >
                            {assignLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : '赋权'}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 空状态 */}
              {assignSearchResults.length === 0 && !assignMessage && (
                <div className="text-center py-8 text-gray-400">
                  <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>输入用户名、手机号或专属ID搜索用户</p>
                  <p className="text-sm mt-1">搜索后可选择目标角色进行赋权</p>
                </div>
              )}

              {/* 赋权说明 */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800 font-medium">赋权规则说明</p>
                <ul className="text-xs text-blue-700 mt-2 list-disc list-inside space-y-1">
                  <li><strong>智算总台</strong>：拥有系统最高权限，可管理所有数据和账号</li>
                  <li><strong>服务网点</strong>：管理下级服务商和会员，分配额度</li>
                  <li><strong>服务商</strong>：生成和上架产品，管理会员，审核交易</li>
                  <li><strong>会员</strong>：购买产品，查看持仓，管理收益</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 邀请码Tab */}
        {systemSubTab === 'invite-code' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Ticket className="w-5 h-5" />
                智算总台邀请码
              </CardTitle>
              <CardDescription>使用智算总台邀请码注册的账号将自动成为服务网点角色</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {inviteCodeMessage && (
                <div className={`p-3 rounded-lg text-sm ${
                  inviteCodeMessage.type === 'success' 
                    ? 'bg-green-50 text-green-700 border border-green-200' 
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {inviteCodeMessage.text}
                </div>
              )}

              {/* 邀请码展示 */}
              <div className="p-6 bg-gradient-to-br from-purple-50 to-blue-50 border-2 border-dashed border-purple-200 rounded-xl text-center">
                <p className="text-sm text-gray-500 mb-2">智算总台专属邀请码</p>
                {inviteCodeLoading ? (
                  <Loader2 className="w-8 h-8 animate-spin text-purple-600 mx-auto" />
                ) : adminInviteCode ? (
                  <>
                    <p className="text-3xl font-bold text-purple-700 tracking-widest">{adminInviteCode}</p>
                    <p className="text-xs text-gray-400 mt-2">使用此邀请码注册 → 自动成为服务网点</p>
                    <div className="flex justify-center gap-3 mt-4">
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard.writeText(adminInviteCode);
                          setInviteCodeMessage({ type: 'success', text: '邀请码已复制到剪贴板' });
                          setTimeout(() => setInviteCodeMessage(null), 2000);
                        }}
                      >
                        复制邀请码
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => {
                          const link = `${window.location.origin}/?invite=${adminInviteCode}`;
                          navigator.clipboard.writeText(link);
                          setInviteCodeMessage({ type: 'success', text: '邀请链接已复制到剪贴板' });
                          setTimeout(() => setInviteCodeMessage(null), 2000);
                        }}
                      >
                        复制邀请链接
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-gray-400">点击下方按钮生成邀请码</p>
                )}
              </div>

              {/* 生成/刷新按钮 */}
              <div className="flex justify-center">
                <Button 
                  onClick={loadAdminInviteCode}
                  disabled={inviteCodeLoading}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  {inviteCodeLoading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Ticket className="w-4 h-4 mr-2" />
                  )}
                  {adminInviteCode ? '刷新邀请码' : '生成邀请码'}
                </Button>
              </div>

              {/* 邀请码规则说明 */}
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800 font-medium">邀请码类型说明</p>
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-yellow-700">
                    <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded font-mono">ADMIN</span>
                    <span>智算总台邀请码 → 注册为<strong>服务网点</strong></span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-yellow-700">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-mono">BRAN</span>
                    <span>服务网点邀请码 → 注册为<strong>服务商</strong></span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-yellow-700">
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded font-mono">PROV</span>
                    <span>服务商邀请码 → 注册为<strong>会员</strong>（绑定该服务商）</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-yellow-700">
                    <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded font-mono">MEMB</span>
                    <span>会员邀请码 → 注册为<strong>会员</strong>（绑定同服务商）</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };
  const renderAnnouncements = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>公告管理</CardTitle>
          <Button className="bg-purple-600"><Plus className="w-4 h-4 mr-2" />发布公告</Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="p-4 border rounded-lg">
            <div className="flex justify-between items-start">
              <div>
                <h4 className="font-medium">系统升级公告</h4>
                <p className="text-sm text-gray-500 mt-1">系统将于4月5日凌晨进行升级维护...</p>
              </div>
              <div className="flex gap-2">
                <Badge className="bg-green-100 text-green-700">已发布</Badge>
                <Button size="sm" variant="ghost"><Edit className="w-4 h-4" /></Button>
              </div>
            </div>
          </div>
          <div className="p-4 border rounded-lg">
            <div className="flex justify-between items-start">
              <div>
                <h4 className="font-medium">新功能上线</h4>
                <p className="text-sm text-gray-500 mt-1">新增预约仓单功能，欢迎体验...</p>
              </div>
              <div className="flex gap-2">
                <Badge className="bg-green-100 text-green-700">已发布</Badge>
                <Button size="sm" variant="ghost"><Edit className="w-4 h-4" /></Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  // 智算总台 - 服务网点变现管理（原提现管理）
  const renderBranchWithdrawManagement = () => {
    const handleReview = async (id: string, action: 'approve' | 'reject') => {
      setProcessingId(id);
      try {
        const adminId = localStorage.getItem('userId');
        const res = await authFetch('/api/admin/branch-withdraw-review', {
          method: 'POST',
          body: JSON.stringify({ requestId: id, action, adminId, note: withdrawNote }),
        });
        const data = await res.json();
        if (data.success) {
          setMessage({ type: 'success', text: data.message });
          // 重新加载数据
          const withdrawRes = await authFetch('/api/admin/branch-withdraw-list');
          const withdrawData = await withdrawRes.json();
          if (withdrawData.success) {
            setBranchWithdrawals(withdrawData.data?.records || []);
          }
        } else {
          setMessage({ type: 'error', text: data.error });
        }
      } catch (error) {
        setMessage({ type: 'error', text: '处理失败' });
      } finally {
        setProcessingId(null);
      }
    };

    // 计算统计
    const pendingCount = branchWithdrawals.filter((w: any) => {
      const details = typeof w.description === 'string' ? JSON.parse(w.description || '{}') : (w.description || {});
      return details.status === 'pending';
    }).length;

    const totalApproved = branchWithdrawals.reduce((sum: number, w: any) => {
      const details = typeof w.description === 'string' ? JSON.parse(w.description || '{}') : (w.description || {});
      if (details.status === 'approved') return sum + (w.amount || 0);
      return sum;
    }, 0);

    const totalRejected = branchWithdrawals.reduce((sum: number, w: any) => {
      const details = typeof w.description === 'string' ? JSON.parse(w.description || '{}') : (w.description || {});
      if (details.status === 'rejected') return sum + (w.amount || 0);
      return sum;
    }, 0);

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-gray-500">待审核</div>
              <div className="text-2xl font-bold text-orange-600">{pendingCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-gray-500">已通过</div>
              <div className="text-2xl font-bold text-green-600">{totalApproved.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-gray-500">已拒绝</div>
              <div className="text-2xl font-bold text-red-600">{totalRejected.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-gray-500">总记录</div>
              <div className="text-2xl font-bold">{branchWithdrawals.length}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex gap-4">
                <button
                  onClick={() => setWithdrawTab('deposit')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    withdrawTab === 'deposit' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  服务网点变现申请
                </button>
                <button
                  onClick={() => setWithdrawTab('records')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    withdrawTab === 'records' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  沉淀记录
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {withdrawTab === 'deposit' ? (
              <div className="space-y-4">
                <div className="text-sm text-gray-500">
                  <p>• 服务网点向智算总台变现收益</p>
                  <p>• 智算总台线下转账后确认到账，收益从服务网点扣除</p>
                  <p>• 拒绝后收益将返还给服务网点</p>
                </div>

                {branchWithdrawals.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    暂无变现申请
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>申请时间</TableHead>
                        <TableHead>服务网点</TableHead>
                        <TableHead>变现金额</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {branchWithdrawals.map((withdraw: any) => {
                        const details = typeof withdraw.description === 'string' 
                          ? JSON.parse(withdraw.description || '{}') 
                          : (withdraw.description || {});
                        const isPending = details.status === 'pending';
                        
                        return (
                          <TableRow key={withdraw.id}>
                            <TableCell>{new Date(withdraw.created_at).toLocaleString()}</TableCell>
                            <TableCell>
                              <div>
                                <div className="font-medium">{withdraw.from_user?.username || '-'}</div>
                                <div className="text-xs text-gray-500">{withdraw.from_user?.unique_id || ''}</div>
                              </div>
                            </TableCell>
                            <TableCell className="font-medium text-blue-600">
                              {withdraw.amount?.toLocaleString()} 收益
                            </TableCell>
                            <TableCell>
                              <Badge className={
                                details.status === 'approved' ? 'bg-green-100 text-green-700' :
                                details.status === 'rejected' ? 'bg-red-100 text-red-700' :
                                'bg-yellow-100 text-yellow-700'
                              }>
                                {details.status === 'approved' ? '已通过' :
                                 details.status === 'rejected' ? '已拒绝' : '待审核'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {isPending && (
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    className="bg-green-600 hover:bg-green-700"
                                    disabled={processingId === withdraw.id}
                                    onClick={() => handleReview(withdraw.id, 'approve')}
                                  >
                                    {processingId === withdraw.id ? '处理中...' : '确认转账'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    disabled={processingId === withdraw.id}
                                    onClick={() => handleReview(withdraw.id, 'reject')}
                                  >
                                    拒绝
                                  </Button>
                                </div>
                              )}
                              {!isPending && details.note && (
                                <span className="text-sm text-gray-500">备注: {details.note}</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-sm text-gray-500">
                  <p>• 展示所有服务网点变现通过的记录（5%手续费沉淀）</p>
                  <p>• 沉淀比例：变现金额的5%作为平台手续费</p>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>服务网点</TableHead>
                      <TableHead>变现金额</TableHead>
                      <TableHead>沉淀金额(5%)</TableHead>
                      <TableHead>状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {branchWithdrawals
                      .filter((w: any) => {
                        const details = typeof w.description === 'string' 
                          ? JSON.parse(w.description || '{}') 
                          : (w.description || {});
                        return details.status === 'approved';
                      })
                      .map((withdraw: any) => {
                        const details = typeof withdraw.description === 'string' 
                          ? JSON.parse(withdraw.description || '{}') 
                          : (withdraw.description || {});
                        const depositAmount = Math.floor((withdraw.amount || 0) * 0.05);
                        
                        return (
                          <TableRow key={withdraw.id}>
                            <TableCell>{new Date(withdraw.created_at).toLocaleString()}</TableCell>
                            <TableCell>
                              <div>
                                <div className="font-medium">{withdraw.from_user?.username || '-'}</div>
                                <div className="text-xs text-gray-500">{withdraw.from_user?.unique_id || ''}</div>
                              </div>
                            </TableCell>
                            <TableCell className="font-medium">
                              {withdraw.amount?.toLocaleString()} 收益
                            </TableCell>
                            <TableCell className="font-medium text-purple-600">
                              {depositAmount.toLocaleString()} 收益
                            </TableCell>
                            <TableCell>
                              <Badge className="bg-green-100 text-green-700">已沉淀</Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    {branchWithdrawals.filter((w: any) => {
                      const details = typeof w.description === 'string' 
                        ? JSON.parse(w.description || '{}') 
                        : (w.description || {});
                      return details.status === 'approved';
                    }).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                          暂无沉淀记录
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>

                <div className="bg-purple-50 p-4 rounded-lg">
                  <h4 className="font-medium text-purple-800 mb-2">沉淀统计</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-4">
                    <div>
                      <div className="text-sm text-gray-500">通过笔数</div>
                      <div className="text-xl font-bold text-purple-600">
                        {branchWithdrawals.filter((w: any) => {
                          const details = typeof w.description === 'string' 
                            ? JSON.parse(w.description || '{}') 
                            : (w.description || {});
                          return details.status === 'approved';
                        }).length}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">总变现金额</div>
                      <div className="text-xl font-bold text-purple-600">
                        {totalApproved.toLocaleString()} 收益
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">累计沉淀</div>
                      <div className="text-xl font-bold text-purple-600">
                        {Math.floor(totalApproved * 0.05).toLocaleString()} 收益
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  // 智算总台 - 市场费分配（独立组件）
  const EnergyManagement = () => {
    const [energyTab, setEnergyTab] = useState<'overview' | 'accounts' | 'transactions' | 'request' | 'withdraw' | 'fee'>('overview');
    const [energyData, setEnergyData] = useState<any>(null);
    const [energyAccounts, setEnergyAccounts] = useState<any[]>([]);
    const [energyTransactions, setEnergyTransactions] = useState<any[]>([]);
    const [energyLoading, setEnergyLoading] = useState(false);
    const [energyTransactionType, setEnergyTransactionType] = useState<string>('all');
    const [branchEnergyRequests, setBranchEnergyRequests] = useState<any[]>([]);
    const [branchEnergyPendingCount, setBranchEnergyPendingCount] = useState(0);
    const [showReleaseDialog, setShowReleaseDialog] = useState(false);
    const [releaseForm, setReleaseForm] = useState({ toUserId: '', amount: '', note: '' });
    const [showTransferDialog, setShowTransferDialog] = useState(false);
    const [transferForm, setTransferForm] = useState({ toUserId: '', amount: '', note: '' });
    const [userSearchQuery, setUserSearchQuery] = useState('');
    const [showUserDropdown, setShowUserDropdown] = useState(false);
    const [allUsersList, setAllUsersList] = useState<any[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [withdrawRequests, setWithdrawRequests] = useState<any[]>([]);
    const [withdrawStats, setWithdrawStats] = useState<any>(null);
    const [withdrawFilter, setWithdrawFilter] = useState<string>(''); // 变现审核筛选状态
    const [branchList, setBranchList] = useState<any[]>([]); // 服务网点列表
    const searchContainerRef = useRef<HTMLDivElement>(null); // 搜索容器 ref
    const isMountedRef = useRef(true); // 组件卸载标记

    // 显示消息
    const showMessage = (type: 'success' | 'error', text: string) => {
      setMessage({ type, text });
      setTimeout(() => setMessage(null), 3000);
    };

    // 组件卸载时设置标记
    useEffect(() => {
      return () => {
        isMountedRef.current = false;
      };
    }, []);

    // 点击外部关闭下拉
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
          setShowUserDropdown(false);
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // 加载服务网点收益申请记录
    const loadBranchEnergyRequestsInComponent = async () => {
      if (!isMountedRef.current) return;
      setEnergyLoading(true);
      try {
        const response = await authFetch('/api/energy/branch-request');
        if (!isMountedRef.current) return;
        if (!response.ok) {
          setEnergyLoading(false);
          return;
        }
        const data = await response.json();
        if (data.success && data.data) {
          setBranchEnergyRequests(data.data.records || []);
          setBranchEnergyPendingCount(data.data.stats?.pending?.count || 0);
        }
      } catch (error) {
        if (isMountedRef.current) {
          console.error('加载服务网点收益申请失败:', error);
        }
      } finally {
        if (isMountedRef.current) {
          setEnergyLoading(false);
        }
      }
    };

    // 审核服务网点收益申请
    const handleApproveBranchEnergyRequestInComponent = async (requestId: string, action: 'approve' | 'reject', note?: string) => {
      const adminId = localStorage.getItem('userId');
      if (!adminId) return;

      setSubmitting(true);
      try {
        const response = await authFetch('/api/energy/approve-branch-request', {
          method: 'POST',
          body: JSON.stringify({
            requestId,
            adminId,
            action,
            note,
          }),
        });

        const data = await response.json();
        if (data.success) {
          showMessage('success', data.message || '操作成功');
          loadBranchEnergyRequestsInComponent();
          loadEnergyOverview();
          loadBranchEnergyPendingCount();
        } else {
          showMessage('error', data.error || '操作失败');
        }
      } catch (error) {
        showMessage('error', '网络错误');
      } finally {
        setSubmitting(false);
      }
    };

    // 申请审核视图（EnergyManagement组件内）
    const renderRequestTabInComponent = () => {
      const pendingRequests = branchEnergyRequests.filter((r: any) => r.status === 'pending');
      const approvedRequests = branchEnergyRequests.filter((r: any) => r.status === 'approved');
      const rejectedRequests = branchEnergyRequests.filter((r: any) => r.status === 'rejected');

      return (
        <div className="space-y-3 md:space-y-6">
          {/* 统计卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
            <Card className="mobile-compact-card bg-gradient-to-br from-purple-500 to-indigo-500 text-white">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm opacity-80">总申请数</p>
                    <p className="text-2xl font-bold mt-1">{branchEnergyRequests.length}</p>
                    <p className="text-xs opacity-70 mt-1">次</p>
                  </div>
                  <Zap className="w-10 h-10 opacity-50" />
                </div>
              </CardContent>
            </Card>
            <Card 
              className="bg-gradient-to-br from-yellow-500 to-orange-500 text-white cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => {
                const pendingList = document.getElementById('pending-requests');
                pendingList?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm opacity-80">待审核</p>
                    <p className="text-2xl font-bold mt-1">{pendingRequests.length}</p>
                    <p className="text-xs opacity-70 mt-1">次</p>
                  </div>
                  <Clock className="w-10 h-10 opacity-50" />
                </div>
              </CardContent>
            </Card>
            <Card className="mobile-compact-card bg-gradient-to-br from-green-500 to-emerald-500 text-white">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm opacity-80">已通过</p>
                    <p className="text-2xl font-bold mt-1">
                      {approvedRequests.reduce((sum: number, r: any) => sum + (r.amount || 0), 0).toLocaleString()}
                    </p>
                    <p className="text-xs opacity-70 mt-1">收益</p>
                  </div>
                  <CheckCircle className="w-10 h-10 opacity-50" />
                </div>
              </CardContent>
            </Card>
            <Card className="mobile-compact-card bg-gradient-to-br from-gray-500 to-gray-600 text-white">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm opacity-80">已拒绝</p>
                    <p className="text-2xl font-bold mt-1">{rejectedRequests.length}</p>
                    <p className="text-xs opacity-70 mt-1">次</p>
                  </div>
                  <XCircle className="w-10 h-10 opacity-50" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 待审核申请 */}
          <Card id="pending-requests">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-yellow-600" />
                待审核申请
                {pendingRequests.length > 0 && (
                  <Badge className="ml-2 bg-yellow-500 text-white">{pendingRequests.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pendingRequests.length > 0 ? (
                <div className="space-y-4">
                  {pendingRequests.map((request: any) => (
                    <div key={request.id} className="p-4 border border-yellow-200 rounded-lg hover:bg-yellow-50">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-3">
                            <p className="font-medium text-lg">
                              {request.branchName}
                              <span className="text-sm text-gray-500 ml-2">
                                (手机: {request.branchPhone || '-'})
                              </span>
                            </p>
                            <Badge className="bg-yellow-100 text-yellow-700">
                              待审核
                            </Badge>
                          </div>
                          <p className="text-2xl font-bold text-purple-600 mt-2">
                            申请收益: {request.amount?.toLocaleString()}
                          </p>
                          <p className="text-sm text-gray-500 mt-1">
                            申请时间: {request.createdAt ? new Date(request.createdAt).toLocaleString() : '-'}
                          </p>
                          {request.note && (
                            <p className="text-xs text-gray-400 mt-1">备注: {request.note}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700"
                            onClick={() => handleApproveBranchEnergyRequestInComponent(request.id, 'approve')}
                            disabled={submitting}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            通过
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              const note = prompt('请输入拒绝原因（可选）:');
                              handleApproveBranchEnergyRequestInComponent(request.id, 'reject', note || undefined);
                            }}
                            disabled={submitting}
                          >
                            <XCircle className="w-4 h-4 mr-1" />
                            拒绝
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center">
                  <CheckCircle className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500">暂无待审核的申请</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 已处理申请记录 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-gray-600" />
                已处理记录
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>申请时间</TableHead>
                    <TableHead>服务网点</TableHead>
                    <TableHead>申请金额</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>审核时间</TableHead>
                    <TableHead>审核备注</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branchEnergyRequests
                    .filter((r: any) => r.status !== 'pending')
                    .slice(0, 20)
                    .map((request: any) => (
                      <TableRow key={request.id}>
                        <TableCell className="text-xs">
                          {request.createdAt ? new Date(request.createdAt).toLocaleString() : '-'}
                        </TableCell>
                        <TableCell className="font-medium">{request.branchName}</TableCell>
                        <TableCell className="text-purple-600 font-medium">
                          {request.amount?.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge className={
                            request.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }>
                            {request.status === 'approved' ? '已通过' : '已拒绝'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {request.reviewedAt ? new Date(request.reviewedAt).toLocaleString() : '-'}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">
                          {request.reviewerNote || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  {branchEnergyRequests.filter((r: any) => r.status !== 'pending').length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                        暂无已处理记录
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* 操作说明 */}
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="pt-6">
              <h4 className="font-semibold text-blue-800 mb-2">服务网点收益申请审核说明</h4>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>1. 服务网点向智算总台申请收益，最低申请金额为 50 收益</li>
                <li>2. 智算总台审核通过后，收益会自动从智算总台账户扣除并发放给服务网点</li>
                <li>3. 智算总台审核拒绝后，服务网点申请将被标记为已拒绝</li>
                <li>4. 收益用于服务网点给服务商分配，服务商给会员充值后产生收益</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      );
    };

    // 加载收益总览数据
    const loadEnergyOverview = async () => {
      setEnergyLoading(true);
      try {
        const response = await authFetch('/api/energy?type=all');
        if (!response.ok) {
          setEnergyLoading(false);
          return;
        }
        const data = await response.json();
        if (data.success) {
          setEnergyData(data.data);
        }
      } catch (error) {
        console.error('加载收益总览失败:', error);
      } finally {
        setEnergyLoading(false);
      }
    };

    // 加载收益账户列表
    const loadEnergyAccounts = async () => {
      setEnergyLoading(true);
      try {
        const response = await authFetch('/api/energy-accounts');
        if (!response.ok) {
          setEnergyLoading(false);
          return;
        }
        const data = await response.json();
        if (data.success) {
          setEnergyAccounts(data.data?.accounts || []);
        }
      } catch (error) {
        console.error('加载收益账户失败:', error);
      } finally {
        setEnergyLoading(false);
      }
    };

    // 加载收益流水记录
    const loadEnergyTransactions = async (type?: string) => {
      if (!isMountedRef.current) return;
      setEnergyLoading(true);
      try {
        const url = type && type !== 'all' ? `/api/energy-transactions?type=${type}` : '/api/energy-transactions';
        const response = await authFetch(url);
        if (!isMountedRef.current) return;
        if (!response.ok) {
          setEnergyLoading(false);
          return;
        }
        const data = await response.json();
        if (data.success) {
          setEnergyTransactions(data.data?.transactions || []);
        }
      } catch (error) {
        if (isMountedRef.current) {
          console.error('加载收益流水失败:', error);
        }
      } finally {
        if (isMountedRef.current) {
          setEnergyLoading(false);
        }
      }
    };

    // 加载服务网点列表
    const loadBranchList = async () => {
      if (!isMountedRef.current) return;
      try {
        const response = await authFetch('/api/admin/users?role=branch');
        if (!isMountedRef.current) return;
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        if (data.success) {
          setBranchList(data.data || []);
        }
      } catch (error) {
        if (isMountedRef.current) {
          console.error('加载服务网点列表失败:', error);
        }
      }
    };

    // 加载所有用户列表（用于转账）
    const loadAllUsersList = async () => {
      if (!isMountedRef.current) return;
      try {
        const response = await authFetch('/api/admin/users');
        if (!isMountedRef.current) return;
        if (!response.ok) {
          console.error('加载用户列表失败:', response.status);
          return;
        }
        const data = await response.json();
        if (data.success) {
          // 过滤掉admin用户，只保留服务网点、服务商、会员
          const filteredUsers = (data.data || []).filter((u: any) => u.role !== 'admin');
          setAllUsersList(filteredUsers);
        }
      } catch (error) {
        if (isMountedRef.current) {
          console.error('加载用户列表失败:', error);
        }
      }
    };

    // 加载变现申请列表
    const loadWithdrawRequests = async (status?: string) => {
      setEnergyLoading(true);
      if (status !== undefined) {
        setWithdrawFilter(status);
      }
      try {
        const url = status 
          ? `/api/energy/withdraw-request?status=${status}&isAdmin=true` 
          : '/api/energy/withdraw-request?isAdmin=true';
        const response = await authFetch(url);
        if (!response.ok) {
          setEnergyLoading(false);
          return;
        }
        const data = await response.json();
        if (data.success) {
          setWithdrawRequests(data.data?.requests || []);
          setWithdrawStats(data.data?.stats || null);
        }
      } catch (error) {
        console.error('加载变现申请列表失败:', error);
      } finally {
        setEnergyLoading(false);
      }
    };

    // 审核变现申请
    const handleApproveWithdraw = async (requestId: string, action: 'approve' | 'reject', note?: string) => {
      const adminId = localStorage.getItem('userId');
      if (!adminId) {
        showMessage('error', '请先登录');
        return;
      }

      setSubmitting(true);
      try {
        const response = await authFetch('/api/energy/approve-withdraw', {
          method: 'POST',
          body: JSON.stringify({
            requestId,
            adminId,
            action,
            note,
          }),
        });

        const data = await response.json();
        if (data.success) {
          showMessage('success', data.message || `已${action === 'approve' ? '通过' : '拒绝'}变现申请`);
          loadWithdrawRequests();
          loadEnergyOverview();
          loadEnergyAccounts();
        } else {
          showMessage('error', data.error || '操作失败');
        }
      } catch (error) {
        showMessage('error', '网络错误');
      } finally {
        setSubmitting(false);
      }
    };

    // 释放收益给服务网点
    const handleReleaseEnergy = async () => {
      const adminId = localStorage.getItem('userId');
      if (!adminId || !releaseForm.toUserId || !releaseForm.amount) {
        showMessage('error', '请填写完整信息');
        return;
      }

      setSubmitting(true);
      try {
        const response = await authFetch('/api/energy/manual-release', {
          method: 'POST',
          body: JSON.stringify({
            fromUserId: adminId,
            toUserId: releaseForm.toUserId,
            amount: Number(releaseForm.amount),
            note: releaseForm.note,
          }),
        });

        const data = await response.json();
        if (data.success) {
          showMessage('success', '收益释放成功');
          setShowReleaseDialog(false);
          setReleaseForm({ toUserId: '', amount: '', note: '' });
          loadEnergyOverview();
        } else {
          showMessage('error', data.error || '操作失败');
        }
      } catch (error) {
        showMessage('error', '网络错误');
      } finally {
        setSubmitting(false);
      }
    };

    // 向任意用户转账收益
    const handleTransferEnergy = async () => {
      const adminId = localStorage.getItem('userId');
      if (!adminId || !transferForm.toUserId || !transferForm.amount) {
        showMessage('error', '请填写完整信息');
        return;
      }

      setSubmitting(true);
      try {
        const response = await authFetch('/api/energy/admin-transfer', {
          method: 'POST',
          body: JSON.stringify({
            fromUserId: adminId,
            toUserId: transferForm.toUserId,
            amount: Number(transferForm.amount),
            note: transferForm.note,
          }),
        });

        const data = await response.json();
        if (data.success) {
          showMessage('success', data.message || '转账成功');
          setShowTransferDialog(false);
          setTransferForm({ toUserId: '', amount: '', note: '' });
          loadEnergyOverview();
          loadEnergyAccounts();
        } else {
          showMessage('error', data.error || '操作失败');
        }
      } catch (error) {
        showMessage('error', '网络错误');
      } finally {
        setSubmitting(false);
      }
    };
    
    useEffect(() => {
      if (energyTab === 'overview') {
        loadEnergyOverview();
      } else if (energyTab === 'accounts') {
        loadEnergyAccounts();
      } else if (energyTab === 'transactions') {
        loadEnergyTransactions(energyTransactionType);
      } else if (energyTab === 'request') {
        loadBranchEnergyRequestsInComponent();
      } else if (energyTab === 'withdraw') {
        loadWithdrawRequests(withdrawFilter || undefined);
      }
      // 服务网点列表和用户列表只需要在组件挂载时加载一次
      loadBranchList();
      loadAllUsersList();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [energyTab, energyTransactionType, withdrawFilter]);

    const formatEnergy = (amount: number | string | undefined | null) => {
      const num = Number(amount) || 0;
      if (num >= 10000) {
        return (num / 10000).toFixed(1) + '万';
      }
      return num.toLocaleString();
    };

    const getTypeName = (type: string) => {
      const typeMap: Record<string, string> = {
        quota_match: '算力额度匹配',
        purchase: '收益购买',
        market_transfer: '市场内流转',
        withdraw: '提现沉淀',
        manual: '人工释放',
        burn: '收益销毁',
        create: '收益创建',
        transfer_out: '转出',
        transfer_in: '转入',
      };
      return typeMap[type] || type;
    };

    const getTypeColor = (type: string) => {
      const colorMap: Record<string, string> = {
        quota_match: 'bg-blue-100 text-blue-700',
        purchase: 'bg-green-100 text-green-700',
        market_transfer: 'bg-purple-100 text-purple-700',
        withdraw: 'bg-red-100 text-red-700',
        manual: 'bg-orange-100 text-orange-700',
        burn: 'bg-red-100 text-red-700',
        create: 'bg-amber-100 text-amber-700',
        transfer_out: 'bg-gray-100 text-gray-700',
        transfer_in: 'bg-gray-100 text-gray-700',
      };
      return colorMap[type] || 'bg-gray-100 text-gray-700';
    };

    // 五大板块数据
    const quotaMatchData = energyData?.quotaMatch || { records: [], total: 0 };
    const purchaseData = energyData?.purchase || { records: [], total: 0 };
    const marketDistribution = energyData?.marketDistribution || { accounts: [], total: 0 };
    const marketTransfer = energyData?.marketTransfer || { records: [], total: 0 };
    const withdrawData = energyData?.withdraw || { records: [], total: 0, withdrawApprovedAmount: 0, burnAmount: 0, feeAmount: 0, pendingCount: 0, pendingAmount: 0 };

    // 总览视图
    const renderOverviewTab = () => (
      <div className="space-y-3 md:space-y-6">
        {/* 顶部统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="mobile-compact-card bg-gradient-to-br from-blue-500 to-blue-600 text-white">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">智算总台收益余额</p>
                  <p className="text-2xl font-bold">{formatEnergy(energyData?.adminBalance)}</p>
                  <p className="text-xs opacity-70 mt-1">收益</p>
                </div>
                <Zap className="w-10 h-10 opacity-50" />
              </div>
            </CardContent>
          </Card>

          <Card className="mobile-compact-card bg-gradient-to-br from-purple-500 to-purple-600 text-white">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">算力额度匹配</p>
                  <p className="text-2xl font-bold">{formatEnergy(quotaMatchData.total)}</p>
                  <p className="text-xs opacity-70 mt-1">智算总台→服务网点</p>
                </div>
                <Database className="w-10 h-10 opacity-50" />
              </div>
            </CardContent>
          </Card>

          <Card className="mobile-compact-card bg-gradient-to-br from-green-500 to-green-600 text-white">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">收益购买</p>
                  <p className="text-2xl font-bold">{formatEnergy(purchaseData.total)}</p>
                  <p className="text-xs opacity-70 mt-1">服务网点→智算总台</p>
                </div>
                <ShoppingCart className="w-10 h-10 opacity-50" />
              </div>
            </CardContent>
          </Card>

          <Card className="mobile-compact-card bg-gradient-to-br from-red-500 to-red-600 text-white">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">销毁的收益</p>
                  <p className="text-2xl font-bold">{formatEnergy(withdrawData.burnAmount)}</p>
                  <p className="text-xs opacity-70 mt-1">
                    待审核: {withdrawData.pendingCount}笔 / {formatEnergy(withdrawData.pendingAmount)}
                  </p>
                </div>
                <Wallet className="w-10 h-10 opacity-50" />
              </div>
            </CardContent>
          </Card>

          <Card className="mobile-compact-card bg-gradient-to-br from-orange-500 to-orange-600 text-white">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">提现沉淀</p>
                  <p className="text-2xl font-bold">{formatEnergy(withdrawData.feeAmount)}</p>
                  <p className="text-xs opacity-70 mt-1">手续费(5%)</p>
                </div>
                <TrendingDown className="w-10 h-10 opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 五大板块详情 */}
        <div className="grid grid-cols-2 gap-6">
          {/* 板块1：算力额度匹配 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5 text-blue-600" />
                板块1：算力额度匹配
                <Badge className="bg-blue-100 text-blue-700">智算总台→服务网点</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600 mb-4">
                {formatEnergy(quotaMatchData.total)} 收益
              </div>
              <div className="text-sm text-gray-500 mb-4">
                <p>智算总台分配算力额度给服务网点时，同步分配20%收益</p>
              </div>
              <div className="max-h-40 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>服务网点</TableHead>
                      <TableHead>金额</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quotaMatchData.records.slice(0, 5).map((record: any) => (
                      <TableRow key={record.id}>
                        <TableCell className="text-xs">{new Date(record.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>{record.to_username || '-'}</TableCell>
                        <TableCell className="font-medium">{record.amount?.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* 板块2：收益购买 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-green-600" />
                板块2：收益购买
                <Badge className="bg-green-100 text-green-700">服务网点→智算总台</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600 mb-4">
                {formatEnergy(purchaseData.total)} 收益
              </div>
              <div className="text-sm text-gray-500 mb-4">
                <p>服务网点向智算总台购买收益，用于给服务商充值</p>
                <p className="mt-1">服务商给会员充值收益，会员支付市场费</p>
              </div>
              <div className="max-h-40 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>服务网点</TableHead>
                      <TableHead>金额</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchaseData.records.slice(0, 5).map((record: any) => (
                      <TableRow key={record.id}>
                        <TableCell className="text-xs">{new Date(record.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>{record.from_username || '-'}</TableCell>
                        <TableCell className="font-medium">{record.amount?.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* 板块3：市场收益分布 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PieChartIcon className="w-5 h-5 text-purple-600" />
                板块3：市场收益分布
                <Badge className="bg-purple-100 text-purple-700">服务商+会员</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600 mb-4">
                {formatEnergy(marketDistribution.total)} 收益
              </div>
              <div className="text-sm text-gray-500 mb-4">
                <p>服务商和会员的收益账户余额分布</p>
              </div>
              <div className="max-h-40 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>角色</TableHead>
                      <TableHead>用户名</TableHead>
                      <TableHead>余额</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {marketDistribution.accounts.slice(0, 5).map((account: any) => (
                      <TableRow key={account.id}>
                        <TableCell>
                          <Badge variant="outline" className={
                            account.role === 'admin' ? 'border-amber-500 text-amber-600' :
                            account.role === 'provider' ? 'border-purple-500 text-purple-600' : 
                            'border-blue-500 text-blue-600'
                          }>
                            {account.role === 'admin' ? '智算总台' : account.role === 'provider' ? '服务商' : '会员'}
                          </Badge>
                        </TableCell>
                        <TableCell>{account.username}</TableCell>
                        <TableCell className="font-medium">{formatEnergy(account.balance)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* 板块4：市场内流转 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-cyan-600" />
                板块4：市场内流转
                <Badge className="bg-cyan-100 text-cyan-700">会员↔服务商</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-cyan-600 mb-4">
                {formatEnergy(marketTransfer.total)} 收益
              </div>
              <div className="text-sm text-gray-500 mb-4">
                <p>会员卖出产品时支付市场费，按以下比例分配</p>
              </div>
              <div className="grid grid-cols-5 gap-4 mb-4">
                <div className="text-center p-3 bg-purple-50 rounded-lg">
                  <div className="text-xl font-bold text-purple-600">70%</div>
                  <div className="text-xs text-gray-600 mt-1">服务商收益</div>
                </div>
                <div className="text-center p-3 bg-blue-50 rounded-lg">
                  <div className="text-xl font-bold text-blue-600">5%</div>
                  <div className="text-xs text-gray-600 mt-1">公司运营</div>
                </div>
                <div className="text-center p-3 bg-green-50 rounded-lg">
                  <div className="text-xl font-bold text-green-600">10%</div>
                  <div className="text-xs text-gray-600 mt-1">直推奖励</div>
                </div>
                <div className="text-center p-3 bg-orange-50 rounded-lg">
                  <div className="text-xl font-bold text-orange-600">10%</div>
                  <div className="text-xs text-gray-600 mt-1">上级服务商</div>
                </div>
                <div className="text-center p-3 bg-cyan-50 rounded-lg">
                  <div className="text-xl font-bold text-cyan-600">5%</div>
                  <div className="text-xs text-gray-600 mt-1">服务网点</div>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>转出方</TableHead>
                      <TableHead>转入方</TableHead>
                      <TableHead>金额</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {marketTransfer.records.slice(0, 5).map((record: any) => (
                      <TableRow key={record.id}>
                        <TableCell className="text-xs">{new Date(record.created_at).toLocaleDateString()}</TableCell>
                        <TableCell className="text-xs">{record.from_username || '-'}</TableCell>
                        <TableCell className="text-xs">{record.to_username || '-'}</TableCell>
                        <TableCell className="font-medium">{record.amount?.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* 板块5：提现沉淀 */}
          <Card className="col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-red-600" />
                板块5：提现沉淀
                <Badge className="bg-red-100 text-red-700">服务网点→智算总台</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600 mb-4">
                销毁: {formatEnergy(withdrawData.burnAmount)} 收益 / 手续费: {formatEnergy(withdrawData.feeAmount)} 收益
              </div>
              <div className="text-sm text-gray-500 mb-4">
                <p>服务网点向智算总台提现收益，收益回流到智算总台账户</p>
                <p className="mt-1">提现最低门槛：50收益，手续费率：5%</p>
              </div>
              <div className="max-h-40 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>服务网点</TableHead>
                      <TableHead>金额</TableHead>
                      <TableHead>备注</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {withdrawData.records.slice(0, 5).map((record: any) => (
                      <TableRow key={record.id}>
                        <TableCell className="text-xs">{new Date(record.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>{record.from_username || '-'}</TableCell>
                        <TableCell className="font-medium">{record.amount?.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-gray-500">{record.note || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );

    // 账户列表视图
    const renderAccountsTab = () => (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>收益账户列表</CardTitle>
            <div className="flex gap-2">
              <Button onClick={() => setShowCreateDialog(true)} className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600">
                <Plus className="w-4 h-4 mr-2" />
                创建收益
              </Button>
              <Button onClick={() => setShowTransferDialog(true)} className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600">
                <ArrowRightLeft className="w-4 h-4 mr-2" />
                转账收益
              </Button>
              <Button onClick={() => setShowReleaseDialog(true)} className="bg-purple-600 hover:bg-purple-700">
                <Zap className="w-4 h-4 mr-2" />
                释放收益
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户名</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>手机号</TableHead>
                <TableHead className="text-right">余额</TableHead>
                <TableHead className="text-right">累计收入</TableHead>
                <TableHead className="text-right">累计支出</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {energyAccounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-medium">{account.username}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      account.role === 'admin' ? 'border-amber-500 text-amber-600' :
                      account.role === 'branch' ? 'border-cyan-500 text-cyan-600' :
                      account.role === 'provider' ? 'border-purple-500 text-purple-600' :
                      'border-blue-500 text-blue-600'
                    }>
                      {account.role === 'admin' ? '智算总台' : account.role === 'branch' ? '服务网点' : account.role === 'provider' ? '服务商' : '会员'}
                    </Badge>
                  </TableCell>
                  <TableCell>{account.phone || '-'}</TableCell>
                  <TableCell className="text-right font-medium">{formatEnergy(account.balance)}</TableCell>
                  <TableCell className="text-right text-green-600">{formatEnergy(account.totalIn)}</TableCell>
                  <TableCell className="text-right text-red-600">{formatEnergy(account.totalOut)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );

    // 流水记录视图
    const renderTransactionsTab = () => (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>收益流水记录</CardTitle>
            <div className="flex gap-2">
              <Button
                variant={energyTransactionType === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setEnergyTransactionType('all')}
              >
                全部
              </Button>
              <Button
                variant={energyTransactionType === 'quota_match' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setEnergyTransactionType('quota_match')}
              >
                额度匹配
              </Button>
              <Button
                variant={energyTransactionType === 'purchase' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setEnergyTransactionType('purchase')}
              >
                购买
              </Button>
              <Button
                variant={energyTransactionType === 'market_transfer' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setEnergyTransactionType('market_transfer')}
              >
                市场流转
              </Button>
              <Button
                variant={energyTransactionType === 'withdraw' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setEnergyTransactionType('withdraw')}
              >
                提现
              </Button>
              <Button
                variant={energyTransactionType === 'burn' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setEnergyTransactionType('burn')}
              >
                销毁
              </Button>
              <Button
                variant={energyTransactionType === 'create' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setEnergyTransactionType('create')}
              >
                创建
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>转出方</TableHead>
                <TableHead>转入方</TableHead>
                <TableHead className="text-right">金额</TableHead>
                <TableHead>备注</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {energyTransactions.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="text-xs">{new Date(tx.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge className={getTypeColor(tx.type)}>
                      {getTypeName(tx.type)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{tx.fromUsername || '-'}</div>
                    <div className="text-gray-400">{tx.fromRole || ''}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{tx.toUsername || '-'}</div>
                    <div className="text-gray-400">{tx.toRole || ''}</div>
                  </TableCell>
                  <TableCell className="text-right font-medium">{tx.amount?.toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-gray-500">{tx.note || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );

    // 加载服务网点收益申请记录
    const loadBranchEnergyRequests = async () => {
      setEnergyLoading(true);
      try {
        const response = await authFetch('/api/energy/branch-request');
        const data = await response.json();
        if (data.success && data.data) {
          setBranchEnergyRequests(data.data.records || []);
          setBranchEnergyPendingCount(data.data.stats?.pending?.count || 0);
        }
      } catch (error) {
        console.error('加载服务网点收益申请失败:', error);
      } finally {
        setEnergyLoading(false);
      }
    };

    // 审核服务网点收益申请
    const handleApproveBranchEnergyRequest = async (requestId: string, action: 'approve' | 'reject', note?: string) => {
      const adminId = localStorage.getItem('userId');
      if (!adminId) return;

      setSubmitting(true);
      try {
        const response = await authFetch('/api/energy/approve-branch-request', {
          method: 'POST',
          body: JSON.stringify({
            requestId,
            adminId,
            action,
            note,
          }),
        });

        const data = await response.json();
        if (data.success) {
          showMessage('success', data.message || '操作成功');
          loadBranchEnergyRequests();
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

    // 申请审核视图
    const renderRequestTab = () => {
      const pendingRequests = branchEnergyRequests.filter((r: any) => r.status === 'pending');
      const approvedRequests = branchEnergyRequests.filter((r: any) => r.status === 'approved');
      const rejectedRequests = branchEnergyRequests.filter((r: any) => r.status === 'rejected');

      return (
        <div className="space-y-3 md:space-y-6">
          {/* 统计卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
            <Card className="mobile-compact-card bg-gradient-to-br from-purple-500 to-indigo-500 text-white">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm opacity-80">总申请数</p>
                    <p className="text-2xl font-bold mt-1">{branchEnergyRequests.length}</p>
                    <p className="text-xs opacity-70 mt-1">次</p>
                  </div>
                  <Zap className="w-10 h-10 opacity-50" />
                </div>
              </CardContent>
            </Card>
            <Card 
              className="bg-gradient-to-br from-yellow-500 to-orange-500 text-white cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => {
                const pendingList = document.getElementById('pending-requests');
                pendingList?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm opacity-80">待审核</p>
                    <p className="text-2xl font-bold mt-1">{pendingRequests.length}</p>
                    <p className="text-xs opacity-70 mt-1">次</p>
                  </div>
                  <Clock className="w-10 h-10 opacity-50" />
                </div>
              </CardContent>
            </Card>
            <Card className="mobile-compact-card bg-gradient-to-br from-green-500 to-emerald-500 text-white">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm opacity-80">已通过</p>
                    <p className="text-2xl font-bold mt-1">
                      {approvedRequests.reduce((sum: number, r: any) => sum + (r.amount || 0), 0).toLocaleString()}
                    </p>
                    <p className="text-xs opacity-70 mt-1">收益</p>
                  </div>
                  <CheckCircle className="w-10 h-10 opacity-50" />
                </div>
              </CardContent>
            </Card>
            <Card className="mobile-compact-card bg-gradient-to-br from-gray-500 to-gray-600 text-white">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm opacity-80">已拒绝</p>
                    <p className="text-2xl font-bold mt-1">{rejectedRequests.length}</p>
                    <p className="text-xs opacity-70 mt-1">次</p>
                  </div>
                  <XCircle className="w-10 h-10 opacity-50" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 待审核申请 */}
          <Card id="pending-requests">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-yellow-600" />
                待审核申请
                {pendingRequests.length > 0 && (
                  <Badge className="ml-2 bg-yellow-500 text-white">{pendingRequests.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pendingRequests.length > 0 ? (
                <div className="space-y-4">
                  {pendingRequests.map((request: any) => (
                    <div key={request.id} className="p-4 border border-yellow-200 rounded-lg hover:bg-yellow-50">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-3">
                            <p className="font-medium text-lg">
                              {request.branchName}
                              <span className="text-sm text-gray-500 ml-2">
                                (手机: {request.branchPhone || '-'})
                              </span>
                            </p>
                            <Badge className="bg-yellow-100 text-yellow-700">
                              待审核
                            </Badge>
                          </div>
                          <p className="text-2xl font-bold text-purple-600 mt-2">
                            申请收益: {request.amount?.toLocaleString()}
                          </p>
                          <p className="text-sm text-gray-500 mt-1">
                            申请时间: {request.createdAt ? new Date(request.createdAt).toLocaleString() : '-'}
                          </p>
                          {request.note && (
                            <p className="text-xs text-gray-400 mt-1">备注: {request.note}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700"
                            onClick={() => handleApproveBranchEnergyRequest(request.id, 'approve')}
                            disabled={submitting}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            通过
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              const note = prompt('请输入拒绝原因（可选）:');
                              handleApproveBranchEnergyRequest(request.id, 'reject', note || undefined);
                            }}
                            disabled={submitting}
                          >
                            <XCircle className="w-4 h-4 mr-1" />
                            拒绝
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center">
                  <CheckCircle className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500">暂无待审核的申请</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 已处理申请记录 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-gray-600" />
                已处理记录
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>申请时间</TableHead>
                    <TableHead>服务网点</TableHead>
                    <TableHead>申请金额</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>审核时间</TableHead>
                    <TableHead>审核备注</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branchEnergyRequests
                    .filter((r: any) => r.status !== 'pending')
                    .slice(0, 20)
                    .map((request: any) => (
                      <TableRow key={request.id}>
                        <TableCell className="text-xs">
                          {request.createdAt ? new Date(request.createdAt).toLocaleString() : '-'}
                        </TableCell>
                        <TableCell className="font-medium">{request.branchName}</TableCell>
                        <TableCell className="text-purple-600 font-medium">
                          {request.amount?.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge className={
                            request.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }>
                            {request.status === 'approved' ? '已通过' : '已拒绝'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {request.reviewedAt ? new Date(request.reviewedAt).toLocaleString() : '-'}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">
                          {request.reviewerNote || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  {branchEnergyRequests.filter((r: any) => r.status !== 'pending').length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                        暂无已处理记录
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* 操作说明 */}
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="pt-6">
              <h4 className="font-semibold text-blue-800 mb-2">服务网点收益申请审核说明</h4>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>1. 服务网点向智算总台申请收益，最低申请金额为 50 收益</li>
                <li>2. 智算总台审核通过后，收益会自动从智算总台账户扣除并发放给服务网点</li>
                <li>3. 智算总台审核拒绝后，服务网点申请将被标记为已拒绝</li>
                <li>4. 收益用于服务网点给服务商分配，服务商给会员充值后产生收益</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      );
    };

    // 5%回收统计视图
    const renderFeeTab = () => {
      // 计算5%回收总额
      const totalFee = withdrawData?.totalBurn || 0;
      const totalWithdraw = withdrawData?.approvedAmount || 0;
      const estimatedFee = totalWithdraw * 0.05;

      return (
        <div className="space-y-3 md:space-y-6">
          {/* 统计卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-4">
            <Card className="mobile-compact-card bg-gradient-to-br from-purple-500 to-indigo-500 text-white">
              <CardContent className="pt-4">
                <p className="text-sm opacity-80">累计回收总额</p>
                <p className="text-3xl font-bold mt-2">{totalFee.toLocaleString()}</p>
                <p className="text-xs opacity-70 mt-2">收益</p>
              </CardContent>
            </Card>
            <Card className="mobile-compact-card bg-gradient-to-br from-green-500 to-emerald-500 text-white">
              <CardContent className="pt-4">
                <p className="text-sm opacity-80">累计提现总额</p>
                <p className="text-3xl font-bold mt-2">{totalWithdraw.toLocaleString()}</p>
                <p className="text-xs opacity-70 mt-2">收益</p>
              </CardContent>
            </Card>
            <Card className="mobile-compact-card bg-gradient-to-br from-amber-500 to-orange-500 text-white">
              <CardContent className="pt-4">
                <p className="text-sm opacity-80">回收比例</p>
                <p className="text-3xl font-bold mt-2">5%</p>
                <p className="text-xs opacity-70 mt-2">每次提现</p>
              </CardContent>
            </Card>
          </div>

          {/* 回收说明 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Percent className="w-5 h-5 text-purple-600" />
                5%回收机制说明
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 bg-purple-50 rounded-lg">
                  <h4 className="font-medium text-purple-800 mb-2">回收流程</h4>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                    <li>会员申请提现收益（如：100收益）</li>
                    <li>服务商审核通过，线下给会员转账（如：95元）</li>
                    <li>确认后，会员收益扣除100</li>
                    <li>服务商收益增加95</li>
                    <li>智算总台回收5收益（5%）</li>
                  </ol>
                </div>

                <div className="p-4 bg-green-50 rounded-lg">
                  <h4 className="font-medium text-green-800 mb-2">回收明细</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-green-700">会员申请提现</span>
                      <span className="font-semibold">100 收益</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-green-700">服务商获得</span>
                      <span className="font-semibold text-blue-600">+95 收益</span>
                    </div>
                    <div className="flex justify-between border-t border-green-200 pt-2">
                      <span className="text-green-800 font-medium">智算总台回收（5%）</span>
                      <span className="font-bold text-purple-600">+5 收益</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 回收记录列表 */}
          <Card>
            <CardHeader>
              <CardTitle>回收记录</CardTitle>
            </CardHeader>
            <CardContent>
              {withdrawData?.requests && withdrawData.requests.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>会员</TableHead>
                      <TableHead>服务商</TableHead>
                      <TableHead>申请金额</TableHead>
                      <TableHead>实付金额</TableHead>
                      <TableHead>回收金额（5%）</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {withdrawData.requests
                      .filter((r: any) => r.status === 'completed')
                      .map((request: any) => {
                        const feeAmount = (request.amount || 0) * 0.05;
                        return (
                          <TableRow key={request.id}>
                            <TableCell className="font-medium">
                              {request.member?.username || request.memberName || '-'}
                            </TableCell>
                            <TableCell>{request.provider?.username || request.providerName || '-'}</TableCell>
                            <TableCell>{request.amount?.toLocaleString()}</TableCell>
                            <TableCell className="text-blue-600">{(request.amount * 0.95).toLocaleString()}</TableCell>
                            <TableCell className="text-purple-600 font-semibold">+{feeAmount.toFixed(2)}</TableCell>
                            <TableCell>
                              <Badge className="bg-green-500">{request.status}</Badge>
                            </TableCell>
                            <TableCell className="text-gray-500">
                              {request.updated_at ? new Date(request.updated_at).toLocaleString() : '-'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              ) : (
                <div className="py-8 text-center text-gray-500">
                  <Percent className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>暂无回收记录</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 回收统计图表 */}
          {withdrawData?.requests && withdrawData.requests.filter((r: any) => r.status === 'completed').length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>回收趋势</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={withdrawData.requests
                      .filter((r: any) => r.status === 'completed')
                      .map((r: any) => ({
                        ...r,
                        feeAmount: (r.amount || 0) * 0.05,
                        date: r.updated_at ? new Date(r.updated_at).toLocaleDateString() : 'Unknown'
                      }))
                    }>
                      <XAxis dataKey="date" />
                      <YAxis />
                      <CartesianGrid strokeDasharray="3 3" />
                      <Tooltip />
                      <Area type="monotone" dataKey="feeAmount" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.3} name="回收金额" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      );
    };

    // 变现审核视图
    const renderWithdrawTab = () => (
      <div className="space-y-3 md:space-y-6">
        {/* 统计卡片 - 可点击跳转筛选 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-4">
          <Card 
            className="bg-gradient-to-br from-amber-500 to-orange-500 text-white cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => {
              setEnergyTab('withdraw');
              loadWithdrawRequests('pending');
            }}
          >
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">待审核</p>
                  <p className="text-2xl font-bold">{withdrawStats?.pending?.count || 0} 笔</p>
                  <p className="text-xs opacity-70 mt-1">金额: {formatEnergy(withdrawStats?.pending?.amount || 0)}</p>
                </div>
                <Clock className="w-10 h-10 opacity-50" />
              </div>
            </CardContent>
          </Card>

          <Card 
            className="bg-gradient-to-br from-green-500 to-emerald-500 text-white cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => {
              setEnergyTab('withdraw');
              loadWithdrawRequests('approved');
            }}
          >
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">已通过</p>
                  <p className="text-2xl font-bold">{withdrawStats?.approved?.count || 0} 笔</p>
                  <p className="text-xs opacity-70 mt-1">金额: {formatEnergy(withdrawStats?.approved?.amount || 0)}</p>
                </div>
                <CheckCircle className="w-10 h-10 opacity-50" />
              </div>
            </CardContent>
          </Card>

          <Card 
            className="bg-gradient-to-br from-gray-500 to-gray-600 text-white cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => {
              setEnergyTab('withdraw');
              loadWithdrawRequests('rejected');
            }}
          >
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">已拒绝</p>
                  <p className="text-2xl font-bold">{withdrawStats?.rejected?.count || 0} 笔</p>
                  <p className="text-xs opacity-70 mt-1">金额: {formatEnergy(withdrawStats?.rejected?.amount || 0)}</p>
                </div>
                <XCircle className="w-10 h-10 opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 变现申请列表 */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>变现申请列表</CardTitle>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadWithdrawRequests()}
                >
                  全部
                </Button>
                <Button
                  variant={withdrawFilter === 'pending' ? 'default' : 'outline'}
                  size="sm"
                  className={withdrawFilter === 'pending' ? 'bg-amber-500' : 'border-amber-500 text-amber-600'}
                  onClick={() => loadWithdrawRequests('pending')}
                >
                  待审核
                </Button>
                <Button
                  variant={withdrawFilter === 'approved' ? 'default' : 'outline'}
                  size="sm"
                  className={withdrawFilter === 'approved' ? 'bg-green-500' : 'border-green-500 text-green-600'}
                  onClick={() => loadWithdrawRequests('approved')}
                >
                  已通过
                </Button>
                <Button
                  variant={withdrawFilter === 'rejected' ? 'default' : 'outline'}
                  size="sm"
                  className={withdrawFilter === 'rejected' ? 'bg-gray-500' : 'border-gray-500 text-gray-600'}
                  onClick={() => loadWithdrawRequests('rejected')}
                >
                  已拒绝
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {withdrawRequests.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <DollarSign className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p>暂无变现申请记录</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>申请时间</TableHead>
                    <TableHead>服务网点</TableHead>
                    <TableHead>手机号</TableHead>
                    <TableHead className="text-right">申请金额</TableHead>
                    <TableHead className="text-right">手续费(5%)</TableHead>
                    <TableHead className="text-right">实际到账</TableHead>
                    <TableHead>收款方式</TableHead>
                    <TableHead>收款账号</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {withdrawRequests.map((req: any) => (
                    <TableRow key={req.id}>
                      <TableCell className="text-xs">
                        {new Date(req.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-medium">{req.username}</TableCell>
                      <TableCell className="text-xs">{req.phone || '-'}</TableCell>
                      <TableCell className="text-right font-medium">
                        {Number(req.amount).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-red-500">
                        -{Number(req.fee).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-green-600 font-medium">
                        {Number(req.actual_amount).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {req.payment_method === 'bank' ? '银行卡' : req.payment_method === 'alipay' ? '支付宝' : '其他'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{req.payment_account}</TableCell>
                      <TableCell>
                        <Badge className={
                          req.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                          req.status === 'approved' ? 'bg-green-100 text-green-700' :
                          'bg-gray-100 text-gray-700'
                        }>
                          {req.status === 'pending' ? '待审核' : req.status === 'approved' ? '已通过' : '已拒绝'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {req.status === 'pending' && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-green-500 text-green-600 hover:bg-green-50"
                              onClick={() => handleApproveWithdraw(req.id, 'approve')}
                              disabled={submitting}
                            >
                              <CheckCircle className="w-4 h-4 mr-1" />
                              通过
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-500 text-red-600 hover:bg-red-50"
                              onClick={() => handleApproveWithdraw(req.id, 'reject')}
                              disabled={submitting}
                            >
                              <XCircle className="w-4 h-4 mr-1" />
                              拒绝
                            </Button>
                          </div>
                        )}
                        {req.status === 'approved' && (
                          <span className="text-xs text-green-600">已打款</span>
                        )}
                        {req.status === 'rejected' && (
                          <span className="text-xs text-gray-500">收益已返还</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* 操作说明 */}
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-6">
            <h4 className="font-semibold text-blue-800 mb-2">变现审核说明</h4>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>1. 服务网点申请变现时，收益会被冻结并扣除</li>
              <li>2. 智算总台审核通过后，产生两条流水记录：
                <span className="font-semibold text-red-600"> 收益销毁（实际打款部分）</span> + 
                <span className="font-semibold text-orange-600"> 提现沉淀（手续费5%）</span>
              </li>
              <li>3. 智算总台需要线下打款给服务网点，实际到账金额 = 申请金额 × 95%</li>
              <li>4. 拒绝申请后，收益会返还给服务网点</li>
              <li>5. 最低变现门槛：50 收益</li>
            </ul>
          </CardContent>
        </Card>

        {/* 变现流水记录 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-red-600" />
              变现流水记录
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>服务网点</TableHead>
                  <TableHead className="text-right">销毁金额</TableHead>
                  <TableHead className="text-right">沉淀金额</TableHead>
                  <TableHead>备注</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withdrawRequests
                  .filter((req: any) => req.status === 'approved')
                  .map((req: any) => (
                    <TableRow key={req.id}>
                      <TableCell className="text-xs">
                        {new Date(req.updated_at || req.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge className="bg-red-100 text-red-700 mr-1">
                          销毁: {Number(req.actual_amount).toLocaleString()}
                        </Badge>
                        <Badge className="bg-orange-100 text-orange-700">
                          沉淀: {Number(req.fee).toLocaleString()}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{req.username}</TableCell>
                      <TableCell className="text-right text-red-600 font-medium">
                        {Number(req.actual_amount).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-orange-600 font-medium">
                        {Number(req.fee).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs">
                        {req.payment_method === 'bank' ? '银行卡' : req.payment_method === 'alipay' ? '支付宝' : '其他'}：
                        {req.payment_account}
                      </TableCell>
                    </TableRow>
                  ))}
                {withdrawRequests.filter((req: any) => req.status === 'approved').length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                      暂无已处理的变现记录
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );

    return (
      <div className="space-y-3 md:space-y-6">
        {/* 消息提示 */}
        {message && (
          <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-lg ${
            message.type === 'success' ? 'bg-green-500' : 'bg-red-500'
          } text-white shadow-lg`}>
            {message.text}
          </div>
        )}

        {/* Tab 切换 - 左侧标题 + 右侧Tab样式 - 深紫色主题 */}
        <div className="flex items-stretch bg-gradient-to-r from-violet-900 to-purple-900 rounded-lg overflow-hidden">
          {/* 左侧标题 */}
          <div className="flex items-center gap-3 px-6 py-4 bg-purple-950/50">
            <Zap className="w-5 h-5 text-white" />
            <span className="text-white font-semibold text-lg">市场费分配</span>
          </div>
          {/* 右侧Tab选项 */}
          <div className="flex items-center gap-1 px-4">
            <button
              onClick={() => setEnergyTab('overview')}
              className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
                energyTab === 'overview' ? 'bg-white text-purple-900 font-semibold shadow-md' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'
              }`}
            >
              <span className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                数据总览
              </span>
            </button>
            <button
              onClick={() => setEnergyTab('accounts')}
              className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
                energyTab === 'accounts' ? 'bg-white text-purple-900 font-semibold shadow-md' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'
              }`}
            >
              <span className="flex items-center gap-2">
                <Wallet className="w-4 h-4" />
                账户列表
              </span>
            </button>
            <button
              onClick={() => setEnergyTab('transactions')}
              className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
                energyTab === 'transactions' ? 'bg-white text-purple-900 font-semibold shadow-md' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'
              }`}
            >
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                流水记录
              </span>
            </button>
            <button
              onClick={() => { loadBranchEnergyRequestsInComponent(); setEnergyTab('request'); }}
              className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
                energyTab === 'request' ? 'bg-white text-purple-900 font-semibold shadow-md' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'
              }`}
            >
              <span className="flex items-center gap-2">
                <Zap className="w-4 h-4" />
                申请审核
                {branchEnergyPendingCount > 0 && (
                  <Badge className="ml-1 bg-red-500 text-white text-xs">{branchEnergyPendingCount}</Badge>
                )}
              </span>
            </button>
            <button
              onClick={() => setEnergyTab('withdraw')}
              className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
                energyTab === 'withdraw' ? 'bg-white text-purple-900 font-semibold shadow-md' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'
              }`}
            >
              <span className="flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                变现审核
                {withdrawData?.pendingCount > 0 && (
                  <Badge className="ml-1 bg-red-500 text-white text-xs">{withdrawData.pendingCount}</Badge>
                )}
              </span>
            </button>
            <button
              onClick={() => setEnergyTab('fee')}
              className={`px-4 py-2 rounded-md transition-colors cursor-pointer ${
                energyTab === 'fee' ? 'bg-white text-purple-900 font-semibold shadow-md' : 'bg-purple-800/50 text-white/80 hover:bg-purple-700'
              }`}
            >
              <span className="flex items-center gap-2">
                <Percent className="w-4 h-4" />
                5%回收统计
              </span>
            </button>
          </div>
        </div>

        {/* Tab 内容 */}
        {energyLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
          </div>
        ) : (
          <>
            {energyTab === 'overview' && renderOverviewTab()}
            {energyTab === 'accounts' && renderAccountsTab()}
            {energyTab === 'transactions' && renderTransactionsTab()}
            {energyTab === 'request' && renderRequestTabInComponent()}
            {energyTab === 'withdraw' && renderWithdrawTab()}
            {energyTab === 'fee' && renderFeeTab()}
          </>
        )}

        {/* 创建收益对话框 */}
        {showCreateDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-[500px]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-amber-500" />
                  创建收益
                </CardTitle>
                <p className="text-sm text-gray-500 mt-1">创建收益不能超过分配给服务网点额度的30%</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>创建金额</Label>
                  <Input
                    type="number"
                    placeholder="请输入收益金额"
                    value={createEnergyAmount}
                    onChange={(e) => setCreateEnergyAmount(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>备注说明</Label>
                  <Input
                    placeholder="请输入备注（可选）"
                    value={createEnergyNote}
                    onChange={(e) => setCreateEnergyNote(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                    取消
                  </Button>
                  <Button onClick={handleCreateEnergy} disabled={submitting}>
                    {submitting ? '创建中...' : '确认创建'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 释放收益对话框 */}
        {showReleaseDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-[500px]">
              <CardHeader>
                <CardTitle>释放收益给服务网点</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>选择服务网点</Label>
                  <select
                    className="w-full mt-1 px-3 py-2 border rounded-md"
                    value={releaseForm.toUserId}
                    onChange={(e) => setReleaseForm({ ...releaseForm, toUserId: e.target.value })}
                  >
                    <option value="">请选择服务网点</option>
                    {branchList.map((b: any) => (
                      <option key={b.id} value={b.id}>{b.username}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>释放金额</Label>
                  <Input
                    type="number"
                    placeholder="请输入释放金额"
                    value={releaseForm.amount}
                    onChange={(e) => setReleaseForm({ ...releaseForm, amount: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>备注</Label>
                  <Input
                    placeholder="请输入备注（可选）"
                    value={releaseForm.note}
                    onChange={(e) => setReleaseForm({ ...releaseForm, note: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => setShowReleaseDialog(false)}>
                    取消
                  </Button>
                  <Button onClick={handleReleaseEnergy} disabled={submitting}>
                    {submitting ? '处理中...' : '确认释放'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 转账收益对话框 */}
        {showTransferDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-[520px]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ArrowRightLeft className="w-5 h-5 text-blue-600" />
                  向任意用户转账收益
                </CardTitle>
                <p className="text-sm text-gray-500 mt-1">智算总台可向任何服务网点、服务商或会员转账收益</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 搜索用户 */}
                <div className="relative" ref={searchContainerRef}>
                  <Label>搜索转入用户</Label>
                  <Input
                    placeholder="输入名称、ID或手机号搜索..."
                    value={userSearchQuery}
                    onChange={(e) => {
                      setUserSearchQuery(e.target.value);
                      setShowUserDropdown(true);
                    }}
                    onFocus={() => setShowUserDropdown(true)}
                    className="mt-1"
                  />
                  {/* 搜索结果下拉 */}
                  {showUserDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-y-auto">
                      {allUsersList.length === 0 ? (
                        <div className="px-3 py-2 text-gray-500 text-sm">暂无数据</div>
                      ) : (
                        allUsersList
                          .filter((u: any) => {
                            const query = userSearchQuery.toLowerCase();
                            if (!query) return true;
                            return (
                              u.username?.toLowerCase().includes(query) ||
                              u.id?.toLowerCase().includes(query) ||
                              u.phone?.toLowerCase().includes(query)
                            );
                          })
                          .slice(0, 10)
                          .map((u: any) => {
                            const energyAccount = energyAccounts.find((ea: any) => ea.userId === u.id);
                            const correctBalance = energyAccount ? Number(energyAccount.balance || 0) : 0;
                            const roleLabel = u.role === 'branch' ? '服务网点' : u.role === 'provider' ? '服务商' : '会员';
                            return (
                              <div
                                key={u.id}
                                className={`px-3 py-2 cursor-pointer hover:bg-blue-50 border-b last:border-b-0 ${
                                  transferForm.toUserId === u.id ? 'bg-blue-100' : ''
                                }`}
                                onClick={() => {
                                  setTransferForm({ ...transferForm, toUserId: u.id });
                                  setUserSearchQuery(u.username + ' [' + roleLabel + ']');
                                  setShowUserDropdown(false);
                                }}
                              >
                                <div className="flex justify-between items-center">
                                  <div>
                                    <span className="font-medium">{u.username}</span>
                                    <span className="ml-2 text-xs text-gray-500">[{roleLabel}]</span>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-xs text-gray-500">ID: {u.id.slice(0, 8)}...</div>
                                    {u.phone && <div className="text-xs text-gray-400">{u.phone}</div>}
                                  </div>
                                </div>
                                <div className="text-xs text-green-600 mt-1">余额: {formatEnergy(correctBalance)}</div>
                              </div>
                            );
                          })
                      )}
                      {userSearchQuery && allUsersList.filter((u: any) => {
                        const query = userSearchQuery.toLowerCase();
                        return (
                          u.username?.toLowerCase().includes(query) ||
                          u.id?.toLowerCase().includes(query) ||
                          u.phone?.toLowerCase().includes(query)
                        );
                      }).length === 0 && (
                        <div className="px-3 py-2 text-gray-500 text-sm">未找到匹配的用户</div>
                      )}
                    </div>
                  )}
                </div>
                {/* 已选择用户显示 */}
                {transferForm.toUserId && (
                  <div className="p-3 bg-green-50 rounded-md border border-green-200">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white text-sm">
                        {allUsersList.find((u: any) => u.id === transferForm.toUserId)?.username?.charAt(0) || '?'}
                      </div>
                      <div>
                        <div className="font-medium">
                          {allUsersList.find((u: any) => u.id === transferForm.toUserId)?.username}
                        </div>
                        <div className="text-xs text-gray-500">
                          {allUsersList.find((u: any) => u.id === transferForm.toUserId)?.role === 'branch' ? '服务网点' : 
                           allUsersList.find((u: any) => u.id === transferForm.toUserId)?.role === 'provider' ? '服务商' : '会员'}
                        </div>
                      </div>
                      <button
                        className="ml-auto text-gray-400 hover:text-red-500"
                        onClick={() => {
                          setTransferForm({ ...transferForm, toUserId: '' });
                          setUserSearchQuery('');
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
                <div>
                  <Label>转账金额</Label>
                  <Input
                    type="number"
                    placeholder="请输入转账金额"
                    value={transferForm.amount}
                    onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
                    className="mt-1"
                  />
                  <p className="text-xs text-gray-500 mt-1">当前智算总台余额：{formatEnergy(energyData?.adminBalance)} 收益</p>
                </div>
                <div>
                  <Label>备注</Label>
                  <Input
                    placeholder="请输入备注（可选）"
                    value={transferForm.note}
                    onChange={(e) => setTransferForm({ ...transferForm, note: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => {
                    setShowTransferDialog(false);
                    setTransferForm({ toUserId: '', amount: '', note: '' });
                    setUserSearchQuery('');
                  }}>
                    取消
                  </Button>
                  <Button onClick={handleTransferEnergy} disabled={submitting} className="bg-blue-600 hover:bg-blue-700">
                    {submitting ? '处理中...' : '确认转账'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    );
  };

  // 根据当前菜单渲染内容
  const renderContent = () => {
    switch (activeMenu) {
      case 'my-profile':
        return <MyProfile />;
      case 'release':
        return renderReleaseRecords();
      case 'quota':
        return renderQuotaManagement();
      case 'withdraw':
        return renderWithdrawAudit();
      case 'accounts':
        return renderAccountsManagement();
      default:
        return (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              <Settings className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p>该功能模块正在开发中...</p>
            </CardContent>
          </Card>
        );
    }
  };

  return (
    <div className="flex min-h-screen bg-gray-100">
      {/* 消息提示 */}
      {message && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-lg ${
          message.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        } text-white shadow-lg`}>
          {message.text}
        </div>
      )}

      {/* 创建模板对话框 */}
      {showTemplateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-[500px]">
            <CardHeader>
              <CardTitle>创建算力模板</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>模板名称</Label>
                  <Input 
                    value={templateForm.name}
                    onChange={(e) => setTemplateForm({...templateForm, name: e.target.value})}
                    placeholder="如: Token存储包"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>模板代码</Label>
                  <Input 
                    value={templateForm.code}
                    onChange={(e) => setTemplateForm({...templateForm, code: e.target.value})}
                    placeholder="如: GPU-7D"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>周期(天)</Label>
                  <Input 
                    type="number"
                    value={templateForm.period}
                    onChange={(e) => setTemplateForm({...templateForm, period: e.target.value})}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>总收益率(%)</Label>
                  <Input 
                    type="number"
                    value={templateForm.total_rate}
                    onChange={(e) => setTemplateForm({...templateForm, total_rate: e.target.value})}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>市场费率(%)</Label>
                  <Input 
                    type="number"
                    value={templateForm.market_rate}
                    onChange={(e) => setTemplateForm({...templateForm, market_rate: e.target.value})}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>会员收益(%)</Label>
                  <Input 
                    type="number"
                    value={templateForm.profit_rate}
                    onChange={(e) => setTemplateForm({...templateForm, profit_rate: e.target.value})}
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setShowTemplateDialog(false)}>取消</Button>
                <Button 
                  className="bg-purple-600" 
                  onClick={handleCreateTemplate}
                  disabled={submitting}
                >
                  {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  创建
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 收益调整弹窗 */}
      {showEnergyAdjustDialog && energyAdjustTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-bold mb-4">调整收益 - {energyAdjustTarget.username}</h3>
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-sm text-gray-500">当前收益</p>
                <p className="text-xl font-bold text-orange-600">{energyAdjustTarget.energy_value?.toLocaleString() || 0}</p>
              </div>
              <div>
                <label className="text-sm text-gray-600">调整类型</label>
                <select 
                  value={energyAdjustType} 
                  onChange={e => setEnergyAdjustType(e.target.value as 'add' | 'deduct')}
                  className="w-full mt-1 p-2 border rounded-lg"
                >
                  <option value="add">增加收益</option>
                  <option value="deduct">扣除收益</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600">调整数量</label>
                <input
                  type="number"
                  value={energyAdjustAmount}
                  onChange={e => setEnergyAdjustAmount(e.target.value)}
                  className="w-full mt-1 p-2 border rounded-lg"
                  placeholder="输入调整数量"
                  min="1"
                />
              </div>
              <div>
                <label className="text-sm text-gray-600">备注</label>
                <input
                  type="text"
                  value={energyAdjustNote}
                  onChange={e => setEnergyAdjustNote(e.target.value)}
                  className="w-full mt-1 p-2 border rounded-lg"
                  placeholder="输入调整原因"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <Button variant="outline" className="flex-1" onClick={() => setShowEnergyAdjustDialog(false)}>取消</Button>
              <Button 
                className="flex-1 bg-orange-600 hover:bg-orange-700" 
                onClick={async () => {
                  if (!energyAdjustTarget || !energyAdjustAmount) return alert('请填写调整金额');
                  const amount = parseFloat(energyAdjustAmount);
                  if (isNaN(amount) || amount <= 0) return alert('请输入有效金额');
                  try {
                    const res = await authFetch('/api/admin/energy-adjust', {
                      method: 'POST',
                      body: JSON.stringify({
                        userId: energyAdjustTarget.id,
                        type: energyAdjustType,
                        amount,
                        note: energyAdjustNote || (energyAdjustType === 'add' ? '管理员调整增加' : '管理员调整扣除'),
                      }),
                    });
                    const data = await res.json();
                    if (data.success) {
                      alert('收益调整成功');
                      setShowEnergyAdjustDialog(false);
                      setEnergyAdjustAmount('');
                      setEnergyAdjustNote('');
                      try { const r = await authFetch('/api/admin/members-energy'); const d = await r.json(); if(d.success) setAllUsers(prev => { const m = new Map((d.data||[]).map((u:any)=>[u.id,u])); return prev.map(u => { const e = m.get(u.id); return e ? {...u,...e} : u; }); }); } catch {}
                    } else {
                      alert(data.error || '调整失败');
                    }
                  } catch (e) {
                    alert('调整失败');
                  }
                }}
                disabled={submitting || !energyAdjustAmount || parseFloat(energyAdjustAmount) <= 0}
              >
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                确认调整
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 收益记录弹窗 */}
      {showEnergyRecordDialog && energyAdjustTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">收益记录 - {energyAdjustTarget.username}</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowEnergyRecordDialog(false)}>✕</Button>
            </div>
            {energyRecordList.length > 0 ? (
              <div className="space-y-2">
                {energyRecordList.map((record: { id: string; type: string; amount: number; from_user_id: string | null; to_user_id: string | null; created_at: string; note?: string }) => (
                  <div key={record.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        ['create', 'purchase', 'quota_match', 'transfer_in'].includes(record.type) 
                          ? 'bg-green-100 text-green-700' 
                          : record.type === 'withdraw' 
                            ? 'bg-red-100 text-red-700' 
                            : 'bg-gray-100 text-gray-700'
                      }`}>
                        {record.type === 'create' ? '创建' 
                          : record.type === 'purchase' ? '购买' 
                          : record.type === 'quota_match' ? '额度匹配' 
                          : record.type === 'transfer_in' ? '转入' 
                          : record.type === 'transfer_out' ? '转出' 
                          : record.type === 'withdraw' ? '变现' 
                          : record.type === 'withdraw_freeze' ? '变现冻结' 
                          : record.type === 'burn' ? '销毁' 
                          : record.type}
                      </span>
                      <span className={`font-medium ${record.amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {record.amount > 0 ? '+' : ''}{record.amount}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">{new Date(record.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">暂无收益记录</div>
            )}
            <div className="mt-4 flex justify-end">
              <Button variant="outline" onClick={() => setShowEnergyRecordDialog(false)}>关闭</Button>
            </div>
          </div>
        </div>
      )}

      {/* 左侧导航 */}
      {renderSidebar()}

      {/* 右侧内容 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 移动端顶部栏 */}
        <div className="lg:hidden flex items-center gap-3 p-4 bg-purple-900 text-white sticky top-0 z-30">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 hover:bg-purple-800 rounded-lg">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            <span className="font-bold">算力中心</span>
          </div>
          <div className="ml-auto text-sm text-purple-200">
            {menuItems.find(m => m.id === activeMenu)?.name || '功能模块'}
          </div>
        </div>

        <main className="flex-1 p-3 md:p-6 overflow-auto">
          {/* 面包屑 - 手机端隐藏 */}
          <div className="mb-4 text-sm text-gray-500 hidden lg:block">
          <span className="text-purple-600 cursor-pointer hover:underline" onClick={() => selectMenu('home')}>智算总台</span> / 
          <span className="ml-1">{menuItems.find(m => m.id === activeMenu)?.name || 
            menuItems.find(m => m.children?.some(c => c.id === activeMenu))?.children?.find(c => c.id === activeMenu)?.name || '功能模块'}</span>
        </div>

        {/* 页面内容 */}
        {renderContent()}
      </main>
      </div>
    </div>
  );
}
