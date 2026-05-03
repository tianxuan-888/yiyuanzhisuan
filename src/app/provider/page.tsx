"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";

import {
    Users,
    Zap,
    Package,
    Loader2,
    RefreshCw,
    Plus,
    Send,
    ShoppingCart,
    ShoppingBag,
    TrendingUp,
    TrendingDown,
    CheckCircle,
    XCircle,
    Eye,
    EyeOff,
    DollarSign,
    Clock,
    AlertCircle,
    ClipboardList,
    Database,
    ArrowLeftRight,
    User,
    Star,
    LogOut,
    Network,
    ArrowRight,
    Server,
    Award,
    Lock,
    Key,
    Info,
    Gift,
    History,
    Wallet,
    ArrowUpDown,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";

interface QuotaAllocation {
    id: string;
    template_id: string;
    quota_amount: number;
    used_amount: number;
    status: string;
    created_at: string;
    product_templates?: {
        id: string;
        name: string;
        code: string;
        period: number;
        total_rate: number;
        market_rate: number;
        profit_rate: number;
    };
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
    is_listed: boolean;
    created_at: string;
}

interface Stats {
    pending_count: number;
    available_count: number;
    sold_count: number;
    total_value: number;
    pending_quota: number;
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
    note?: string;
}

interface ProviderApplication {
    id: string;
    user_id: string;
    applicant_name: string;
    phone: string;
    alipay_account: string;
    apply_type: string;
    quota_request: number;
    status: string;
    created_at: string;
    users?: {
        id: string;
        username: string;
        real_name: string;
    };
}

// 服务商提现记录子组件
function ProviderWithdrawRecords({ userId, authFetch }: { userId: string; authFetch: (url: string, options?: RequestInit) => Promise<Response> }) {
    const [records, setRecords] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!userId) return;
        const fetchRecords = async () => {
            try {
                const res = await authFetch(`/api/provider/withdraw?userId=${userId}`);
                const data = await res.json();
                if (data.success) {
                    setRecords(data.data || []);
                }
            } catch (err) {
                console.error("加载提现记录失败", err);
            } finally {
                setLoading(false);
            }
        };
        fetchRecords();
    }, [userId, authFetch]);

    const handleConfirmReceipt = async (withdrawalId: string) => {
        try {
            const res = await authFetch("/api/provider/withdraw", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ withdrawalId, action: "confirm_receipt" }),
            });
            const data = await res.json();
            if (data.success) {
                setRecords(prev => prev.map(r => r.id === withdrawalId ? { ...r, status: 'completed' } : r));
            }
        } catch (err) {
            console.error("确认收款失败", err);
        }
    };

    const statusMap: Record<string, { label: string; color: string }> = {
        pending: { label: '待审核', color: 'bg-yellow-100 text-yellow-700' },
        approved: { label: '审核通过', color: 'bg-blue-100 text-blue-700' },
        transferred: { label: '已打款', color: 'bg-green-100 text-green-700' },
        completed: { label: '已完成', color: 'bg-gray-100 text-gray-700' },
        rejected: { label: '已拒绝', color: 'bg-red-100 text-red-700' },
    };

    if (loading) return <p className="text-gray-500 text-center py-4">加载中...</p>;

    if (records.length === 0) return <p className="text-gray-500 text-center py-4">暂无提现记录</p>;

    return (
        <div className="space-y-2">
            {records.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between border rounded-lg p-3 hover:bg-gray-50">
                    <div>
                        <p className="font-medium">¥{Number(r.amount).toLocaleString()}</p>
                        <p className="text-xs text-gray-500">{new Date(r.created_at).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded-full ${statusMap[r.status]?.color || 'bg-gray-100 text-gray-700'}`}>
                            {statusMap[r.status]?.label || r.status}
                        </span>
                        {r.status === 'transferred' && (
                            <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleConfirmReceipt(r.id)}>
                                确认收款
                            </Button>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function ProviderPage() {
    const {
        user,
        loading: authLoading,
        logout
    } = useAuth("provider");

    const [allocations, setAllocations] = useState<QuotaAllocation[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [applications, setApplications] = useState<ProviderApplication[]>([]);
    const [quotaRequests, setQuotaRequests] = useState<QuotaRequest[]>([]);
    const [showQuotaApplyDialog, setShowQuotaApplyDialog] = useState(false);
    const [applyQuotaAmount, setApplyQuotaAmount] = useState("");

    const [stats, setStats] = useState<Stats>({
        pending_count: 0,
        available_count: 0,
        sold_count: 0,
        total_value: 0,
        pending_quota: 0
    });

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    // 修改密码状态
    const [oldPassword, setOldPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showOldPassword, setShowOldPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [changingPassword, setChangingPassword] = useState(false);

    const [message, setMessage] = useState<{
        type: "success" | "error";
        text: string;
    } | null>(null);

    const [activeTab, setActiveTab] = useState("overview");
    const [salesRecords, setSalesRecords] = useState<any[]>([]);
    const [salesStats, setSalesStats] = useState<any>({ total: 0, available: 0, sold: 0, totalAmount: 0 });
    const [salesFilter, setSalesFilter] = useState<string>("all");
    const [selectedAllocation, setSelectedAllocation] = useState<string>("");

    // 用户名编辑状态
    const [editingUsername, setEditingUsername] = useState(false);
    const [newUsername, setNewUsername] = useState("");
    const [savingUsername, setSavingUsername] = useState(false);

    // 能量充值相关状态
    const [energyMembers, setEnergyMembers] = useState<any[]>([]);
    const [showRechargeDialog, setShowRechargeDialog] = useState(false);
    const [rechargeMemberId, setRechargeMemberId] = useState("");
    const [rechargeAmount, setRechargeAmount] = useState("");

    // 关系链状态
    const [chainData, setChainData] = useState<any>(null);
    const [chainLoading, setChainLoading] = useState(false);
    const [rechargeNote, setRechargeNote] = useState("");

    // 能量值互转相关状态
    const [showTransferDialog, setShowTransferDialog] = useState(false);
    const [transferTargets, setTransferTargets] = useState<any>({ branch: null, providers: [], members: [] });
    const [transferUserId, setTransferUserId] = useState("");
    const [transferUserType, setTransferUserType] = useState<"branch" | "provider" | "member">("provider");
    const [transferAmount, setTransferAmount] = useState("");
    const [transferNote, setTransferNote] = useState("");

    // 积分相关状态
    const [pointsRecords, setPointsRecords] = useState<any[]>([]);
    const [pointsStats, setPointsStats] = useState({ total_convert: 0, total_exchange: 0, available_points: 0 });
    const [showPointsToEnergyDialog, setShowPointsToEnergyDialog] = useState(false);
    const [pointsConvertAmount, setPointsConvertAmount] = useState("");

    // 收益记录相关状态
    const [revenueRecords, setRevenueRecords] = useState<any[]>([]);
    const [revenueStats, setRevenueStats] = useState<any>({
        totalRevenue: 0,
        energyRevenue: 0,
        withdrawRevenue: 0,
        rechargeRevenue: 0,
        subordinateRevenue: 0,
        balance: 0,
        energyValue: 0,
        orderCount: 0,
    });
    const [revenueFilter, setRevenueFilter] = useState<string>("all");

    // 额度申请相关状态
    const [showQuotaRequestDialog, setShowQuotaRequestDialog] = useState(false);
    const [quotaRequestAmount, setQuotaRequestAmount] = useState("");
    const [quotaRequestNote, setQuotaRequestNote] = useState("");

    // 额度生成相关状态
    const [showQuotaGenerateDialog, setShowQuotaGenerateDialog] = useState(false);
    const [generateQuotaAmount, setGenerateQuotaAmount] = useState("");
    const [generatePreview, setGeneratePreview] = useState<any>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);

    // 购买审核相关状态
    const [pendingBuyOrders, setPendingBuyOrders] = useState<any[]>([]);
    const [completedBuyOrders, setCompletedBuyOrders] = useState<any[]>([]);
    const [showBuyOrderDialog, setShowBuyOrderDialog] = useState(false);
    const [selectedBuyOrder, setSelectedBuyOrder] = useState<any>(null);
    const [buyOrderAction, setBuyOrderAction] = useState<"confirm" | "reject">("confirm");
    const [rejectReason, setRejectReason] = useState("");

    // 流转审核相关状态
    const [pendingTransfers, setPendingTransfers] = useState<any[]>([]);
    const [pendingRepurchases, setPendingRepurchases] = useState<any[]>([]);

    // 能量值申请相关状态
    const [showEnergyRequestDialog, setShowEnergyRequestDialog] = useState(false);
    const [energyRequestAmount, setEnergyRequestAmount] = useState("");
    const [energyRequestNote, setEnergyRequestNote] = useState("");
    const [energyRequests, setEnergyRequests] = useState<any[]>([]);
    const [showEnergyRequestListDialog, setShowEnergyRequestListDialog] = useState(false);

    // 会员充值申请相关状态
    const [memberRechargeRequests, setMemberRechargeRequests] = useState<any[]>([]);
    const [showMemberRechargeDialog, setShowMemberRechargeDialog] = useState(false);
    const [selectedRechargeRequest, setSelectedRechargeRequest] = useState<any>(null);

    // 提现管理相关状态
    const [pendingWithdrawals, setPendingWithdrawals] = useState<any[]>([]);

    // 提现相关状态
    const [showWithdrawDialog, setShowWithdrawDialog] = useState(false);
    const [showConvertDialog, setShowConvertDialog] = useState(false);
    const [withdrawAmount, setWithdrawAmount] = useState("");
    const [withdrawAlipay, setWithdrawAlipay] = useState("");
    const [withdrawAlipayName, setWithdrawAlipayName] = useState("");
    const [withdrawRecords, setWithdrawRecords] = useState<any[]>([]);

    // 转账记录相关状态
    const [transferRecords, setTransferRecords] = useState<any[]>([]);
    const [transferStats, setTransferStats] = useState<any>({});
    const [transferFilter, setTransferFilter] = useState<string>("all");

    // 加载服务商收益记录
    const loadRevenueRecords = async () => {
        try {
            const response = await authFetch(`/api/provider/revenue?type=${revenueFilter}`);
            const data = await response.json();
            if (data.success) {
                setRevenueRecords(data.data?.records || []);
                setRevenueStats(data.data?.stats || {
                    totalRevenue: 0,
                    energyRevenue: 0,
                    withdrawRevenue: 0,
                    rechargeRevenue: 0,
                    subordinateRevenue: 0,
                    balance: 0,
                    energyValue: 0,
                    orderCount: 0,
                });
            }
        } catch (error) {
            console.error('加载收益记录失败:', error);
        }
    };

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
        return fetch(url, { ...options, headers });
    };

    // 加载会员充值申请列表
    const loadMemberRechargeRequests = async () => {
        const providerId = localStorage.getItem("userId");
        if (!providerId) return;

        try {
            const response = await authFetch(`/api/provider/recharge-request?providerId=${providerId}&status=pending`);
            const data = await response.json();
            if (data.success) {
                setMemberRechargeRequests(data.data || []);
            }
        } catch (error) {
            console.error('加载会员充值申请失败:', error);
        }
    };

    // 加载待审核购买订单
    const loadPendingBuyOrders = async () => {
        const providerId = localStorage.getItem("userId");
        if (!providerId) return;
        
        try {
            // 获取待审核订单
            const pendingRes = await authFetch(`/api/provider/pending-orders?providerId=${providerId}&status=pending`);
            const pendingData = await pendingRes.json();
            if (pendingData.success) {
                setPendingBuyOrders(pendingData.data?.orders || []);
            }

            // 获取已完成订单
            const completedRes = await authFetch(`/api/provider/pending-orders?providerId=${providerId}&status=completed`);
            const completedData = await completedRes.json();
            if (completedData.success) {
                setCompletedBuyOrders(completedData.data?.orders || []);
            }
        } catch (error) {
            console.error('加载待审核订单失败:', error);
        }
    };

    // 加载产品销售记录（包含持有人信息）
    const loadSalesRecords = async () => {
        try {
            const response = await authFetch(`/api/provider/products/sales-records?status=${salesFilter}`);
            const data = await response.json();
            if (data.success) {
                setSalesRecords(data.data?.records || []);
                setSalesStats(data.data?.stats || { total: 0, available: 0, sold: 0, totalAmount: 0 });
            }
        } catch (error) {
            console.error('加载销售记录失败:', error);
        }
    };

    // 处理购买订单（确认/拒绝）
    const handleBuyOrderAction = async () => {
        if (!selectedBuyOrder) return;

        setSubmitting(true);
        try {
            if (buyOrderAction === 'confirm') {
                const response = await authFetch('/api/provider/confirm-payment', {
                    method: 'POST',
                    body: JSON.stringify({ orderId: selectedBuyOrder.order_id || selectedBuyOrder.id })
                });
                const data = await response.json();
                if (data.success) {
                    showMessage("success", "已确认收款，产品分配成功");
                    await loadPendingBuyOrders();
                    loadData();
                    // 跳转到收益记录Tab并刷新数据
                    setActiveTab('revenue');
                    loadRevenueRecords();
                } else {
                    showMessage("error", data.error || "操作失败");
                }
            } else {
                const response = await authFetch('/api/provider/reject-order', {
                    method: 'POST',
                    body: JSON.stringify({ orderId: selectedBuyOrder.order_id || selectedBuyOrder.id, reason: rejectReason })
                });
                const data = await response.json();
                if (data.success) {
                    showMessage("success", "已拒绝订单");
                    await loadPendingBuyOrders();
                } else {
                    showMessage("error", data.error || "操作失败");
                }
            }
        } catch {
            showMessage("error", "操作失败，请稍后重试");
        } finally {
            setSubmitting(false);
            setShowBuyOrderDialog(false);
            setSelectedBuyOrder(null);
            setRejectReason("");
        }
    };

    // 打开购买订单确认对话框
    const openBuyOrderConfirmDialog = (order: any) => {
        setSelectedBuyOrder(order);
        setBuyOrderAction("confirm");
        setShowBuyOrderDialog(true);
    };

    // 打开购买订单拒绝对话框
    const openBuyOrderRejectDialog = (order: any) => {
        setSelectedBuyOrder(order);
        setBuyOrderAction("reject");
        setRejectReason("");
        setShowBuyOrderDialog(true);
    };

    // 处理会员充值申请
    const handleMemberRechargeAction = async (requestId: string, action: 'approve' | 'reject', note?: string) => {
        const providerId = localStorage.getItem("userId");
        if (!providerId) return;

        setSubmitting(true);
        try {
            const response = await authFetch('/api/provider/recharge-request', {
                method: 'POST',
                body: JSON.stringify({ requestId, providerId, action, note })
            });
            const data = await response.json();
            if (data.success) {
                showMessage("success", action === 'approve' ? "已批准充值申请" : "已拒绝充值申请");
                await loadMemberRechargeRequests();
                loadData();
            } else {
                showMessage("error", data.error || "操作失败");
            }
        } catch {
            showMessage("error", "操作失败，请稍后重试");
        } finally {
            setSubmitting(false);
            setShowMemberRechargeDialog(false);
            setSelectedRechargeRequest(null);
        }
    };

    const loadData = useCallback(async () => {
        const providerId = localStorage.getItem("userId");

        if (!providerId)
            return;

        try {
            // 使用 Promise.allSettled 避免单个失败导致全部失败
            const results = await Promise.allSettled([
                authFetch(`/api/quota-allocations?providerId=${providerId}`),
                authFetch(`/api/provider/products?providerId=${providerId}&status=all`),
                authFetch(`/api/provider-applications?providerId=${providerId}&status=pending`),
                authFetch(`/api/quota?userId=${providerId}`),
                authFetch(`/api/provider/pending-orders?status=pending`),
                authFetch(`/api/provider/pending-orders?status=completed`)
            ]);

            // 安全解析 JSON
            const safeJson = async (result: PromiseSettledResult<Response>): Promise<any> => {
                if (result.status === 'rejected') {
                    return { success: false, data: null };
                }
                try {
                    const data = await result.value.json();
                    return data;
                } catch {
                    return { success: false, data: null };
                }
            };

            const [allocationsData, productsData, applicationsData, quotaData, pendingOrdersData, completedOrdersData] = await Promise.all(
                results.map(safeJson)
            );

            if (allocationsData.success) {
                setAllocations(allocationsData.data || []);

                const pendingQuota = (allocationsData.data || []).filter((a: QuotaAllocation) => a.status === "active").reduce(
                    (sum: number, a: QuotaAllocation) => sum + (a.quota_amount - a.used_amount),
                    0
                );

                setStats(prev => ({
                    ...prev,
                    pending_quota: pendingQuota
                }));
            }

            if (productsData.success) {
                setProducts(productsData.data?.products || []);
                const productStats = productsData.data?.stats || {};

                setStats(prev => ({
                    ...prev,
                    pending_count: productStats.pending || 0,
                    available_count: productStats.available || 0,
                    sold_count: productStats.sold || 0,
                    total_value: productStats.total_value || 0
                }));
            }

            if (applicationsData.success) {
                setApplications(applicationsData.data || []);
            }

            if (quotaData.success) {
                setStats(prev => ({
                    ...prev,
                    total_quota: quotaData.data?.quota?.total || 0,
                    available_quota: quotaData.data?.quota?.available || 0,
                    used_quota: quotaData.data?.quota?.used || 0
                }));

                setQuotaRequests(quotaData.data?.requests || []);
            }

            // 处理待审核购买订单
            if (pendingOrdersData.success) {
                setPendingBuyOrders(pendingOrdersData.data?.orders || []);
            }

            // 处理已完成购买订单
            if (completedOrdersData.success) {
                setCompletedBuyOrders(completedOrdersData.data?.orders || []);
            }

            // 加载会员充值申请
            await loadMemberRechargeRequests();
        } catch (error) {
            console.error("加载数据失败:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    // 获取关系链数据
    const loadChainData = useCallback(async () => {
        if (!user?.id) return;

        setChainLoading(true);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`/api/user/chain?userId=${user.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (data.success) {
                setChainData(data.data);
            }
        } catch (error) {
            console.error('获取关系链失败:', error);
        } finally {
            setChainLoading(false);
        }
    }, [user?.id]);

    useEffect(() => {
        if (!authLoading && user) {
            loadData();
            setNewUsername(user.username || '');
        }
    }, [authLoading, user, loadData]);

    // 保存用户名
    const handleSaveUsername = async () => {
        if (!newUsername.trim() || newUsername.trim().length < 2) {
            showMessage("error", "用户名长度需在2-20个字符之间");
            return;
        }

        if (newUsername.trim() === user?.username) {
            setEditingUsername(false);
            return;
        }

        setSavingUsername(true);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/user/username', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ username: newUsername.trim() })
            });

            const data = await response.json();
            if (data.success) {
                // 更新本地用户数据
                const userData = JSON.parse(localStorage.getItem('userData') || '{}');
                userData.username = newUsername.trim();
                localStorage.setItem('userData', JSON.stringify(userData));
                localStorage.setItem('userName', newUsername.trim());

                // 刷新页面数据
                loadData();
                setEditingUsername(false);
                showMessage("success", "用户名修改成功");
            } else {
                showMessage("error", data.error || "修改失败");
            }
        } catch {
            showMessage("error", "修改失败，请稍后重试");
        } finally {
            setSavingUsername(false);
        }
    };

    // 修改登录密码
    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!oldPassword) {
            showMessage("error", "请输入当前密码");
            return;
        }
        if (!newPassword || newPassword.length < 6) {
            showMessage("error", "新密码至少需要6位");
            return;
        }
        if (newPassword !== confirmPassword) {
            showMessage("error", "两次输入的新密码不一致");
            return;
        }

        setChangingPassword(true);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/user/password', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    oldPassword,
                    newPassword,
                    confirmPassword
                })
            });

            const data = await response.json();
            if (data.success) {
                showMessage("success", "密码修改成功");
                setOldPassword("");
                setNewPassword("");
                setConfirmPassword("");
                setActiveTab("profile");
            } else {
                showMessage("error", data.error || "修改失败");
            }
        } catch {
            showMessage("error", "修改失败，请稍后重试");
        } finally {
            setChangingPassword(false);
        }
    };

    const showMessage = (type: "success" | "error", text: string) => {
        setMessage({
            type,
            text
        });

        setTimeout(() => setMessage(null), 3000);
    };

    // 打开额度生成对话框
    const openQuotaGenerateDialog = () => {
        setGenerateQuotaAmount("");
        setGeneratePreview(null);
        setShowQuotaGenerateDialog(true);
    };

    // 获取产品生成预览
    const fetchGeneratePreview = async () => {
        if (!generateQuotaAmount || parseInt(generateQuotaAmount) < 10000) {
            showMessage("error", "最低额度为1万元");
            return;
        }

        const providerId = localStorage.getItem("userId");
        if (!providerId) return;

        setLoadingPreview(true);
        try {
            const response = await authFetch(`/api/provider/generate-products?quota=${generateQuotaAmount}`);
            const data = await response.json();
            if (data.success) {
                setGeneratePreview(data.data);
            } else {
                showMessage("error", data.error || "获取预览失败");
                setGeneratePreview(null);
            }
        } catch {
            showMessage("error", "网络错误");
            setGeneratePreview(null);
        } finally {
            setLoadingPreview(false);
        }
    };

    // 使用自定义额度生成产品
    const handleGenerateWithQuota = async () => {
        const providerId = localStorage.getItem("userId");
        if (!providerId || !generateQuotaAmount) return;

        const amount = parseInt(generateQuotaAmount);
        if (amount < 10000) {
            showMessage("error", "最低额度为1万元");
            return;
        }

        setSubmitting(true);
        try {
            const response = await authFetch("/api/provider/generate-products", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    providerId,
                    customQuota: amount
                })
            });

            const data = await response.json();

            if (data.success) {
                showMessage("success", data.message || `成功生成 ${data.data?.stats?.total} 个算力`);
                setShowQuotaGenerateDialog(false);
                loadData();
            } else {
                showMessage("error", data.error || "生成失败");
            }
        } catch {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    // 原有的一键生成功能（使用全部额度）
    const handleGenerateProducts = async (allocationId: string) => {
        const providerId = localStorage.getItem("userId");

        if (!providerId)
            return;

        // 从allocations中找到对应的allocation
        const allocation = allocations.find(a => a.id === allocationId);
        if (!allocation) {
            showMessage("error", "未找到额度分配记录");
            return;
        }

        const quotaAmount = allocation.quota_amount;

        setSubmitting(true);

        try {
            const response = await authFetch("/api/provider/generate-products", {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    providerId,
                    allocationId,
                    quotaAmount
                })
            });

            const data = await response.json();

            if (data.success) {
                showMessage("success", data.message || `成功生成 ${data.data?.stats?.total} 个算力`);
                loadData();
            } else {
                showMessage("error", data.error || "生成失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    const handleListAllProducts = async () => {
        const providerId = localStorage.getItem("userId");

        if (!providerId)
            return;

        setSubmitting(true);

        try {
            // 先获取所有待上架的产品
            const listRes = await authFetch("/api/provider/products?providerId=" + providerId + "&status=all");
            const listData = await listRes.json();
            
            if (!listData.success || !listData.data?.products) {
                showMessage("error", "获取产品列表失败");
                setSubmitting(false);
                return;
            }
            
            // 筛选出 pending 状态的产品
            const pendingProducts = listData.data.products.filter((p: any) => 
                p.status === 'pending' || p.status === 'unlisted'
            );
            
            if (pendingProducts.length === 0) {
                showMessage("error", "没有待上架的产品");
                setSubmitting(false);
                return;
            }
            
            const productIds = pendingProducts.map((p: any) => p.id);
            
            // 使用 PUT 方法批量上架
            const response = await authFetch("/api/provider/products", {
                method: "PUT",

                body: JSON.stringify({
                    productIds,
                    status: "available"
                })
            });

            const data = await response.json();

            if (data.success) {
                showMessage("success", data.message || `成功上架 ${data.data?.listed_count} 个算力`);
                loadData();
            } else {
                showMessage("error", data.error || "上架失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    // 加载会员列表
    const loadEnergyMembers = async () => {
        const providerId = localStorage.getItem("userId");
        if (!providerId) return;

        try {
            const response = await authFetch(`/api/provider/recharge-energy?providerId=${providerId}`);
            const data = await response.json();
            if (data.success) {
                setEnergyMembers(data.data || []);
            }
        } catch (error) {
            console.error("加载会员列表失败:", error);
        }
    };

    // 加载可转账对象列表
    const loadTransferTargets = async () => {
        const providerId = localStorage.getItem("userId");
        if (!providerId) return;

        try {
            const response = await authFetch(`/api/energy/transfer-targets?userId=${providerId}`);
            const data = await response.json();
            if (data.success) {
                setTransferTargets(data.data?.transfer_targets || { branch: null, providers: [], members: [] });
            }
        } catch (error) {
            console.error("加载转账对象列表失败:", error);
        }
    };

    // 处理能量值互转
    const handleTransferEnergy = async () => {
        const providerId = localStorage.getItem("userId");
        if (!providerId || !transferUserId || !transferAmount) {
            showMessage("error", "请填写完整信息");
            return;
        }

        const amount = parseFloat(transferAmount);
        if (amount <= 0) {
            showMessage("error", "转账金额必须大于0");
            return;
        }

        if (amount < 50) {
            showMessage("error", "转账金额不能少于50");
            return;
        }

        setSubmitting(true);
        try {
            const response = await authFetch("/api/energy/transfer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    from_user_id: providerId,
                    to_user_id: transferUserId,
                    amount: amount,
                    note: transferNote,
                }),
            });
            const data = await response.json();
            if (data.success) {
                showMessage("success", data.message);
                setShowTransferDialog(false);
                setTransferUserId("");
                setTransferAmount("");
                setTransferNote("");
                loadData();
            } else {
                showMessage("error", data.error || "转账失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    // 处理额度申请
    const handleQuotaRequest = async () => {
        const providerId = localStorage.getItem("userId");
        if (!providerId || !quotaRequestAmount) {
            showMessage("error", "请填写申请金额");
            return;
        }

        const amount = parseFloat(quotaRequestAmount);
        if (amount <= 0) {
            showMessage("error", "申请金额必须大于0");
            return;
        }

        setSubmitting(true);
        try {
            const response = await authFetch("/api/provider/request-quota", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider_id: providerId,
                    amount: amount,
                    note: quotaRequestNote,
                }),
            });
            const data = await response.json();
            if (data.success) {
                showMessage("success", data.message);
                setShowQuotaRequestDialog(false);
                setQuotaRequestAmount("");
                setQuotaRequestNote("");
                loadQuotaRequests();
            } else {
                showMessage("error", data.error || "申请失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    // 加载额度申请记录
    const loadQuotaRequests = async () => {
        const providerId = localStorage.getItem("userId");
        if (!providerId) return;

        try {
            const response = await authFetch(`/api/provider/request-quota?providerId=${providerId}`);
            const data = await response.json();
            if (data.success) {
                setQuotaRequests(data.data || []);
            }
        } catch (error) {
            console.error("加载额度申请记录失败:", error);
        }
    };

    // 处理能量值充值
    const handleRechargeEnergy = async () => {
        const providerId = localStorage.getItem("userId");
        if (!providerId || !rechargeMemberId || !rechargeAmount) {
            showMessage("error", "请填写完整信息");
            return;
        }

        const amount = parseFloat(rechargeAmount);
        if (amount <= 0) {
            showMessage("error", "充值金额必须大于0");
            return;
        }

        setSubmitting(true);
        try {
            const response = await authFetch("/api/provider/recharge-energy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    providerId,
                    memberId: rechargeMemberId,
                    amount: amount,
                    note: rechargeNote,
                }),
            });
            const data = await response.json();
            if (data.success) {
                showMessage("success", data.message);
                setShowRechargeDialog(false);
                setRechargeMemberId("");
                setRechargeAmount("");
                setRechargeNote("");
                loadData();
            } else {
                showMessage("error", data.error || "充值失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    // 加载提现记录（收益提现）
    const loadWithdrawRecords = async () => {
        const providerId = localStorage.getItem("userId");
        if (!providerId) return;

        try {
            const response = await authFetch(`/api/provider/withdraw?userId=${providerId}`);
            const data = await response.json();
            if (data.success) {
                setWithdrawRecords(data.data || []);
            }
        } catch (error) {
            console.error("加载提现记录失败:", error);
        }
    };

    // 加载能量值申请记录
    const loadEnergyRequests = async () => {
        const providerId = localStorage.getItem("userId");
        if (!providerId) return;

        try {
            const response = await authFetch(`/api/energy/request?userId=${providerId}`);
            const data = await response.json();
            if (data.success) {
                setEnergyRequests(data.data || []);
            }
        } catch (error) {
            console.error("加载能量值申请记录失败:", error);
        }
    };

    // 提交能量值申请
    const handleEnergyRequest = async () => {
        const providerId = localStorage.getItem("userId");
        if (!providerId || !energyRequestAmount || parseFloat(energyRequestAmount) <= 0) {
            alert("请输入有效的申请金额");
            return;
        }

        const authFetch = async (url: string, options: RequestInit = {}) => {
            const token = localStorage.getItem('token');
            const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            return fetch(url, { ...options, headers });
        };

        try {
            setSubmitting(true);
            const response = await authFetch('/api/energy/request', {
                method: 'POST',
                body: JSON.stringify({
                    userId: providerId,
                    requestedAmount: parseFloat(energyRequestAmount),
                    note: energyRequestNote || '服务商申请能量值'
                })
            });
            const data = await response.json();
            if (data.success) {
                alert('能量值申请已提交，等待分公司审核');
                setShowEnergyRequestDialog(false);
                setEnergyRequestAmount("");
                setEnergyRequestNote("");
                loadEnergyRequests();
            } else {
                alert(data.error || '申请失败');
            }
        } catch (error) {
            console.error("申请能量值失败:", error);
            alert('申请失败，请重试');
        } finally {
            setSubmitting(false);
        }
    };

    // 加载转账记录
    const loadTransferRecords = async () => {
        const providerId = localStorage.getItem("userId");
        if (!providerId) return;

        try {
            const response = await authFetch(`/api/energy/transactions?userId=${providerId}&limit=20`);
            const data = await response.json();
            if (data.success) {
                setTransferRecords(data.data || []);
                setTransferStats(data.stats || {});
            }
        } catch (error) {
            console.error("加载转账记录失败:", error);
        }
    };

    // 加载流转审核数据
    const loadTransferData = useCallback(async () => {
        const providerId = localStorage.getItem("userId");
        if (!providerId) return;

        try {
            // 加载待审核流转
            const pendingRes = await authFetch(`/api/products/transfer/pending-review?providerId=${providerId}`);
            const pendingData = await pendingRes.json();
            if (pendingData.success) {
                setPendingTransfers(pendingData.data?.list || []);
            }

            // 加载待回购算力
            const repurchaseRes = await authFetch(`/api/products/transfer/pending-repurchase?providerId=${providerId}`);
            const repurchaseData = await repurchaseRes.json();
            if (repurchaseData.success) {
                setPendingRepurchases(repurchaseData.data?.list || []);
            }
        } catch (error) {
            console.error("加载流转数据失败:", error);
        }
    }, []);

    // 加载提现数据
    const loadWithdrawalData = useCallback(async () => {
        const providerId = localStorage.getItem("userId");
        if (!providerId) return;

        try {
            const res = await authFetch(`/api/provider/withdrawals?providerId=${providerId}`);
            const data = await res.json();
            if (data.success) {
                setPendingWithdrawals(data.data || []);
            }
        } catch (error) {
            console.error("加载提现数据失败:", error);
        }
    }, []);

    // 加载积分记录
    const loadPointsRecords = useCallback(async () => {
        try {
            const response = await authFetch(`/api/provider/points-records`);
            const data = await response.json();
            if (data.success && data.data) {
                setPointsRecords(data.data.records || []);
                setPointsStats(data.data.stats || { total_convert: 0, total_exchange: 0, available_points: 0 });
            }
        } catch (error) {
            console.error("加载积分记录失败:", error);
        }
    }, []);

    // 积分转能量值
    const handlePointsToEnergy = async () => {
        const amount = parseFloat(pointsConvertAmount);
        if (isNaN(amount) || amount <= 0) {
            showMessage("error", "请输入有效的积分数量");
            return;
        }
        if (amount > (Number(user?.points) || 0)) {
            showMessage("error", "积分不足");
            return;
        }

        setSubmitting(true);
        try {
            const userId = localStorage.getItem("userId");
            const response = await authFetch("/api/member/points-to-energy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, points: amount }),
            });
            const data = await response.json();
            if (data.success) {
                showMessage("success", `转换成功！${amount}积分 → ${amount}能量值`);
                setShowPointsToEnergyDialog(false);
                setPointsConvertAmount("");
                loadPointsRecords();
                loadData();
            } else {
                showMessage("error", data.error || "转换失败");
            }
        } catch (error) {
            showMessage("error", "转换失败");
        } finally {
            setSubmitting(false);
        }
    };

    // 流转审核处理
    const handleTransferReview = async (transferId: string, action: 'approve' | 'reject') => {
        const providerId = localStorage.getItem("userId");
        if (!providerId) return;

        setSubmitting(true);
        try {
            const response = await authFetch("/api/products/transfer/review", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    transferId,
                    reviewerId: providerId,
                    action,
                }),
            });
            const data = await response.json();
            if (data.success) {
                showMessage("success", data.message);
                loadTransferData();
            } else {
                showMessage("error", data.error || "审核失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    // 回购处理
    const handleRepurchase = async (transferId: string) => {
        const providerId = localStorage.getItem("userId");
        if (!providerId) return;

        setSubmitting(true);
        try {
            const response = await authFetch("/api/products/transfer/repurchase", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    transferId,
                    providerId,
                }),
            });
            const data = await response.json();
            if (data.success) {
                showMessage("success", data.message);
                loadTransferData();
            } else {
                showMessage("error", data.error || "回购失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    // 提现确认处理
    const handleWithdrawalConfirm = async (withdrawalId: string, action: 'approve' | 'reject') => {
        const providerId = localStorage.getItem("userId");
        if (!providerId) return;

        setSubmitting(true);
        try {
            const response = await authFetch("/api/withdrawals/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    withdrawalId,
                    providerId,
                    action,
                }),
            });
            const data = await response.json();
            if (data.success) {
                showMessage("success", data.message);
                loadWithdrawalData();
            } else {
                showMessage("error", data.error || "操作失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    const handleReviewApplication = async (
        applicationId: string,
        action: "approve" | "reject",
        quotaAllocated?: number
    ) => {
        const providerId = localStorage.getItem("userId");

        if (!providerId)
            return;

        setSubmitting(true);

        try {
            const response = await authFetch("/api/provider-applications/review", {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    applicationId,
                    reviewerId: providerId,
                    action,
                    quotaAllocated: action === "approve" ? quotaAllocated || 50000 : undefined
                })
            });

            const data = await response.json();

            if (data.success) {
                showMessage("success", data.message || "审核完成");
                loadData();
            } else {
                showMessage("error", data.error || "审核失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    const handleApplyQuota = async () => {
        const providerId = localStorage.getItem("userId");
        const storedUserData = localStorage.getItem("userData");
        const userData = storedUserData ? JSON.parse(storedUserData) : null;

        if (!providerId)
            return;

        if (!applyQuotaAmount || parseFloat(applyQuotaAmount) < 10000) {
            showMessage("error", "申请额度不能少于10,000元");
            return;
        }

        const branchId = userData?.branch_id;

        if (!branchId) {
            showMessage("error", "您还未绑定分公司，无法申请额度");
            return;
        }

        setSubmitting(true);

        try {
            const response = await authFetch("/api/quota-requests", {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    requesterId: providerId,
                    requesterType: "provider",
                    parentId: branchId,
                    requestedAmount: parseFloat(applyQuotaAmount),
                    bonusRate: 100
                })
            });

            const data = await response.json();

            if (data.success) {
                showMessage("success", data.message || "额度申请已提交，请等待分公司审核");
                setShowQuotaApplyDialog(false);
                setApplyQuotaAmount("");
                loadData();
            } else {
                showMessage("error", data.error || "申请失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    if (authLoading || loading) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <Loader2 className="w-16 h-16 text-purple-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50 to-slate-100">
            {}
            {message && <div
                className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl ${message.type === "success" ? "bg-gradient-to-r from-green-500 to-emerald-500" : "bg-gradient-to-r from-red-500 to-rose-500"} text-white shadow-xl animate-pulse`}>
                {message.text}
            </div>}
            {}
            {/* 顶部装饰条 */}
            <div className="h-1.5 bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500"></div>
            
            <header className="bg-gradient-to-r from-purple-900 via-purple-800 to-fuchsia-800 shadow-xl sticky top-0 z-40">
                <div className="container mx-auto px-6 py-5">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div
                                className="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-400 via-orange-500 to-red-500 flex items-center justify-center shadow-lg animate-pulse">
                                <Users className="w-7 h-7 text-white" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-white tracking-wide">服务商管理后台</h1>
                                <p className="text-xs text-purple-200">Provider Management System</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="hidden md:flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full">
                                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                <span className="text-purple-100 text-sm">在线</span>
                            </div>
                            <Badge className="bg-gradient-to-r from-yellow-400 to-orange-500 text-white border-0 shadow-lg">
                                <Star className="w-3 h-3 mr-1" />服务商
                                              </Badge>
                            <Button 
                                variant="ghost" 
                                onClick={logout}
                                className="text-white hover:bg-white/20 hover:text-white">
                                <LogOut className="w-4 h-4 mr-1" />退出
                            </Button>
                        </div>
                    </div>
                </div>
            </header>
            <main className="container mx-auto px-6 py-8">
                {}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                    <Card className="bg-gradient-to-br from-white to-orange-50 border-orange-200 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                        <CardContent className="pt-5">
                            <div className="flex items-center justify-between mb-3">
                                <div className="p-2.5 bg-gradient-to-br from-orange-400 to-orange-500 rounded-xl shadow-lg">
                                    <Zap className="w-5 h-5 text-white" />
                                </div>
                                <span className="text-xs font-medium text-orange-600 bg-orange-100 px-2 py-1 rounded-full">额度</span>
                            </div>
                            <p className="text-2xl font-bold mt-2 text-gradient bg-gradient-to-r from-orange-600 to-orange-700">¥{(stats.pending_quota || 0).toLocaleString()}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">待使用额度</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-gradient-to-br from-white to-yellow-50 border-yellow-200 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                        <CardContent className="pt-5">
                            <div className="flex items-center justify-between mb-3">
                                <div className="p-2.5 bg-gradient-to-br from-yellow-400 to-amber-500 rounded-xl shadow-lg">
                                    <Package className="w-5 h-5 text-white" />
                                </div>
                                <span className="text-xs font-medium text-yellow-600 bg-yellow-100 px-2 py-1 rounded-full">待上架</span>
                            </div>
                            <p className="text-2xl font-bold mt-2 text-gradient bg-gradient-to-r from-yellow-600 to-amber-600">{stats.pending_count}</p>
                            <p className="text-xs text-gray-500 mt-1">待上架算力</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-gradient-to-br from-white to-green-50 border-green-200 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                        <CardContent className="pt-5">
                            <div className="flex items-center justify-between mb-3">
                                <div className="p-2.5 bg-gradient-to-br from-green-400 to-emerald-500 rounded-xl shadow-lg">
                                    <ShoppingCart className="w-5 h-5 text-white" />
                                </div>
                                <span className="text-xs font-medium text-green-600 bg-green-100 px-2 py-1 rounded-full">已上架</span>
                            </div>
                            <p className="text-2xl font-bold mt-2 text-gradient bg-gradient-to-r from-green-600 to-emerald-600">{stats.available_count}</p>
                            <p className="text-xs text-gray-500 mt-1">可售算力</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-gradient-to-br from-white to-blue-50 border-blue-200 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                        <CardContent className="pt-5">
                            <div className="flex items-center justify-between mb-3">
                                <div className="p-2.5 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-xl shadow-lg">
                                    <TrendingUp className="w-5 h-5 text-white" />
                                </div>
                                <span className="text-xs font-medium text-blue-600 bg-blue-100 px-2 py-1 rounded-full">总额</span>
                            </div>
                            <p className="text-2xl font-bold mt-2 text-gradient bg-gradient-to-r from-blue-600 to-indigo-600">¥{(stats.total_value || 0).toLocaleString()}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">算力总值</p>
                        </CardContent>
                    </Card>
                    {/* 能量值卡片 */}
                    <Card className="col-span-2 md:col-span-1 bg-gradient-to-br from-purple-600 via-fuchsia-600 to-purple-700 border-0 shadow-xl">
                        <CardContent className="pt-5">
                            <div className="flex items-center justify-between mb-3">
                                <div className="p-2.5 bg-white/20 backdrop-blur rounded-xl">
                                    <Zap className="w-5 h-5 text-white" />
                                </div>
                                <span className="text-xs font-medium text-purple-200 bg-white/10 px-2 py-1 rounded-full backdrop-blur">能量值</span>
                            </div>
                            <p className="text-2xl font-bold mt-2 text-white">{user?.energyValue?.toLocaleString() || 0}</p>
                            <div className="flex gap-2 mt-3">
                                <Button 
                                    size="sm" 
                                    variant="outline" 
                                    className="text-xs h-7 bg-white/20 border-white/30 text-white hover:bg-white/30 hover:text-white"
                                    onClick={() => { loadTransferTargets(); setShowTransferDialog(true); }}
                                >
                                    转账
                                </Button>
                                <Button 
                                    size="sm" 
                                    variant="outline" 
                                    className="text-xs h-7 border-purple-300 text-purple-600"
                                    onClick={() => { loadEnergyMembers(); setShowRechargeDialog(true); }}
                                >
                                    充值
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
                {}
                {stats.pending_count > 0 && <Card className="mb-6 border-0 bg-gradient-to-r from-yellow-100 via-amber-100 to-orange-100 shadow-xl">
                    <CardContent className="py-5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-2xl shadow-lg">
                                    <AlertCircle className="w-6 h-6 text-white" />
                                </div>
                                <div>
                                    <p className="font-bold text-lg text-yellow-800">您有 {stats.pending_count}个待上架算力</p>
                                    <p className="text-sm text-yellow-600">点击一键上架，让会员可以购买您的算力</p>
                                </div>
                            </div>
                            <Button
                                className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 shadow-lg px-6"
                                onClick={handleListAllProducts}
                                disabled={submitting}>
                                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}一键上架
                                                </Button>
                        </div>
                    </CardContent>
                </Card>}
                {}
                <div className="space-y-6">
                    {/* Tab导航 - 紫色主题胶囊式 - 移动端横向滚动 */}
                    <div className="bg-white rounded-2xl shadow-lg p-2">
                        <div className="flex flex-nowrap gap-1 overflow-x-auto scrollbar-hide -mx-2 px-2">
                            <button
                                onClick={() => setActiveTab("profile")}
                                className={`px-4 py-2.5 rounded-xl transition-all duration-300 flex items-center gap-2 font-medium text-sm whitespace-nowrap ${activeTab === "profile" || activeTab === "password" ? "bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-lg shadow-purple-200" : "text-gray-600 hover:bg-purple-50"}`}>
                                <User className="w-4 h-4" />我的资料
                            </button>
                            <button
                                onClick={() => { setActiveTab("chain"); loadChainData(); }}
                                className={`px-4 py-2.5 rounded-xl transition-all duration-300 flex items-center gap-2 font-medium text-sm whitespace-nowrap ${activeTab === "chain" ? "bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-lg shadow-purple-200" : "text-gray-600 hover:bg-purple-50"}`}>
                                <Network className="w-4 h-4" />关系链
                            </button>
                            <button
                                onClick={() => setActiveTab("overview")}
                                className={`px-4 py-2.5 rounded-xl transition-all duration-300 flex items-center gap-2 font-medium text-sm whitespace-nowrap ${activeTab === "overview" ? "bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-lg shadow-purple-200" : "text-gray-600 hover:bg-purple-50"}`}>
                                <TrendingUp className="w-4 h-4" />概览
                            </button>
                            <button
                                onClick={() => setActiveTab("quota")}
                                className={`px-4 py-2.5 rounded-xl transition-all duration-300 flex items-center gap-2 font-medium text-sm whitespace-nowrap ${activeTab === "quota" ? "bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-lg shadow-purple-200" : "text-gray-600 hover:bg-purple-50"}`}>
                                <Database className="w-4 h-4" />额度管理
                            </button>
                            <button
                                onClick={() => setActiveTab("products")}
                                className={`px-4 py-2.5 rounded-xl transition-all duration-300 flex items-center gap-2 font-medium text-sm whitespace-nowrap ${activeTab === "products" ? "bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-lg shadow-purple-200" : "text-gray-600 hover:bg-purple-50"}`}>
                                <Package className="w-4 h-4" />算力列表
                            </button>
                            <button
                                onClick={() => {
                                    setActiveTab("sales");
                                    loadSalesRecords();
                                }}
                                className={`px-4 py-2.5 rounded-xl transition-all duration-300 flex items-center gap-2 font-medium text-sm whitespace-nowrap ${activeTab === "sales" ? "bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-lg shadow-purple-200" : "text-gray-600 hover:bg-purple-50"}`}>
                                <TrendingUp className="w-4 h-4" />销售记录
                                {salesStats.sold > 0 && <Badge className="ml-1 bg-gradient-to-r from-green-500 to-emerald-500 text-white text-xs shadow-lg">{salesStats.sold}</Badge>}
                            </button>
                            <button
                                onClick={() => setActiveTab("applications")}
                                className={`px-4 py-2.5 rounded-xl transition-all duration-300 flex items-center gap-2 font-medium text-sm whitespace-nowrap ${activeTab === "applications" ? "bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-lg shadow-purple-200" : "text-gray-600 hover:bg-purple-50"}`}>
                                <ClipboardList className="w-4 h-4" />审核申请
                                          {applications.length > 0 && <Badge className="ml-1 bg-gradient-to-r from-red-500 to-rose-500 text-white text-xs shadow-lg animate-pulse">{applications.length}</Badge>}
                            </button>
                            <button
                                onClick={() => {
                                    setActiveTab("buyorders");
                                    loadPendingBuyOrders();
                                }}
                                className={`px-4 py-2.5 rounded-xl transition-all duration-300 flex items-center gap-2 font-medium text-sm whitespace-nowrap ${activeTab === "buyorders" ? "bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-lg shadow-purple-200" : "text-gray-600 hover:bg-purple-50"}`}>
                                <ShoppingCart className="w-4 h-4" />购买审核
                                          {pendingBuyOrders.length > 0 && <Badge className="ml-1 bg-gradient-to-r from-red-500 to-rose-500 text-white text-xs shadow-lg animate-pulse">{pendingBuyOrders.length}</Badge>}
                            </button>
                            <button
                                onClick={() => setActiveTab("energy")}
                                className={`px-4 py-2.5 rounded-xl transition-all duration-300 flex items-center gap-2 font-medium text-sm whitespace-nowrap ${activeTab === "energy" ? "bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-lg shadow-purple-200" : "text-gray-600 hover:bg-purple-50"}`}>
                                <Zap className="w-4 h-4" />能量充值
                            </button>
                            <button
                                onClick={() => {
                                    setActiveTab("revenue");
                                    loadRevenueRecords();
                                }}
                                className={`px-4 py-2.5 rounded-xl transition-all duration-300 flex items-center gap-2 font-medium text-sm whitespace-nowrap ${activeTab === "revenue" ? "bg-gradient-to-r from-green-600 to-emerald-600 text-white shadow-lg shadow-green-200" : "text-gray-600 hover:bg-green-50"}`}>
                                <TrendingUp className="w-4 h-4" />收益记录
                            </button>
                            <button
                                onClick={() => {
                                    setActiveTab("transfers");
                                    loadTransferData();
                                }}
                                className={`px-4 py-2.5 rounded-xl transition-all duration-300 flex items-center gap-2 font-medium text-sm whitespace-nowrap ${activeTab === "transfers" ? "bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-lg shadow-purple-200" : "text-gray-600 hover:bg-purple-50"}`}>
                                <ArrowLeftRight className="w-4 h-4" />流转审核
                            </button>
                            <button
                                onClick={() => {
                                    setActiveTab("withdrawals");
                                    loadWithdrawalData();
                                }}
                                className={`px-4 py-2.5 rounded-xl transition-all duration-300 flex items-center gap-2 font-medium text-sm whitespace-nowrap ${activeTab === "withdrawals" ? "bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-lg shadow-purple-200" : "text-gray-600 hover:bg-purple-50"}`}>
                                <DollarSign className="w-4 h-4" />提现管理
                            </button>
                            <button
                                onClick={() => {
                                    setActiveTab("points");
                                    loadPointsRecords();
                                }}
                                className={`px-4 py-2.5 rounded-xl transition-all duration-300 flex items-center gap-2 font-medium text-sm whitespace-nowrap ${activeTab === "points" ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-200" : "text-gray-600 hover:bg-amber-50"}`}>
                                <Gift className="w-4 h-4" />我的积分
                            </button>
                        </div>
                    </div>

                    {/* 我的资料 */}
                    {activeTab === "profile" && (
                        <Card className="bg-gradient-to-br from-white to-purple-50 border-purple-200 shadow-xl">
                            <CardHeader className="bg-gradient-to-r from-purple-600 to-fuchsia-600 rounded-t-lg">
                                <CardTitle className="text-white flex items-center gap-2">
                                    <User className="w-5 h-5" />我的资料
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* 基本信息 */}
                                    <div className="space-y-4">
                                        <h3 className="font-medium text-lg border-b pb-2">基本信息</h3>
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between py-2 border-b">
                                                <span className="text-gray-500">用户ID</span>
                                                <span className="font-mono text-sm">{user?.id || '-'}</span>
                                            </div>
                                            <div className="flex items-center justify-between py-2 border-b">
                                                <span className="text-gray-500">用户名</span>
                                                {editingUsername ? (
                                                    <div className="flex items-center gap-2">
                                                        <Input
                                                            value={newUsername}
                                                            onChange={(e) => setNewUsername(e.target.value)}
                                                            className="w-32 h-8 text-sm"
                                                            maxLength={20}
                                                        />
                                                        <Button size="sm" onClick={handleSaveUsername} disabled={savingUsername}>
                                                            {savingUsername ? <Loader2 className="w-4 h-4 animate-spin" /> : '保存'}
                                                        </Button>
                                                        <Button size="sm" variant="outline" onClick={() => { setEditingUsername(false); setNewUsername(user?.username || ''); }}>
                                                            取消
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium">{user?.username || '-'}</span>
                                                        <Button size="sm" variant="ghost" onClick={() => setEditingUsername(true)}>
                                                            <span className="text-blue-500 text-xs">修改</span>
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center justify-between py-2 border-b">
                                                <span className="text-gray-500">角色</span>
                                                <Badge className="bg-purple-100 text-purple-700">服务商</Badge>
                                            </div>
                                            <div className="flex items-center justify-between py-2 border-b">
                                                <span className="text-gray-500">手机号</span>
                                                <span>{user?.phone || '-'}</span>
                                            </div>
                                            <div className="flex items-center justify-between py-2 border-b">
                                                <span className="text-gray-500">真实姓名</span>
                                                <span className="text-slate-500 italic text-sm">（对应支付宝账户）</span>
                                            </div>
                                            <div className="flex items-center justify-between py-2 border-b">
                                                <span className="text-gray-500">登录密码</span>
                                                <Button size="sm" variant="outline" onClick={() => setActiveTab("password")}>
                                                    <Lock className="w-4 h-4 mr-1" />修改密码
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* 修改密码 */}
                    {activeTab === "password" && (
                        <Card className="bg-gradient-to-br from-white to-purple-50 border-purple-200 shadow-xl">
                            <CardHeader className="bg-gradient-to-r from-purple-600 to-fuchsia-600 rounded-t-lg">
                                <CardTitle className="text-white flex items-center gap-2">
                                    <Lock className="w-5 h-5" />修改登录密码
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
                                    <div className="space-y-2">
                                        <Label>当前密码</Label>
                                        <div className="relative">
                                            <Input
                                                type={showOldPassword ? "text" : "password"}
                                                value={oldPassword}
                                                onChange={(e) => setOldPassword(e.target.value)}
                                                placeholder="请输入当前密码"
                                                className="pr-10"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowOldPassword(!showOldPassword)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                            >
                                                {showOldPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>新密码</Label>
                                        <div className="relative">
                                            <Input
                                                type={showNewPassword ? "text" : "password"}
                                                value={newPassword}
                                                onChange={(e) => setNewPassword(e.target.value)}
                                                placeholder="请输入新密码（至少6位）"
                                                className="pr-10"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowNewPassword(!showNewPassword)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                            >
                                                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>确认新密码</Label>
                                        <div className="relative">
                                            <Input
                                                type={showConfirmPassword ? "text" : "password"}
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                placeholder="请再次输入新密码"
                                                className="pr-10"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                            >
                                                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex gap-4">
                                        <Button
                                            type="submit"
                                            disabled={changingPassword}
                                            className="flex-1 bg-gradient-to-r from-purple-600 to-fuchsia-600"
                                        >
                                            {changingPassword ? (
                                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                            ) : (
                                                <Lock className="w-4 h-4 mr-2" />
                                            )}
                                            {changingPassword ? "修改中..." : "确认修改"}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => setActiveTab("profile")}
                                        >
                                            返回
                                        </Button>
                                    </div>
                                </form>
                            </CardContent>
                        </Card>
                    )}

                    {/* 关系链Tab */}
                    {activeTab === "chain" && (
                        <div className="space-y-4">
                            {chainLoading ? (
                                <Card>
                                    <CardContent className="py-12 text-center">
                                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-purple-600" />
                                        <p className="mt-4 text-gray-500">加载中...</p>
                                    </CardContent>
                                </Card>
                            ) : chainData ? (
                                <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2 text-white">
                                            <Network className="w-5 h-5 text-purple-400" />
                                            我的关系链
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        {/* 关系说明 */}
                                        <div className="space-y-4">
                                            {/* 服务商关系链：总公司 → 分公司 → 服务商 */}
                                            <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700">
                                                <h4 className="text-purple-400 font-medium mb-3 flex items-center gap-2">
                                                    <Badge className="bg-purple-600 text-white text-xs">服务商</Badge>
                                                    关系链说明
                                                </h4>
                                                <div className="flex flex-wrap items-center gap-2 text-slate-300 text-sm">
                                                    <span>总公司</span>
                                                    <ArrowRight className="w-4 h-4 text-slate-500" />
                                                    <span>分公司</span>
                                                    <ArrowRight className="w-4 h-4 text-slate-500" />
                                                    <span className="text-purple-400 font-medium">{chainData.self?.username || '我'}</span>
                                                    <ArrowRight className="w-4 h-4 text-slate-500" />
                                                    <span className="text-green-400">我的会员</span>
                                                </div>
                                            </div>

                                            {/* 关系详情列表 */}
                                            <div className="space-y-3">
                                                {/* 分公司 */}
                                                {chainData.branch && (
                                                    <div className="flex items-center gap-3 p-3 bg-blue-900/30 rounded-lg border border-blue-800/50">
                                                        <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
                                                            <Award className="w-5 h-5 text-white" />
                                                        </div>
                                                        <div className="flex-1">
                                                            <p className="text-blue-400 font-medium">{chainData.branch.username}</p>
                                                            <p className="text-slate-400 text-sm">上级：总公司</p>
                                                        </div>
                                                        <Badge className="bg-blue-600 text-white">分公司</Badge>
                                                    </div>
                                                )}

                                                {/* 当前服务商 */}
                                                <div className="flex items-center gap-3 p-3 bg-purple-900/30 rounded-lg border border-purple-800/50">
                                                    <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center">
                                                        <Server className="w-5 h-5 text-white" />
                                                    </div>
                                                    <div className="flex-1">
                                                        <p className="text-purple-400 font-bold">{chainData.self?.username}</p>
                                                        <p className="text-slate-400 text-sm">
                                                            下级：{chainData.members?.length || 0} 个会员
                                                        </p>
                                                    </div>
                                                    <Badge className="bg-purple-600 text-white">服务商</Badge>
                                                </div>

                                                {/* 下级会员 */}
                                                {chainData.members && chainData.members.length > 0 && (
                                                    <div className="p-3 bg-green-900/20 rounded-lg border border-green-800/50">
                                                        <p className="text-green-400 font-medium mb-3 flex items-center gap-2">
                                                            <Users className="w-4 h-4" />
                                                            我的会员 ({chainData.members.length})
                                                        </p>
                                                        <div className="space-y-2">
                                                            {chainData.members.slice(0, 5).map((member: any) => (
                                                                <div key={member.id} className="flex items-center gap-2 p-2 bg-slate-800/50 rounded-lg">
                                                                    <div className="w-8 h-8 rounded-full bg-green-600/30 flex items-center justify-center">
                                                                        <User className="w-4 h-4 text-green-400" />
                                                                    </div>
                                                                    <div className="flex-1">
                                                                        <p className="text-white text-sm">{member.username}</p>
                                                                        <p className="text-slate-500 text-xs">{member.phone?.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}</p>
                                                                    </div>
                                                                    <Badge className="bg-green-600/30 text-green-400 text-xs">会员</Badge>
                                                                </div>
                                                            ))}
                                                            {chainData.members.length > 5 && (
                                                                <p className="text-center text-slate-500 text-sm py-2">还有 {chainData.members.length - 5} 个会员...</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* 无下级会员提示 */}
                                                {(!chainData.members || chainData.members.length === 0) && (
                                                    <div className="text-center py-6 text-slate-500">
                                                        <Users className="w-10 h-10 mx-auto mb-2 opacity-50" />
                                                        <p>暂无下级会员</p>
                                                    </div>
                                                )}
                                            </div>

                                            {/* 无上级提示 */}
                                            {!chainData.branch && !chainData.inviter && (
                                                <div className="text-center py-6 text-slate-500">
                                                    <Network className="w-10 h-10 mx-auto mb-2 opacity-50" />
                                                    <p>您还没有关联上级</p>
                                                </div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            ) : (
                                <Card>
                                    <CardContent className="py-12 text-center">
                                        <Network className="w-12 h-12 mx-auto text-gray-300" />
                                        <p className="mt-4 text-gray-500">暂无关系链数据</p>
                                    </CardContent>
                                </Card>
                            )}
                        </div>
                    )}

                    {activeTab === "overview" && <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card className="bg-gradient-to-br from-white to-blue-50 border-blue-200 shadow-lg">
                            <CardHeader className="pb-2">
                                <h3 className="font-bold text-lg flex items-center gap-2 text-blue-700">
                                    <Zap className="w-5 h-5" />快捷操作
                                </h3>
                            </CardHeader>
                            <CardContent className="pt-2">
                                <div className="space-y-3">
                                    {stats.pending_quota >= 10000 && <div className="p-4 bg-gradient-to-r from-blue-50 to-cyan-50 rounded-xl border border-blue-200">
                                        <p className="text-sm text-blue-700 font-medium mb-2">您有待使用的额度: ¥{(stats.pending_quota || 0).toLocaleString()}</p>
                                        <p className="text-xs text-blue-500">前往额度管理，一键生成算力</p>
                                    </div>}
                                    {stats.pending_count > 0 && <Button
                                        onClick={handleListAllProducts}
                                        className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 shadow-lg"
                                        disabled={submitting}>
                                        <CheckCircle className="w-4 h-4 mr-2" />一键上架 {stats.pending_count}个算力
                                                              </Button>}
                                    <Button
                                        onClick={() => setActiveTab("quota")}
                                        variant="outline"
                                        className="w-full border-purple-300 text-purple-600 hover:bg-purple-50">
                                        <Database className="w-4 h-4 mr-2" />查看额度分配
                                                            </Button>
                                    <Button
                                        onClick={() => setActiveTab("products")}
                                        variant="outline"
                                        className="w-full border-fuchsia-300 text-fuchsia-600 hover:bg-fuchsia-50">
                                        <Package className="w-4 h-4 mr-2" />管理算力
                                                            </Button>
                                </div>
                            </CardContent>
                        </Card>
                        <Card className="bg-gradient-to-br from-white to-purple-50 border-purple-200 shadow-lg">
                            <CardHeader className="pb-2">
                                <h3 className="font-bold text-lg flex items-center gap-2 text-purple-700">
                                    <TrendingUp className="w-5 h-5" />算力流转说明
                                </h3>
                            </CardHeader>
                            <CardContent className="pt-2">
                                <div className="space-y-4 text-sm">
                                    <div className="flex items-start gap-3">
                                        <div
                                            className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center flex-shrink-0">1</div>
                                        <div>
                                            <p className="font-medium">收到额度分配</p>
                                            <p className="text-gray-500">分公司为您分配算力额度</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <div
                                            className="w-6 h-6 rounded-full bg-purple-500 text-white text-xs flex items-center justify-center flex-shrink-0">2</div>
                                        <div>
                                            <p className="font-medium">生成算力</p>
                                            <p className="text-gray-500">5万额度生成15个价格不等的算力</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <div
                                            className="w-6 h-6 rounded-full bg-green-500 text-white text-xs flex items-center justify-center flex-shrink-0">3</div>
                                        <div>
                                            <p className="font-medium">一键上架</p>
                                            <p className="text-gray-500">算力上架后会员即可购买</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <div
                                            className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center flex-shrink-0">4</div>
                                        <div>
                                            <p className="font-medium">会员购买</p>
                                            <p className="text-gray-500">会员购买后您获得收益</p>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>}
                    {}
                    {activeTab === "quota" && <div className="space-y-6">
                        {}
                        {/* 额度统计卡片 */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <Card className="bg-gradient-to-br from-purple-500 to-fuchsia-600 text-white">
                                <CardContent className="py-4">
                                    <p className="text-purple-100 text-sm">总分配额度</p>
                                    <p className="text-2xl font-bold mt-1">¥{(stats.total_quota || 0).toLocaleString()}</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-gradient-to-br from-blue-500 to-cyan-600 text-white">
                                <CardContent className="py-4">
                                    <p className="text-blue-100 text-sm">已使用额度</p>
                                    <p className="text-2xl font-bold mt-1">¥{(stats.used_quota || 0).toLocaleString()}</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-gradient-to-br from-green-500 to-emerald-600 text-white">
                                <CardContent className="py-4">
                                    <p className="text-green-100 text-sm">可用额度</p>
                                    <p className="text-2xl font-bold mt-1">¥{(stats.available_quota || 0).toLocaleString()}</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-gradient-to-br from-orange-500 to-amber-600 text-white">
                                <CardContent className="py-4">
                                    <p className="text-orange-100 text-sm">可生成产品数</p>
                                    <p className="text-2xl font-bold mt-1">{Math.floor((stats.available_quota || 0) / 10000) * 4} 个</p>
                                </CardContent>
                            </Card>
                        </div>

                        {/* 快速生成产品卡片 */}
                        {(stats.available_quota || 0) >= 10000 ? (
                            <Card className="border-purple-200 bg-gradient-to-r from-purple-50 to-fuchsia-50">
                                <CardContent className="py-6">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="p-3 bg-gradient-to-br from-purple-500 to-fuchsia-600 rounded-2xl shadow-lg">
                                                <Zap className="w-6 h-6 text-white" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-lg text-purple-800">可用额度 ¥{(stats.available_quota || 0).toLocaleString()}</p>
                                                <p className="text-sm text-purple-600">可生成 {Math.floor((stats.available_quota || 0) / 10000) * 4} 个算力产品</p>
                                            </div>
                                        </div>
                                        <Button
                                            onClick={openQuotaGenerateDialog}
                                            className="bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-700 hover:to-fuchsia-700 shadow-lg px-6"
                                        >
                                            <Plus className="w-4 h-4 mr-2" />自定义生成产品
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card className="border-gray-200 bg-gray-50">
                                <CardContent className="py-6 text-center">
                                    <AlertCircle className="w-10 h-10 mx-auto text-gray-400 mb-2" />
                                    <p className="text-gray-500">可用额度不足，需达到1万元才能生成产品</p>
                                    <p className="text-sm text-gray-400 mt-1">当前可用：¥{(stats.available_quota || 0).toLocaleString()}</p>
                                </CardContent>
                            </Card>
                        )}

                        <Card className="border-blue-200 bg-blue-50">
                            <CardContent className="py-4">
                                <h4 className="font-medium text-blue-800 mb-3">💡 算力生成规则（5万额度）</h4>
                                <div className="grid grid-cols-4 gap-4 text-sm">
                                    <div className="p-3 bg-white rounded-lg">
                                        <p className="text-blue-600 font-medium">小额算力</p>
                                        <p className="text-gray-500">200-1000元 × 4个</p>
                                        <p className="text-xs text-gray-400 mt-1">约2,400元</p>
                                    </div>
                                    <div className="p-3 bg-white rounded-lg">
                                        <p className="text-blue-600 font-medium">中小算力</p>
                                        <p className="text-gray-500">1千-6千元 × 5个</p>
                                        <p className="text-xs text-gray-400 mt-1">约17,500元</p>
                                    </div>
                                    <div className="p-3 bg-white rounded-lg">
                                        <p className="text-blue-600 font-medium">中大算力</p>
                                        <p className="text-gray-500">6千-7千元 × 3个</p>
                                        <p className="text-xs text-gray-400 mt-1">约19,500元</p>
                                    </div>
                                    <div className="p-3 bg-white rounded-lg">
                                        <p className="text-blue-600 font-medium">大额算力</p>
                                        <p className="text-gray-500">7千-1万元 × 3个</p>
                                        <p className="text-xs text-gray-400 mt-1">约25,500元</p>
                                    </div>
                                </div>
                                <p className="text-xs text-blue-600 mt-3">* 实际价格会根据额度按比例调整，价格取整到百位</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <CardTitle>收到的额度分配</CardTitle>
                                    <Button 
                                        onClick={() => { loadQuotaRequests(); setShowQuotaRequestDialog(true); }} 
                                        className="bg-orange-600"
                                    >
                                        <Plus className="w-4 h-4 mr-2" />申请额度
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b bg-gray-50">
                                                <th className="text-left py-3 px-4">算力模板</th>
                                                <th className="text-left py-3 px-4">分配额度</th>
                                                <th className="text-left py-3 px-4">已用额度</th>
                                                <th className="text-left py-3 px-4">剩余额度</th>
                                                <th className="text-left py-3 px-4">状态</th>
                                                <th className="text-left py-3 px-4">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {allocations.map(allocation => {
                                                const remaining = allocation.quota_amount - allocation.used_amount;

                                                return (
                                                    <tr key={allocation.id} className="border-b hover:bg-gray-50">
                                                        <td className="py-3 px-4">
                                                            <div>
                                                                <p className="font-medium">{allocation.product_templates?.name || "-"}</p>
                                                                <p className="text-sm text-gray-500">
                                                                    {allocation.product_templates?.period}天 | {allocation.product_templates?.period ? allocation.product_templates.period * 24 : 0}小时锁 | 收益{allocation.product_templates?.total_rate}%
                                                                                                      </p>
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-4 text-green-600 font-medium">¥{(allocation.quota_amount || 0).toLocaleString()}
                                                        </td>
                                                        <td className="py-3 px-4 text-orange-600">¥{(allocation.used_amount || 0).toLocaleString()}
                                                        </td>
                                                        <td className="py-3 px-4 text-blue-600 font-medium">¥{remaining.toLocaleString()}
                                                        </td>
                                                        <td className="py-3 px-4">
                                                            <Badge
                                                                className={allocation.status === "active" ? "bg-green-100 text-green-700" : allocation.status === "completed" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"}>
                                                                {allocation.status === "active" ? "可使用" : allocation.status === "completed" ? "已完成" : allocation.status}
                                                            </Badge>
                                                        </td>
                                                        <td className="py-3 px-4">
                                                            {remaining >= 10000 && allocation.status === "active" && <Button
                                                                size="sm"
                                                                className="bg-purple-600"
                                                                onClick={() => handleGenerateProducts(allocation.id)}
                                                                disabled={submitting}>
                                                                {submitting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}生成算力
                                                                                                  </Button>}
                                                            {remaining < 10000 && allocation.status === "active" && <span className="text-sm text-gray-500">额度不足</span>}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            {allocations.length === 0 && <tr>
                                                <td colSpan={6} className="py-8 text-center text-gray-500">暂无额度分配，请点击右上角按钮申请额度
                                                                                </td>
                                            </tr>}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>

                        {/* 额度申请记录 */}
                        <Card>
                            <CardHeader>
                                <CardTitle>我的额度申请记录</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b bg-gray-50">
                                                <th className="text-left py-3 px-4">申请金额</th>
                                                <th className="text-left py-3 px-4">批准金额</th>
                                                <th className="text-left py-3 px-4">申请时间</th>
                                                <th className="text-left py-3 px-4">状态</th>
                                                <th className="text-left py-3 px-4">备注</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {quotaRequests.map(request => (
                                                <tr key={request.id} className="border-b hover:bg-gray-50">
                                                    <td className="py-3 px-4 text-orange-600 font-medium">
                                                        ¥{(request.requested_amount || 0).toLocaleString()}
                                                    </td>
                                                    <td className="py-3 px-4 text-green-600 font-medium">
                                                        {request.status === 'approved' ? `¥${(request.approved_amount || 0).toLocaleString()}` : '-'}
                                                    </td>
                                                    <td className="py-3 px-4 text-gray-600">
                                                        {new Date(request.created_at).toLocaleString()}
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <Badge className={
                                                            request.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                                                            request.status === 'approved' ? 'bg-green-100 text-green-700' :
                                                            'bg-red-100 text-red-700'
                                                        }>
                                                            {request.status === 'pending' ? '待审批' : request.status === 'approved' ? '已通过' : '已拒绝'}
                                                        </Badge>
                                                    </td>
                                                    <td className="py-3 px-4 text-gray-500 text-sm">
                                                        {request.note || '-'}
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
                    </div>}
                    {}
                    {activeTab === "products" && <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle>我的算力</CardTitle>
                                <div className="flex gap-2">
                                    {stats.pending_count > 0 && <Button
                                        onClick={handleListAllProducts}
                                        className="bg-green-600"
                                        disabled={submitting}>
                                        <CheckCircle className="w-4 h-4 mr-2" />一键上架全部
                                                              </Button>}
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
                                            <th className="text-left py-3 px-4">算力名称</th>
                                            <th className="text-left py-3 px-4">价格</th>
                                            <th className="text-left py-3 px-4">周期</th>
                                            <th className="text-left py-3 px-4">时间锁</th>
                                            <th className="text-left py-3 px-4">收益率</th>
                                            <th className="text-left py-3 px-4">状态</th>
                                            <th className="text-left py-3 px-4">创建时间</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {products.map(product => <tr key={product.id} className="border-b hover:bg-gray-50">
                                            <td className="py-3 px-4">
                                                <div>
                                                    <p className="font-medium">{product.name}</p>
                                                    <p className="text-sm text-gray-500">{product.code}</p>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 text-green-600 font-medium">¥{(product.price || 0).toLocaleString()}
                                            </td>
                                            <td className="py-3 px-4">{product.period}天</td>
                                            <td className="py-3 px-4">
                                                <Badge variant="outline" className={product.period === 3 ? "text-orange-600 border-orange-300" : "text-red-600 border-red-300"}>
                                                    {product.period * 24}小时
                                                </Badge>
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="text-sm">
                                                    <span className="text-green-600">总{product.total_rate}%</span>
                                                    <span className="text-gray-400 mx-1">|</span>
                                                    <span className="text-blue-600">会员{product.profit_rate}%</span>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4">
                                                <Badge
                                                    className={
                                                        product.status === "pending" || product.status === "unlisted" ? "bg-orange-100 text-orange-700" :
                                                        product.status === "available" ? "bg-green-100 text-green-700" :
                                                        product.status === "sold" ? "bg-blue-100 text-blue-700" :
                                                        product.status === "pending_sell" ? "bg-purple-100 text-purple-700" :
                                                        "bg-gray-100 text-gray-700"
                                                    }>
                                                    {product.status === "pending" || product.status === "unlisted" ? "待上架" :
                                                     product.status === "available" ? "已上架" :
                                                     product.status === "sold" ? "已出售" :
                                                     product.status === "pending_sell" ? "待流转" :
                                                     "闲置中"}
                                                </Badge>
                                            </td>
                                            <td className="py-3 px-4 text-sm text-gray-500">
                                                {product.created_at?.slice(0, 10)}
                                            </td>
                                        </tr>)}
                                        {products.length === 0 && <tr>
                                            <td colSpan={7} className="py-8 text-center text-gray-500">暂无算力，请先使用额度生成算力
                                                                          </td>
                                        </tr>}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>}

                    {/* 销售记录Tab */}
                    {activeTab === "sales" && <div className="space-y-6">
                        {/* 统计卡片 */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <Card className="bg-gradient-to-br from-purple-500 to-fuchsia-600 text-white">
                                <CardContent className="pt-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Package className="w-5 h-5" />
                                        <span className="text-sm opacity-80">总产品数</span>
                                    </div>
                                    <p className="text-2xl font-bold">{salesStats.total || 0}</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-gradient-to-br from-green-500 to-emerald-600 text-white">
                                <CardContent className="pt-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <ShoppingBag className="w-5 h-5" />
                                        <span className="text-sm opacity-80">已售出</span>
                                    </div>
                                    <p className="text-2xl font-bold">{salesStats.sold || 0}</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-gradient-to-br from-blue-500 to-cyan-600 text-white">
                                <CardContent className="pt-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <TrendingUp className="w-5 h-5" />
                                        <span className="text-sm opacity-80">在售</span>
                                    </div>
                                    <p className="text-2xl font-bold">{salesStats.available || 0}</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-gradient-to-br from-amber-500 to-orange-600 text-white">
                                <CardContent className="pt-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <DollarSign className="w-5 h-5" />
                                        <span className="text-sm opacity-80">销售总额</span>
                                    </div>
                                    <p className="text-2xl font-bold">¥{(salesStats.totalAmount || 0).toLocaleString()}</p>
                                </CardContent>
                            </Card>
                        </div>

                        {/* 筛选和列表 */}
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <CardTitle>产品销售记录</CardTitle>
                                    <div className="flex gap-2">
                                        <select
                                            className="px-3 py-2 border rounded-lg text-sm"
                                            value={salesFilter}
                                            onChange={e => {
                                                setSalesFilter(e.target.value);
                                                setTimeout(() => loadSalesRecords(), 0);
                                            }}>
                                            <option value="all">全部状态</option>
                                            <option value="available">在售</option>
                                            <option value="sold">已售出</option>
                                        </select>
                                        <Button variant="outline" onClick={() => loadSalesRecords()}>
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
                                                <th className="text-left py-3 px-4">产品名称</th>
                                                <th className="text-left py-3 px-4">价格</th>
                                                <th className="text-left py-3 px-4">周期</th>
                                                <th className="text-left py-3 px-4">状态</th>
                                                <th className="text-left py-3 px-4">持有人</th>
                                                <th className="text-left py-3 px-4">购买日期</th>
                                                <th className="text-left py-3 px-4">到期日期</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {salesRecords.map(record => (
                                                <tr key={record.productId} className="border-b hover:bg-gray-50">
                                                    <td className="py-3 px-4">
                                                        <div>
                                                            <p className="font-medium">{record.name}</p>
                                                            <p className="text-sm text-gray-500">{record.code}</p>
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-4 text-green-600 font-medium">
                                                        ¥{(record.price || 0).toLocaleString()}
                                                    </td>
                                                    <td className="py-3 px-4">{record.period}天</td>
                                                    <td className="py-3 px-4">
                                                        <Badge className={
                                                            record.productStatus === "available" ? "bg-green-100 text-green-700" :
                                                            record.productStatus === "sold" ? "bg-blue-100 text-blue-700" :
                                                            "bg-gray-100 text-gray-700"
                                                        }>
                                                            {record.productStatus === "available" ? "在售" :
                                                             record.productStatus === "sold" ? "已售出" : "其他"}
                                                        </Badge>
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        {record.holder ? (
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                                                                    <User className="w-4 h-4 text-purple-600" />
                                                                </div>
                                                                <div>
                                                                    <p className="font-medium text-sm">{record.holder.name}</p>
                                                                    <p className="text-xs text-gray-500">{record.holder.phone?.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}</p>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <span className="text-gray-400 text-sm">-</span>
                                                        )}
                                                    </td>
                                                    <td className="py-3 px-4 text-sm text-gray-500">
                                                        {record.holder?.purchaseDate?.slice(0, 10) || '-'}
                                                    </td>
                                                    <td className="py-3 px-4 text-sm">
                                                        {record.holder?.expireDate ? (
                                                            <span className={
                                                                new Date(record.holder.expireDate) < new Date() ? 'text-red-600' : 'text-gray-600'
                                                            }>
                                                                {record.holder.expireDate.slice(0, 10)}
                                                            </span>
                                                        ) : '-'}
                                                    </td>
                                                </tr>
                                            ))}
                                            {salesRecords.length === 0 && (
                                                <tr>
                                                    <td colSpan={7} className="py-8 text-center text-gray-500">
                                                        暂无销售记录
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>
                    </div>}

                    {activeTab === "applications" && <div className="space-y-6">
                        {}
                        <Card className="border-purple-200 bg-purple-50">
                            <CardContent className="py-4">
                                <h4 className="font-medium text-purple-800 mb-2">💡 下级服务商审核说明</h4>
                                <p className="text-sm text-purple-600">通过审核后，将从您的额度中拆分给下级服务商。建议分配额度为5万元的倍数。
                                                      </p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <CardTitle>第二代服务商申请</CardTitle>
                                    <Badge className="bg-purple-100 text-purple-700">待审核: {applications.length}个
                                                            </Badge>
                                </div>
                            </CardHeader>
                            <CardContent>
                                {applications.length === 0 ? <div className="py-12 text-center text-gray-500">
                                    <ClipboardList className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                                    <p>暂无待审核的申请</p>
                                </div> : <div className="space-y-4">
                                    {applications.map(
                                        app => <div key={app.id} className="p-4 border rounded-lg hover:bg-gray-50">
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <h4 className="font-medium">{app.applicant_name || app.users?.real_name || "申请人"}</h4>
                                                        <Badge className="bg-blue-100 text-blue-700">第二代申请
                                                                                            </Badge>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                                                        <div>
                                                            <span className="text-gray-400">用户名：</span>
                                                            {app.users?.username || "-"}
                                                        </div>
                                                        <div>
                                                            <span className="text-gray-400">手机号：</span>
                                                            {app.phone || "-"}
                                                        </div>
                                                        <div>
                                                            <span className="text-gray-400">支付宝：</span>
                                                            {app.alipay_account || "-"}
                                                        </div>
                                                        <div>
                                                            <span className="text-gray-400">申请额度：</span>
                                                            <span className="text-green-600 font-medium">¥{(app.quota_request || 50000).toLocaleString()}</span>
                                                        </div>
                                                    </div>
                                                    <div className="mt-2 text-xs text-gray-400">申请时间: {new Date(app.created_at).toLocaleString()}
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 ml-4">
                                                    <Button
                                                        size="sm"
                                                        className="bg-green-600 hover:bg-green-700"
                                                        onClick={() => handleReviewApplication(app.id, "approve", app.quota_request)}
                                                        disabled={submitting}>
                                                        <CheckCircle className="w-4 h-4 mr-1" />通过
                                                                                      </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="destructive"
                                                        onClick={() => {
                                                            const reason = prompt("请输入拒绝原因:");

                                                            if (reason) {
                                                                handleReviewApplication(app.id, "reject");
                                                            }
                                                        }}
                                                        disabled={submitting}>
                                                        <XCircle className="w-4 h-4 mr-1" />拒绝
                                                                                      </Button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>}
                            </CardContent>
                        </Card>
                    </div>}

                    {/* 购买审核Tab */}
                    {activeTab === "buyorders" && <div className="space-y-6">
                        {}
                        {/* 统计卡片 */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <Card className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                                <CardContent className="py-4">
                                    <p className="text-blue-100 text-sm">待审核订单</p>
                                    <p className="text-2xl font-bold mt-1">{pendingBuyOrders.length} 单</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-gradient-to-br from-green-500 to-emerald-600 text-white">
                                <CardContent className="py-4">
                                    <p className="text-green-100 text-sm">已完成订单</p>
                                    <p className="text-2xl font-bold mt-1">{completedBuyOrders.length} 单</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-gradient-to-br from-orange-500 to-amber-600 text-white">
                                <CardContent className="py-4">
                                    <p className="text-orange-100 text-sm">待审核总额</p>
                                    <p className="text-2xl font-bold mt-1">¥{pendingBuyOrders.reduce((sum, o) => sum + Number(o.amount || 0), 0).toLocaleString()}</p>
                                </CardContent>
                            </Card>
                        </div>

                        {/* 待审核订单列表 */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <ShoppingCart className="w-5 h-5 text-purple-600" />
                                    待审核购买订单
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {pendingBuyOrders.length === 0 ? (
                                    <div className="text-center py-12 text-gray-500">
                                        <ShoppingCart className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                                        <p>暂无待审核订单</p>
                                        <p className="text-sm text-gray-400 mt-1">会员购买产品后将在此显示</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {pendingBuyOrders.map((order) => (
                                            <div key={order.order_id} className="border border-purple-200 rounded-xl p-4 bg-gradient-to-r from-purple-50 to-fuchsia-50">
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="p-2 bg-purple-100 rounded-lg">
                                                            <ShoppingCart className="w-5 h-5 text-purple-600" />
                                                        </div>
                                                        <div>
                                                            <p className="font-semibold text-gray-800">{order.username || "未知用户"} {order.unique_id ? `(${order.unique_id})` : ''}</p>
                                                            <p className="text-sm text-gray-500">手机号: {order.phone || "未提供"}</p>
                                                        </div>
                                                    </div>
                                                    <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
                                                        待审核
                                                    </Badge>
                                                </div>

                                                <div className="bg-white rounded-lg p-3 mb-3">
                                                    <p className="text-sm text-gray-500 mb-1">购买产品</p>
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <p className="font-medium text-gray-800">{order.product_name || "未知产品"}</p>
                                                            <p className="text-xs text-gray-400">编号: {order.product_code || "无"}</p>
                                                        </div>
                                                        <div className="text-right">
                                                            <p className="text-lg font-bold text-purple-600">¥{order.product_price?.toLocaleString() || order.amount?.toLocaleString() || 0}</p>
                                                            <p className="text-xs text-gray-400">{order.product_period || 0}天 · {order.product_period ? order.product_period * 24 : 0}小时 · 收益率{order.total_rate || 0}%</p>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between text-sm text-gray-500 mb-3">
                                                    <span>申请时间: {order.created_at ? new Date(order.created_at).toLocaleString() : "未知"}</span>
                                                    <span>订单号: {order.order_id?.slice(0, 8) || "未知"}...</span>
                                                </div>

                                                <div className="flex gap-2">
                                                    <Button
                                                        onClick={() => openBuyOrderConfirmDialog(order)}
                                                        className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white"
                                                    >
                                                        <CheckCircle className="w-4 h-4 mr-2" />确认收款
                                                    </Button>
                                                    <Button
                                                        onClick={() => openBuyOrderRejectDialog(order)}
                                                        variant="outline"
                                                        className="flex-1 border-red-200 text-red-600 hover:bg-red-50"
                                                    >
                                                        <XCircle className="w-4 h-4 mr-2" />拒绝
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* 已完成订单列表 */}
                        {completedBuyOrders.length > 0 && (
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <CheckCircle className="w-5 h-5 text-green-600" />
                                        已完成订单
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-2">
                                        {completedBuyOrders.slice(0, 5).map((order) => (
                                            <div key={order.order_id} className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-100">
                                                <div className="flex items-center gap-3">
                                                    <CheckCircle className="w-5 h-5 text-green-500" />
                                                    <div>
                                                        <p className="font-medium text-gray-800">{order.username || "未知用户"} {order.unique_id ? `(${order.unique_id})` : ''}</p>
                                                        <p className="text-xs text-gray-400">{order.product_name || "未知产品"} · {order.product_period || 0}天</p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-semibold text-green-600">¥{order.product_price?.toLocaleString() || order.amount?.toLocaleString() || 0}</p>
                                                    <p className="text-xs text-gray-400">{order.updated_at ? new Date(order.updated_at).toLocaleString() : ""}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </div>}
                    
                    {/* 能量充值Tab */}
                    {activeTab === "energy" && <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>能量值管理</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
                                    <p className="text-sm text-purple-800">
                                        <strong>说明：</strong>
                                        <br/>• 申请能量值：向分公司申请，审核通过后获得能量值
                                        <br/>• 能量值互转：同级服务商之间互转，不扣手续费
                                        <br/>• 给会员充值：线下收款后给会员充值
                                    </p>
                                </div>
                                
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="font-medium">我的能量值: <span className="text-purple-600 text-xl">{user?.energyValue?.toLocaleString() || 0}</span></h3>
                                    <div className="flex gap-2 flex-wrap">
                                        <Button onClick={() => { loadEnergyRequests(); setShowEnergyRequestDialog(true); }} variant="outline" className="border-orange-300 text-orange-600">
                                            <Plus className="w-4 h-4 mr-2" />向分公司申请
                                        </Button>
                                        <Button onClick={() => { loadTransferTargets(); setShowTransferDialog(true); }} variant="outline" className="border-purple-300 text-purple-600">
                                            <ArrowLeftRight className="w-4 h-4 mr-2" />能量值互转
                                        </Button>
                                        <Button onClick={() => { loadEnergyMembers(); setShowRechargeDialog(true); }} variant="outline" className="border-green-300 text-green-600">
                                            <Zap className="w-4 h-4 mr-2" />给会员充值
                                        </Button>

                                    </div>
                                </div>

                                {/* 能量值申请记录 */}
                                <div className="mb-6">
                                    <div className="flex items-center justify-between mb-3 mt-6">
                                        <h4 className="font-medium">能量值申请记录</h4>
                                        {energyRequests.length > 3 && (
                                            <Button 
                                                size="sm" 
                                                variant="ghost" 
                                                onClick={() => {
                                                    setShowEnergyRequestListDialog(true);
                                                }}
                                                className="text-orange-600 hover:text-orange-700"
                                            >
                                                查看全部 ({energyRequests.length})
                                            </Button>
                                        )}
                                    </div>
                                    {energyRequests.length > 0 ? (
                                        <div className="space-y-2">
                                            {energyRequests.slice(0, 3).map((record: any) => {
                                                const desc = typeof record.description === 'string' 
                                                    ? JSON.parse(record.description) 
                                                    : record;
                                                return (
                                                    <div key={record.id} className="flex justify-between items-center p-3 border rounded-lg bg-orange-50">
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <Badge variant="outline" className={`${
                                                                    desc.status === 'pending' ? 'text-yellow-600 border-yellow-300' :
                                                                    desc.status === 'completed' ? 'text-green-600 border-green-300' :
                                                                    'text-red-600 border-red-300'
                                                                }`}>
                                                                    {desc.status === 'pending' ? '待审核' : desc.status === 'completed' ? '已通过' : '已拒绝'}
                                                                </Badge>
                                                                <p className="font-medium">
                                                                    申请 {desc.requestedAmount?.toLocaleString() || 0} 能量值
                                                                </p>
                                                            </div>
                                                            <p className="text-xs text-gray-500 mt-1">
                                                                申请时间: {record.created_at ? new Date(record.created_at).toLocaleString() : '-'}
                                                            </p>
                                                            {desc.reviewerNote && (
                                                                <p className="text-xs text-gray-400 mt-1">
                                                                    审核备注: {desc.reviewerNote}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <p className="text-gray-500 text-center py-4">暂无申请记录</p>
                                    )}
                                </div>

                                {/* 会员充值申请 */}
                                <div className="mb-6">
                                    <div className="flex items-center justify-between mb-3 mt-6">
                                        <h4 className="font-medium flex items-center gap-2">
                                            <Zap className="w-4 h-4 text-green-600" />
                                            会员充值申请
                                            {memberRechargeRequests.filter(r => r.status === 'pending').length > 0 && (
                                                <Badge className="bg-green-500 text-white">{memberRechargeRequests.filter(r => r.status === 'pending').length}</Badge>
                                            )}
                                        </h4>
                                        {memberRechargeRequests.length > 0 && (
                                            <Button 
                                                size="sm" 
                                                variant="ghost" 
                                                onClick={() => loadMemberRechargeRequests()}
                                                className="text-green-600 hover:text-green-700"
                                            >
                                                刷新
                                            </Button>
                                        )}
                                    </div>
                                    {memberRechargeRequests.length > 0 ? (
                                        <div className="space-y-2">
                                            {memberRechargeRequests.filter(r => r.status === 'pending').slice(0, 5).map((request) => (
                                                <div key={request.id} className="flex justify-between items-center p-3 border rounded-lg bg-green-50 hover:bg-green-100 transition-colors">
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <Badge variant="outline" className="text-yellow-600 border-yellow-300">
                                                                待处理
                                                            </Badge>
                                                            <p className="font-medium">
                                                                会员: {request.memberName || '未知'}
                                                            </p>
                                                            <p className="text-green-600 font-bold">
                                                                +{request.amount} 能量值
                                                            </p>
                                                        </div>
                                                        <p className="text-xs text-gray-500 mt-1">
                                                            手机: {request.memberPhone || '未知'} | 
                                                            申请时间: {request.createdAt ? new Date(request.createdAt).toLocaleString() : '-'}
                                                        </p>
                                                        {request.note && (
                                                            <p className="text-xs text-gray-400 mt-1">
                                                                备注: {request.note}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <Button 
                                                            size="sm" 
                                                            className="bg-green-600 hover:bg-green-700"
                                                            onClick={() => {
                                                                setSelectedRechargeRequest(request);
                                                                setShowMemberRechargeDialog(true);
                                                            }}
                                                        >
                                                            处理
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                            {memberRechargeRequests.filter(r => r.status === 'pending').length === 0 && (
                                                <p className="text-gray-500 text-center py-4">暂无待处理的会员充值申请</p>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="text-center py-4 text-gray-500 bg-gray-50 rounded-lg">
                                            <Zap className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                                            <p>暂无会员充值申请</p>
                                            <p className="text-xs text-gray-400 mt-1">会员提交充值申请后会显示在这里</p>
                                        </div>
                                    )}
                                </div>

                                {/* 提现记录 */}
                                <h4 className="font-medium mb-3">提现记录</h4>
                                {withdrawRecords.length > 0 ? (
                                    <div className="space-y-2">
                                        {withdrawRecords.slice(0, 5).map((record: any) => (
                                            <div key={record.id} className="flex justify-between items-center p-3 border rounded-lg bg-gray-50">
                                                <div>
                                                    <p className="font-medium">收益提现 ¥{Number(record.amount || 0).toLocaleString()}</p>
                                                    <p className="text-xs text-gray-500">
                                                        实际到账: ¥{Number(record.actual_amount || 0).toLocaleString()} | 手续费: ¥{Number(record.fee || 0).toLocaleString()}
                                                    </p>
                                                </div>
                                                <Badge className={record.status === 'pending' ? 'bg-yellow-500' : record.status === 'approved' ? 'bg-blue-500' : record.status === 'transferred' ? 'bg-indigo-500' : record.status === 'completed' ? 'bg-green-500' : 'bg-red-500'}>
                                                    {record.status === 'pending' ? '待审核' : record.status === 'approved' ? '审核通过' : record.status === 'transferred' ? '已打款' : record.status === 'completed' ? '已完成' : '已拒绝'}
                                                </Badge>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-gray-500 text-center py-4">暂无提现记录</p>
                                )}

                                {/* 转账记录 */}
                                <h4 className="font-medium mb-3 mt-6">转账记录</h4>
                                <div className="flex gap-2 mb-4">
                                    <Button 
                                        size="sm" 
                                        variant={transferFilter === 'all' ? 'default' : 'outline'}
                                        className={transferFilter === 'all' ? 'bg-purple-600' : ''}
                                        onClick={() => { setTransferFilter('all'); loadTransferRecords(); }}
                                    >
                                        全部
                                    </Button>
                                    <Button 
                                        size="sm" 
                                        variant={transferFilter === 'transfer_out' ? 'default' : 'outline'}
                                        className={transferFilter === 'transfer_out' ? 'bg-red-600' : ''}
                                        onClick={() => { setTransferFilter('transfer_out'); loadTransferRecords(); }}
                                    >
                                        转出
                                    </Button>
                                    <Button 
                                        size="sm" 
                                        variant={transferFilter === 'transfer_in' ? 'default' : 'outline'}
                                        className={transferFilter === 'transfer_in' ? 'bg-green-600' : ''}
                                        onClick={() => { setTransferFilter('transfer_in'); loadTransferRecords(); }}
                                    >
                                        转入
                                    </Button>
                                </div>
                                {transferRecords.length > 0 ? (
                                    <div className="space-y-2">
                                        {transferRecords.map((record: any) => (
                                            <div key={record.id} className="flex justify-between items-center p-3 border rounded-lg bg-gray-50">
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        {record.type === 'transfer_out' ? (
                                                            <Badge variant="outline" className="text-red-600 border-red-300">转出</Badge>
                                                        ) : record.type === 'transfer_in' ? (
                                                            <Badge variant="outline" className="text-green-600 border-green-300">转入</Badge>
                                                        ) : (
                                                            <Badge variant="outline">{record.type}</Badge>
                                                        )}
                                                        <p className="font-medium">
                                                            {record.type === 'transfer_out' ? '-' : '+'}{Math.abs(record.amount)} 能量值
                                                        </p>
                                                    </div>
                                                    <p className="text-xs text-gray-500">
                                                        {record.note || (record.type === 'transfer_out' ? `转给用户` : `来自用户`)}
                                                    </p>
                                                    <p className="text-xs text-gray-400">{new Date(record.created_at).toLocaleString()}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-sm text-gray-500">余额: {record.energy_after?.toLocaleString() || 0}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-gray-500 text-center py-4">暂无转账记录</p>
                                )}

                                {/* 会员列表 */}
                                <h4 className="font-medium mb-3">我的会员列表</h4>
                                {(transferTargets.members?.length > 0 ? transferTargets.members : energyMembers).length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {(transferTargets.members?.length > 0 ? transferTargets.members : energyMembers).map((member: any) => (
                                            <div key={member.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <p className="font-medium">{member.username}</p>
                                                        <p className="text-sm text-gray-500">{member.phone || '未绑定手机'}</p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-lg font-bold text-purple-600">{member.energy_value?.toLocaleString() || 0}</p>
                                                        <p className="text-xs text-gray-400">能量值</p>
                                                    </div>
                                                </div>
                                                <Button 
                                                    size="sm" 
                                                    variant="outline" 
                                                    className="w-full mt-3 border-purple-300 text-purple-600"
                                                    onClick={() => {
                                                        setRechargeMemberId(member.id);
                                                        loadEnergyMembers();
                                                        setShowRechargeDialog(true);
                                                    }}>
                                                    充值
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-gray-500 text-center py-8">暂无下级会员</p>
                                )}
                            </CardContent>
                        </Card>
                        
                        {/* 能量值规则说明 */}
                        <Card className="bg-blue-50 border-blue-200">
                            <CardHeader>
                                <CardTitle className="text-blue-800">能量值消耗规则</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left">
                                            <th className="py-2">算力周期</th>
                                            <th className="py-2">能量值比例</th>
                                            <th className="py-2">示例（¥1000算力）</th>
                                        </tr>
                                    </thead>
                                    <tbody className="text-blue-700">
                                        <tr><td className="py-1">3天</td><td>3%</td><td>¥30</td></tr>
                                        <tr><td className="py-1">7天</td><td>5%</td><td>¥50</td></tr>
                                        <tr><td className="py-1">15天</td><td>10%</td><td>¥100</td></tr>
                                        <tr><td className="py-1">30天</td><td>22%</td><td>¥220</td></tr>
                                        <tr><td className="py-1">90天</td><td>60%</td><td>¥600</td></tr>
                                    </tbody>
                                </table>
                                <p className="text-xs text-blue-600 mt-3">
                                    会员购买算力时需要消耗相应能量值作为市场费，能量值不足无法购买。
                                </p>
                            </CardContent>
                        </Card>
                    </div>}
                    
                    {/* 流转审核 Tab */}
                    {activeTab === "transfers" && (
                        <div className="space-y-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <RefreshCw className="w-5 h-5" />
                                        流转审核管理
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        {/* 待审核流转 */}
                                        <div className="mb-6">
                                            <h4 className="font-medium mb-3 flex items-center gap-2">
                                                <AlertCircle className="w-4 h-4 text-orange-500" />
                                                待审核流转（{pendingTransfers.length}）
                                            </h4>
                                            {pendingTransfers.length > 0 ? (
                                                <div className="space-y-3">
                                                    {pendingTransfers.map((transfer: any) => (
                                                        <div key={transfer.id} className="border rounded-lg p-4 bg-orange-50">
                                                            <div className="flex justify-between items-start mb-3">
                                                                <div>
                                                                    <p className="font-medium">{transfer.product?.name || '算力流转'}</p>
                                                                    <p className="text-sm text-gray-500">流转价: ¥{transfer.transfer_price?.toLocaleString()}</p>
                                                                </div>
                                                                <Badge className="bg-orange-500">待审核</Badge>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                                                                <div className="text-gray-600">
                                                                    <span className="font-medium">卖家:</span> {transfer.from_user?.username || '未知'}
                                                                </div>
                                                                <div className="text-gray-600">
                                                                    <span className="font-medium">买家:</span> {transfer.to_user?.username || '未知'}
                                                                </div>
                                                            </div>
                                                            {transfer.payment_proof && (
                                                                <div className="text-sm text-blue-600 mb-3">
                                                                    凭证: {transfer.payment_proof}
                                                                </div>
                                                            )}
                                                            <div className="flex gap-2">
                                                                <Button 
                                                                    size="sm" 
                                                                    className="bg-green-600 hover:bg-green-700"
                                                                    onClick={() => handleTransferReview(transfer.id, 'approve')}
                                                                    disabled={submitting}
                                                                >
                                                                    <CheckCircle className="w-4 h-4 mr-1" /> 通过
                                                                </Button>
                                                                <Button 
                                                                    size="sm" 
                                                                    variant="destructive"
                                                                    onClick={() => handleTransferReview(transfer.id, 'reject')}
                                                                    disabled={submitting}
                                                                >
                                                                    <XCircle className="w-4 h-4 mr-1" /> 拒绝
                                                                </Button>
                                                                {transfer.expires_at && (
                                                                    <span className="text-sm text-gray-500 ml-auto self-center">
                                                                        过期时间: {new Date(transfer.expires_at).toLocaleString()}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-gray-500 text-center py-4">暂无待审核流转</p>
                                            )}
                                        </div>

                                        {/* 待回购算力 */}
                                        <div>
                                            <h4 className="font-medium mb-3 flex items-center gap-2">
                                                <Clock className="w-4 h-4 text-red-500" />
                                                待回购算力（{pendingRepurchases.length}）
                                            </h4>
                                            {pendingRepurchases.length > 0 ? (
                                                <div className="space-y-3">
                                                    {pendingRepurchases.map((item: any) => (
                                                        <div key={item.id} className="border rounded-lg p-4 bg-red-50">
                                                            <div className="flex justify-between items-start mb-3">
                                                                <div>
                                                                    <p className="font-medium">{item.product?.name || '算力'}</p>
                                                                    <p className="text-sm text-gray-500">流转价: ¥{item.transfer_price?.toLocaleString()}</p>
                                                                </div>
                                                                <Badge className="bg-red-500">已过期</Badge>
                                                            </div>
                                                            <div className="flex gap-2">
                                                                <Button 
                                                                    size="sm" 
                                                                    className="bg-blue-600 hover:bg-blue-700"
                                                                    onClick={() => handleRepurchase(item.id)}
                                                                    disabled={submitting}
                                                                >
                                                                    回购
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-gray-500 text-center py-4">暂无待回购算力</p>
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* 提现管理 Tab */}
                    {activeTab === "withdrawals" && (
                        <div className="space-y-6">
                            {/* 服务商自己提现 */}
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <DollarSign className="w-5 h-5" />
                                        我的提现
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm text-gray-500">收益余额</p>
                                                <p className="text-2xl font-bold text-green-600">¥{revenueStats.totalRevenue?.toLocaleString() || 0}</p>
                                            </div>
                                            <div className="flex gap-2">
                                                <Button
                                                    className="bg-green-600 hover:bg-green-700"
                                                    onClick={() => setShowConvertDialog(true)}
                                                >
                                                    <Zap className="w-4 h-4 mr-1" /> 收益转能量值
                                                </Button>
                                                <Button
                                                    className="bg-yellow-500 hover:bg-yellow-600 text-white"
                                                    onClick={() => setShowWithdrawDialog(true)}
                                                >
                                                    <DollarSign className="w-4 h-4 mr-1" /> 收益提现
                                                </Button>
                                            </div>
                                        </div>

                                        {/* 我的提现记录 */}
                                        <div className="mt-4">
                                            <h4 className="font-medium mb-3 flex items-center gap-2">
                                                <History className="w-4 h-4 text-gray-500" />
                                                我的提现记录
                                            </h4>
                                            <ProviderWithdrawRecords userId={user?.id || ''} authFetch={authFetch} />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* 待处理会员提现 */}
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <AlertCircle className="w-5 h-5 text-orange-500" />
                                        待处理提现申请（{pendingWithdrawals.length}）
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        {pendingWithdrawals.length > 0 ? (
                                            <div className="space-y-3">
                                                {pendingWithdrawals.map((withdrawal: any) => (
                                                    <div key={withdrawal.id} className="border rounded-lg p-4 bg-orange-50">
                                                        <div className="flex justify-between items-start mb-3">
                                                            <div>
                                                                <p className="font-medium">{withdrawal.user?.username || '用户'}</p>
                                                                <p className="text-sm text-gray-500">
                                                                    手机: {withdrawal.user?.phone || '未填写'}
                                                                </p>
                                                            </div>
                                                            <div className="text-right">
                                                                <p className="text-xl font-bold text-orange-600">¥{withdrawal.amount?.toLocaleString()}</p>
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                                                            <div className="text-gray-600">
                                                                <span className="font-medium">支付宝账号:</span> {withdrawal.alipay_account || '未填写'}
                                                            </div>
                                                            <div className="text-gray-600">
                                                                <span className="font-medium">真实姓名:</span> {withdrawal.real_name || '未填写'}
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <Button 
                                                                size="sm" 
                                                                className="bg-green-600 hover:bg-green-700"
                                                                onClick={() => handleWithdrawalConfirm(withdrawal.id, 'approve')}
                                                                disabled={submitting}
                                                            >
                                                                <CheckCircle className="w-4 h-4 mr-1" /> 已打款
                                                            </Button>
                                                            <Button 
                                                                size="sm" 
                                                                variant="destructive"
                                                                onClick={() => handleWithdrawalConfirm(withdrawal.id, 'reject')}
                                                                disabled={submitting}
                                                            >
                                                                <XCircle className="w-4 h-4 mr-1" /> 拒绝
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-gray-500 text-center py-4">暂无待处理提现</p>
                                        )}

                                        {/* 提现规则 */}
                                        <Card className="bg-blue-50 border-blue-200 mt-4">
                                            <CardHeader>
                                                <CardTitle className="text-blue-800 text-sm">提现说明</CardTitle>
                                            </CardHeader>
                                            <CardContent className="text-sm text-blue-700">
                                                <ul className="list-disc list-inside space-y-1">
                                                    <li>最低提现金额: ¥50</li>
                                                    <li>提现手续费: 5%（沉淀到总公司）</li>
                                                    <li>服务商提现到分公司，分公司审核后线下打款</li>
                                                    <li>收到提现申请后需线下打款给会员</li>
                                                </ul>
                                            </CardContent>
                                        </Card>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* 收益记录 Tab */}
                    {activeTab === "revenue" && (
                        <div className="space-y-6">
                            {/* 收益统计卡片 */}
                            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                                <Card className="bg-gradient-to-br from-green-500 to-emerald-600 text-white">
                                    <CardContent className="pt-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <TrendingUp className="w-5 h-5" />
                                            <span className="text-sm opacity-80">累计总收益</span>
                                        </div>
                                        <p className="text-2xl font-bold">{Number(revenueStats.totalRevenue || 0).toLocaleString()}</p>
                                        <p className="text-xs opacity-70 mt-1">{revenueStats.orderCount || 0} 笔记录</p>
                                    </CardContent>
                                </Card>
                                <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                                    <CardContent className="pt-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Zap className="w-5 h-5" />
                                            <span className="text-sm opacity-80">能量值收益</span>
                                        </div>
                                        <p className="text-2xl font-bold">{Number(revenueStats.energyRevenue || 0).toLocaleString()}</p>
                                        <p className="text-xs opacity-70 mt-1">会员市场费70%</p>
                                    </CardContent>
                                </Card>
                                <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
                                    <CardContent className="pt-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Wallet className="w-5 h-5" />
                                            <span className="text-sm opacity-80">提现到账</span>
                                        </div>
                                        <p className="text-2xl font-bold">{Number(revenueStats.withdrawRevenue || 0).toLocaleString()}</p>
                                        <p className="text-xs opacity-70 mt-1">已完成的提现</p>
                                    </CardContent>
                                </Card>
                                <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
                                    <CardContent className="pt-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Gift className="w-5 h-5" />
                                            <span className="text-sm opacity-80">会员充值</span>
                                        </div>
                                        <p className="text-2xl font-bold">{Number(revenueStats.rechargeRevenue || 0).toLocaleString()}</p>
                                        <p className="text-xs opacity-70 mt-1">给会员充值的金额</p>
                                    </CardContent>
                                </Card>
                                <Card className="bg-gradient-to-br from-rose-500 to-pink-600 text-white">
                                    <CardContent className="pt-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Users className="w-5 h-5" />
                                            <span className="text-sm opacity-80">下级分成</span>
                                        </div>
                                        <p className="text-2xl font-bold">{Number(revenueStats.subordinateRevenue || 0).toLocaleString()}</p>
                                        <p className="text-xs opacity-70 mt-1">0.3%~0.5%</p>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* 当前账户状态 */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Card>
                                    <CardContent className="pt-4">
                                        <div className="flex justify-between items-center">
                                            <div>
                                                <p className="text-sm text-muted-foreground">当前收益余额（可提现）</p>
                                                <p className="text-3xl font-bold text-green-600">¥{Number(revenueStats.balance || 0).toLocaleString()}</p>
                                            </div>
                                            <div className="flex gap-2">
                                                <Button
                                                    size="sm"
                                                    onClick={() => {
                                                        setWithdrawAmount("");
                                                        setShowWithdrawDialog(true);
                                                    }}
                                                >
                                                    <Wallet className="w-4 h-4 mr-1" />
                                                    收益提现
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => {
                                                        setWithdrawAmount("");
                                                        setShowWithdrawDialog(true);
                                                    }}
                                                >
                                                    <Zap className="w-4 h-4 mr-1" />
                                                    转能量值
                                                </Button>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="pt-4">
                                        <div className="flex justify-between items-center">
                                            <div>
                                                <p className="text-sm text-muted-foreground">当前能量值余额</p>
                                                <p className="text-3xl font-bold text-blue-600">{Number(revenueStats.energyValue || 0).toLocaleString()}</p>
                                                <p className="text-xs text-muted-foreground mt-1">用于给会员充值、购买产品付市场费等</p>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* 收益记录列表 */}
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <History className="w-5 h-5" />
                                        收益明细
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {revenueRecords.length > 0 ? (
                                        <div className="space-y-3">
                                            {revenueRecords.map((record: any) => {
                                                const sourceColorMap: Record<string, string> = {
                                                    energy_income: 'bg-blue-100 text-blue-700',
                                                    withdraw: 'bg-green-100 text-green-700',
                                                    recharge: 'bg-orange-100 text-orange-700',
                                                    distribution: 'bg-purple-100 text-purple-700',
                                                };
                                                const sourceIconMap: Record<string, string> = {
                                                    energy_income: '能量值收益',
                                                    withdraw: '提现到账',
                                                    recharge: '会员充值',
                                                    distribution: '产品分成',
                                                };
                                                return (
                                                    <div key={record.id} className="border rounded-lg p-4 bg-slate-50">
                                                        <div className="flex justify-between items-start">
                                                            <div>
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sourceColorMap[record.source] || 'bg-gray-100 text-gray-700'}`}>
                                                                        {record.source_label || sourceIconMap[record.source] || record.source}
                                                                    </span>
                                                                    {record.type === 'transfer_in' && record.from_username && (
                                                                        <span className="text-xs text-gray-500">来自: {record.from_username}</span>
                                                                    )}
                                                                    {record.type === 'recharge' && record.from_username && (
                                                                        <span className="text-xs text-gray-500">充值给: {record.from_username}</span>
                                                                    )}
                                                                </div>
                                                                {record.product_name && (
                                                                    <p className="font-medium">{record.product_name}</p>
                                                                )}
                                                                {record.member_name && (
                                                                    <p className="text-sm text-gray-500">
                                                                        会员: {record.member_name} {record.member_phone || ''}
                                                                    </p>
                                                                )}
                                                                <p className="text-xs text-gray-400 mt-1">
                                                                    {new Date(record.created_at).toLocaleString('zh-CN')}
                                                                </p>
                                                            </div>
                                                            <div className="text-right">
                                                                <p className={`text-xl font-bold ${record.source === 'withdraw' ? 'text-green-600' : 'text-blue-600'}`}>
                                                                    {record.source === 'withdraw' ? '+' : '+'}{Number(record.amount || 0).toLocaleString()}
                                                                </p>
                                                                {record.market_fee > 0 && (
                                                                    <p className="text-xs text-gray-500">
                                                                        市场费: {Number(record.market_fee).toLocaleString()}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="text-center py-8 text-gray-500">
                                            <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                            <p>暂无收益记录</p>
                                            <p className="text-sm mt-1">会员购买产品后，收益将在这里显示</p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* 积分 Tab */}
                    {activeTab === "points" && (
                        <div className="space-y-6">
                            <Card className="bg-gradient-to-br from-amber-500 to-orange-500 text-white">
                                <CardContent className="pt-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Gift className="w-5 h-5" />
                                        <span className="text-sm opacity-80">我的积分</span>
                                    </div>
                                    <p className="text-3xl font-bold">{Number(user?.points || 0).toLocaleString()}</p>
                                    <span className="text-xs opacity-70 mt-1">收益转能量值时，5%自动转为积分，积分可兑换产品或转能量值</span>
                                    <div className="mt-3 flex gap-2">
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => {
                                                setPointsConvertAmount("");
                                                setShowPointsToEnergyDialog(true);
                                            }}
                                        >
                                            <Zap className="w-4 h-4 mr-1" />
                                            积分转能量值
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* 积分统计 */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <Card>
                                    <CardContent className="pt-4 text-center">
                                        <Gift className="w-6 h-6 mx-auto mb-2 text-amber-500" />
                                        <p className="text-sm text-muted-foreground">累计获得积分</p>
                                        <p className="text-xl font-bold text-amber-600">{Number(pointsStats.total_convert || 0).toLocaleString()}</p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="pt-4 text-center">
                                        <ArrowUpDown className="w-6 h-6 mx-auto mb-2 text-blue-500" />
                                        <p className="text-sm text-muted-foreground">已兑换/转出</p>
                                        <p className="text-xl font-bold text-blue-600">{Number(pointsStats.total_exchange || 0).toLocaleString()}</p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="pt-4 text-center">
                                        <Wallet className="w-6 h-6 mx-auto mb-2 text-green-500" />
                                        <p className="text-sm text-muted-foreground">可用积分</p>
                                        <p className="text-xl font-bold text-green-600">{Number(pointsStats.available_points || user?.points || 0).toLocaleString()}</p>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* 积分记录 */}
                            <Card>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <History className="w-5 h-5" />
                                        积分记录
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {pointsRecords.length > 0 ? (
                                        <div className="space-y-3">
                                            {pointsRecords.map((record: any) => (
                                                <div key={record.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`p-2 rounded-full ${record.type === 'convert' ? 'bg-amber-100' : 'bg-blue-100'}`}>
                                                            <Gift className={`w-4 h-4 ${record.type === 'convert' ? 'text-amber-500' : 'text-blue-500'}`} />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <span className={`font-medium ${record.type === 'convert' ? 'text-amber-600' : 'text-blue-600'}`}>
                                                                    {record.type === 'convert' ? '+' : '-'}{Number(record.amount).toLocaleString()}
                                                                </span>
                                                                <Badge variant={record.type === 'convert' ? 'default' : 'secondary'} className="text-xs">
                                                                    {record.type === 'convert' ? '收益转化' : record.type === 'exchange' ? '兑换使用' : record.type}
                                                                </Badge>
                                                            </div>
                                                            <p className="text-xs text-muted-foreground">{record.note || '收益转能量值产生'}</p>
                                                        </div>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">
                                                        {new Date(record.created_at).toLocaleString('zh-CN')}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-center py-8 text-gray-500">
                                            <Gift className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                            <p>暂无积分记录</p>
                                            <p className="text-sm mt-1">收益转能量值时自动产生积分（5%）</p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* 能量值充值对话框 */}
                    <Dialog open={showRechargeDialog} onOpenChange={setShowRechargeDialog}>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>给会员充值能量值</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div>
                                    <label className="text-sm font-medium mb-2 block">选择会员</label>
                                    <select
                                        className="w-full p-2 border rounded-md bg-white"
                                        value={rechargeMemberId}
                                        onChange={(e) => setRechargeMemberId(e.target.value)}
                                    >
                                        <option value="">请选择会员</option>
                                        {energyMembers.map(m => (
                                            <option key={m.id} value={m.id}>
                                                {m.username}（当前能量值: {m.energy_value || 0}）
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">充值金额</label>
                                    <Input
                                        type="number"
                                        placeholder="请输入充值能量值"
                                        value={rechargeAmount}
                                        onChange={(e) => setRechargeAmount(e.target.value)}
                                        min="1"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        您当前能量值: {user?.energyValue?.toLocaleString() || 0}
                                    </p>
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">备注（可选）</label>
                                    <Input
                                        placeholder="如: 线下收款500元"
                                        value={rechargeNote}
                                        onChange={(e) => setRechargeNote(e.target.value)}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setShowRechargeDialog(false)}>
                                    取消
                                </Button>
                                <Button
                                    className="bg-purple-600"
                                    onClick={handleRechargeEnergy}
                                    disabled={submitting || !rechargeMemberId || !rechargeAmount}
                                >
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
                                    确认充值
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* 处理会员充值申请对话框 */}
                    <Dialog open={showMemberRechargeDialog} onOpenChange={(open) => {
                        setShowMemberRechargeDialog(open);
                        if (!open) setSelectedRechargeRequest(null);
                    }}>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <Zap className="w-5 h-5 text-green-600" />
                                    处理会员充值申请
                                </DialogTitle>
                            </DialogHeader>
                            {selectedRechargeRequest && (
                                <div className="space-y-4 py-4">
                                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-sm text-gray-500">会员名称</p>
                                                <p className="font-medium">{selectedRechargeRequest.memberName || '未知'}</p>
                                            </div>
                                            <div>
                                                <p className="text-sm text-gray-500">会员手机</p>
                                                <p className="font-medium">{selectedRechargeRequest.memberPhone || '未知'}</p>
                                            </div>
                                            <div>
                                                <p className="text-sm text-gray-500">充值金额</p>
                                                <p className="font-medium text-green-600">+{selectedRechargeRequest.amount} 能量值</p>
                                            </div>
                                            <div>
                                                <p className="text-sm text-gray-500">申请时间</p>
                                                <p className="font-medium">{selectedRechargeRequest.createdAt ? new Date(selectedRechargeRequest.createdAt).toLocaleString() : '未知'}</p>
                                            </div>
                                        </div>
                                        {selectedRechargeRequest.note && (
                                            <div className="mt-3 pt-3 border-t border-green-200">
                                                <p className="text-sm text-gray-500">备注</p>
                                                <p className="font-medium">{selectedRechargeRequest.note}</p>
                                            </div>
                                        )}
                                    </div>
                                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                                        <p className="text-sm text-yellow-700">
                                            <strong>提示：</strong>请确认已收到会员线下付款后再点击"确认充值"。确认后，能量值将直接充入会员账户。
                                        </p>
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium mb-2 block">您的当前能量值</label>
                                        <p className="text-lg font-bold text-purple-600">{user?.energyValue?.toLocaleString() || 0} 能量值</p>
                                        {user && user.energyValue < selectedRechargeRequest.amount && (
                                            <p className="text-sm text-red-500 mt-1">能量值不足，无法完成充值</p>
                                        )}
                                    </div>
                                </div>
                            )}
                            <DialogFooter>
                                <Button 
                                    variant="destructive"
                                    onClick={() => handleMemberRechargeAction(selectedRechargeRequest?.id, 'reject')}
                                    disabled={submitting}
                                >
                                    <XCircle className="w-4 h-4 mr-2" />
                                    拒绝
                                </Button>
                                <Button 
                                    className="bg-green-600 hover:bg-green-700"
                                    onClick={() => handleMemberRechargeAction(selectedRechargeRequest?.id, 'approve')}
                                    disabled={submitting || !!(user && user.energyValue < selectedRechargeRequest?.amount)}
                                >
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                                    确认充值
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* 能量值互转对话框 */}
                    <Dialog open={showTransferDialog} onOpenChange={setShowTransferDialog}>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <ArrowLeftRight className="w-5 h-5 text-purple-600" />
                                    能量值互转
                                </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                    <p className="text-sm text-blue-700">
                                        <strong>说明：</strong>可向所属分公司、其他服务商或自己的会员转账能量值，最低转账金额为50。
                                    </p>
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">转账类型</label>
                                    <div className="flex gap-2">
                                        <Button 
                                            size="sm" 
                                            variant={transferUserType === "branch" ? "default" : "outline"}
                                            className={transferUserType === "branch" ? "bg-purple-600" : ""}
                                            onClick={() => { setTransferUserType("branch"); setTransferUserId(""); }}
                                            disabled={!transferTargets.branch}
                                        >
                                            分公司 {transferTargets.branch ? "" : "(无)"}
                                        </Button>
                                        <Button 
                                            size="sm" 
                                            variant={transferUserType === "provider" ? "default" : "outline"}
                                            className={transferUserType === "provider" ? "bg-purple-600" : ""}
                                            onClick={() => { setTransferUserType("provider"); setTransferUserId(""); }}
                                        >
                                            其他服务商
                                        </Button>
                                        <Button 
                                            size="sm" 
                                            variant={transferUserType === "member" ? "default" : "outline"}
                                            className={transferUserType === "member" ? "bg-purple-600" : ""}
                                            onClick={() => { setTransferUserType("member"); setTransferUserId(""); }}
                                        >
                                            我的会员
                                        </Button>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">选择{transferUserType === "branch" ? "分公司" : transferUserType === "provider" ? "服务商" : "会员"}</label>
                                    <select
                                        className="w-full p-2 border rounded-md bg-white"
                                        value={transferUserId}
                                        onChange={(e) => setTransferUserId(e.target.value)}
                                    >
                                        <option value="">请选择</option>
                                        {transferUserType === "branch" && transferTargets.branch && (
                                            <option value={transferTargets.branch.id}>
                                                {transferTargets.branch.username} {transferTargets.branch.unique_id ? `[${transferTargets.branch.unique_id}]` : ''} {transferTargets.branch.phone ? `(${transferTargets.branch.phone})` : ''}（能量值: {transferTargets.branch.energy_value || 0}）
                                            </option>
                                        )}
                                        {transferUserType === "provider" && transferTargets.providers?.map((p: any) => (
                                            <option key={p.id} value={p.id}>
                                                {p.username} {p.unique_id ? `[${p.unique_id}]` : ''} {p.phone ? `(${p.phone})` : ''}（能量值: {p.energy_value || 0}）
                                            </option>
                                        ))}
                                        {transferUserType === "member" && transferTargets.members?.map((m: any) => (
                                            <option key={m.id} value={m.id}>
                                                {m.username} {m.unique_id ? `[${m.unique_id}]` : ''} {m.phone ? `(${m.phone})` : ''}（能量值: {m.energy_value || 0}）
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">转账金额</label>
                                    <Input
                                        type="number"
                                        placeholder="请输入转账能量值（最低50）"
                                        value={transferAmount}
                                        onChange={(e) => setTransferAmount(e.target.value)}
                                        min="50"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        您当前能量值: {user?.energyValue?.toLocaleString() || 0}
                                    </p>
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">备注（可选）</label>
                                    <Input
                                        placeholder="如: 业务合作转账"
                                        value={transferNote}
                                        onChange={(e) => setTransferNote(e.target.value)}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setShowTransferDialog(false)}>
                                    取消
                                </Button>
                                <Button 
                                    className="bg-purple-600" 
                                    onClick={handleTransferEnergy}
                                    disabled={submitting || !transferUserId || !transferAmount}
                                >
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ArrowLeftRight className="w-4 h-4 mr-2" />}
                                    确认转账
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* 收益转能量值对话框 */}
                    <Dialog open={showConvertDialog} onOpenChange={setShowConvertDialog}>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <Zap className="w-5 h-5 text-green-600" />
                                    收益转能量值
                                </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                                    <p className="text-sm text-green-700">
                                        <strong>说明：</strong>收益转为能量值时，5%转为积分，95%转为能量值。能量值可用于给会员充值。
                                    </p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-slate-100 rounded-lg p-3">
                                        <p className="text-xs text-gray-500">收益余额</p>
                                        <p className="text-xl font-bold text-green-600">¥{revenueStats.totalRevenue?.toLocaleString() || 0}</p>
                                    </div>
                                    <div className="bg-slate-100 rounded-lg p-3">
                                        <p className="text-xs text-gray-500">当前能量值</p>
                                        <p className="text-xl font-bold text-purple-600">{user?.energyValue?.toLocaleString() || 0}</p>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">转换金额</label>
                                    <Input
                                        type="number"
                                        placeholder="请输入要转换的收益金额"
                                        value={withdrawAmount}
                                        onChange={(e) => setWithdrawAmount(e.target.value)}
                                        min="1"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        积分: {withdrawAmount ? (parseFloat(withdrawAmount) * 0.05).toFixed(2) : "0.00"} | 能量值: {withdrawAmount ? (parseFloat(withdrawAmount) * 0.95).toFixed(2) : "0.00"}
                                    </p>
                                </div>
                                <Button 
                                    className="w-full bg-green-600 hover:bg-green-700" 
                                    onClick={async () => {
                                        if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) return;
                                        
                                        setSubmitting(true);
                                        try {
                                            const res = await authFetch("/api/provider/convert-to-energy", {
                                                method: "POST",
                                                headers: { "Content-Type": "application/json" },
                                                body: JSON.stringify({ amount: withdrawAmount }),
                                            });
                                            const data = await res.json();
                                            if (data.success) {
                                                showMessage("success", `转换成功！${data.data?.pointsAmount || 0}→积分，${data.data?.energyAmount || 0}→能量值`);
                                                setShowConvertDialog(false);
                                                setWithdrawAmount("");
                                                loadRevenueRecords();
                                                loadData();
                                            } else {
                                                showMessage("error", data.error || "转换失败");
                                            }
                                        } catch (err) {
                                            showMessage("error", "转换失败");
                                        } finally {
                                            setSubmitting(false);
                                        }
                                    }}
                                    disabled={submitting || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
                                >
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
                                    确认转换
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>

                    {/* 收益提现对话框 */}
                    <Dialog open={showWithdrawDialog} onOpenChange={setShowWithdrawDialog}>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <DollarSign className="w-5 h-5 text-yellow-600" />
                                    收益提现
                                </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                                    <p className="text-sm text-yellow-700">
                                        <strong>说明：</strong>收益提现到分公司，手续费5%，最低提现金额50元。提现后等待分公司审核打款。
                                    </p>
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">我的收益余额</label>
                                    <p className="text-2xl font-bold text-green-600">¥{revenueStats.totalRevenue?.toLocaleString() || 0}</p>
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">提现金额</label>
                                    <Input
                                        type="number"
                                        placeholder="请输入提现金额（最低50）"
                                        value={withdrawAmount}
                                        onChange={(e) => setWithdrawAmount(e.target.value)}
                                        min="50"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        手续费5%: {withdrawAmount ? (parseFloat(withdrawAmount) * 0.05).toFixed(2) : "0.00"} 元 | 实际到账: {withdrawAmount ? (parseFloat(withdrawAmount) * 0.95).toFixed(2) : "0.00"} 元
                                    </p>
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">支付宝账号</label>
                                    <Input
                                        placeholder="请输入支付宝账号"
                                        value={withdrawAlipay}
                                        onChange={(e) => setWithdrawAlipay(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">支付宝姓名</label>
                                    <Input
                                        placeholder="请输入支付宝实名姓名"
                                        value={withdrawAlipayName}
                                        onChange={(e) => setWithdrawAlipayName(e.target.value)}
                                    />
                                </div>
                                <Button 
                                    className="w-full bg-yellow-500 hover:bg-yellow-600" 
                                    onClick={async () => {
                                        const amount = parseFloat(withdrawAmount);
                                        if (!amount || amount < 50) {
                                            showMessage("error", "最低提现金额为50元");
                                            return;
                                        }
                                        if (!withdrawAlipay.trim()) {
                                            showMessage("error", "请输入支付宝账号");
                                            return;
                                        }
                                        if (!withdrawAlipayName.trim()) {
                                            showMessage("error", "请输入支付宝姓名");
                                            return;
                                        }
                                        setSubmitting(true);
                                        try {
                                            const res = await authFetch("/api/provider/withdraw", {
                                                method: "POST",
                                                headers: { "Content-Type": "application/json" },
                                                body: JSON.stringify({
                                                    amount: withdrawAmount,
                                                    alipayAccount: withdrawAlipay.trim(),
                                                    realName: withdrawAlipayName.trim(),
                                                }),
                                            });
                                            const data = await res.json();
                                            if (data.success) {
                                                showMessage("success", `提现申请已提交！手续费${data.data?.fee || 0}元，实际到账${data.data?.actualAmount || 0}元，等待分公司审核`);
                                                setShowWithdrawDialog(false);
                                                setWithdrawAmount("");
                                                setWithdrawAlipay("");
                                                setWithdrawAlipayName("");
                                                loadData();
                                            } else {
                                                showMessage("error", data.error || "提现失败");
                                            }
                                        } catch (err) {
                                            showMessage("error", "提现失败");
                                        } finally {
                                            setSubmitting(false);
                                        }
                                    }}
                                    disabled={submitting || !withdrawAmount || parseFloat(withdrawAmount) < 50}
                                >
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <DollarSign className="w-4 h-4 mr-2" />}
                                    确认提现
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>

                    {/* 能量值申请对话框 */}
                    <Dialog open={showEnergyRequestDialog} onOpenChange={setShowEnergyRequestDialog}>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <Zap className="w-5 h-5 text-orange-600" />
                                    申请能量值
                                </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                                    <p className="text-sm text-orange-700">
                                        <strong>说明：</strong>服务商需要向分公司申请能量值，用于给会员充值。
                                        申请提交后需等待分公司审核通过。
                                    </p>
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">申请数量</label>
                                    <Input
                                        type="number"
                                        placeholder="请输入申请的能量值数量"
                                        value={energyRequestAmount}
                                        onChange={(e) => setEnergyRequestAmount(e.target.value)}
                                        min="100"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">备注（可选）</label>
                                    <Input
                                        placeholder="如: 会员充值需要"
                                        value={energyRequestNote}
                                        onChange={(e) => setEnergyRequestNote(e.target.value)}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setShowEnergyRequestDialog(false)}>
                                    取消
                                </Button>
                                <Button 
                                    className="bg-orange-500 hover:bg-orange-600" 
                                    onClick={handleEnergyRequest}
                                    disabled={submitting || !energyRequestAmount || parseFloat(energyRequestAmount) < 100}
                                >
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
                                    提交申请
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* 能量值申请记录完整列表对话框 */}
                    <Dialog open={showEnergyRequestListDialog} onOpenChange={setShowEnergyRequestListDialog}>
                        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <Zap className="w-5 h-5 text-orange-600" />
                                    能量值申请记录
                                </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-3 py-4">
                                {energyRequests.length > 0 ? (
                                    <div className="space-y-3">
                                        {energyRequests.map((record: any) => {
                                            const desc = typeof record.description === 'string' 
                                                ? JSON.parse(record.description) 
                                                : record;
                                            return (
                                                <div key={record.id} className="border rounded-lg p-4 bg-orange-50">
                                                    <div className="flex justify-between items-start mb-3">
                                                        <div>
                                                            <div className="flex items-center gap-2 mb-2">
                                                                <Badge variant="outline" className={`${
                                                                    desc.status === 'pending' ? 'text-yellow-600 border-yellow-300' :
                                                                    desc.status === 'completed' ? 'text-green-600 border-green-300' :
                                                                    'text-red-600 border-red-300'
                                                                }`}>
                                                                    {desc.status === 'pending' ? '待审核' : desc.status === 'completed' ? '已通过' : '已拒绝'}
                                                                </Badge>
                                                                <p className="font-medium text-lg">
                                                                    申请 {desc.requestedAmount?.toLocaleString() || 0} 能量值
                                                                </p>
                                                            </div>
                                                            <div className="text-sm text-gray-600 space-y-1">
                                                                <p>申请时间: {record.created_at ? new Date(record.created_at).toLocaleString() : '-'}</p>
                                                                {desc.note && (
                                                                    <p>申请备注: {desc.note}</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            {desc.status === 'completed' && (
                                                                <div className="text-green-600">
                                                                    <CheckCircle className="w-6 h-6" />
                                                                    <p className="text-sm mt-1">已发放</p>
                                                                </div>
                                                            )}
                                                            {desc.status === 'pending' && (
                                                                <div className="text-yellow-600">
                                                                    <Clock className="w-6 h-6" />
                                                                    <p className="text-sm mt-1">审核中</p>
                                                                </div>
                                                            )}
                                                            {desc.status === 'rejected' && (
                                                                <div className="text-red-600">
                                                                    <XCircle className="w-6 h-6" />
                                                                    <p className="text-sm mt-1">已拒绝</p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {desc.reviewedAt && (
                                                        <div className="border-t pt-3 mt-3 text-sm text-gray-600">
                                                            <p>审核时间: {new Date(desc.reviewedAt).toLocaleString()}</p>
                                                            {desc.reviewerNote && (
                                                                <p>审核备注: {desc.reviewerNote}</p>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-center py-8 text-gray-500">
                                        <Zap className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                        <p>暂无申请记录</p>
                                    </div>
                                )}
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setShowEnergyRequestListDialog(false)}>
                                    关闭
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* 额度申请对话框 */}
                    <Dialog open={showQuotaRequestDialog} onOpenChange={setShowQuotaRequestDialog}>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <Database className="w-5 h-5 text-purple-600" />
                                    申请额度
                                </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                                    <p className="text-sm text-orange-700">
                                        <strong>说明：</strong>服务商初始额度为0，需要向分公司申请额度后才能生成算力产品。
                                    </p>
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">申请金额</label>
                                    <Input
                                        type="number"
                                        placeholder="请输入申请额度"
                                        value={quotaRequestAmount}
                                        onChange={(e) => setQuotaRequestAmount(e.target.value)}
                                        min="1"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">备注（可选）</label>
                                    <Input
                                        placeholder="如: 业务扩展需要"
                                        value={quotaRequestNote}
                                        onChange={(e) => setQuotaRequestNote(e.target.value)}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setShowQuotaRequestDialog(false)}>
                                    取消
                                </Button>
                                <Button 
                                    className="bg-purple-600" 
                                    onClick={handleQuotaRequest}
                                    disabled={submitting || !quotaRequestAmount}
                                >
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Database className="w-4 h-4 mr-2" />}
                                    提交申请
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* 自定义额度生成产品对话框 */}
                    <Dialog open={showQuotaGenerateDialog} onOpenChange={setShowQuotaGenerateDialog}>
                        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <Zap className="w-5 h-5 text-purple-600" />
                                    自定义生成算力产品
                                </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-6 py-4">
                                {/* 可用额度信息 */}
                                <div className="bg-gradient-to-r from-purple-50 to-fuchsia-50 rounded-xl p-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm text-gray-500">当前可用额度</p>
                                            <p className="text-2xl font-bold text-purple-600">¥{(stats.available_quota || 0).toLocaleString()}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm text-gray-500">可生成产品</p>
                                            <p className="text-lg font-semibold text-fuchsia-600">{Math.floor((stats.available_quota || 0) / 10000) * 4} 个</p>
                                        </div>
                                    </div>
                                </div>

                                {/* 额度输入 */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-700">
                                        输入要使用的额度（万元）
                                    </label>
                                    <div className="flex gap-3">
                                        <Input
                                            type="number"
                                            placeholder="请输入额度，如：1、2、5"
                                            value={generateQuotaAmount}
                                            onChange={(e) => {
                                                setGenerateQuotaAmount(e.target.value);
                                                setGeneratePreview(null);
                                            }}
                                            min={1}
                                            max={Math.floor((stats.available_quota || 0) / 10000)}
                                            className="text-lg"
                                        />
                                        <Button
                                            onClick={fetchGeneratePreview}
                                            disabled={loadingPreview || !generateQuotaAmount || parseInt(generateQuotaAmount) < 1}
                                            className="bg-purple-600"
                                        >
                                            {loadingPreview ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                "预览"
                                            )}
                                        </Button>
                                    </div>
                                    <p className="text-xs text-gray-400">最低额度1万元，1万元可生成4个产品</p>
                                </div>

                                {/* 预览结果 */}
                                {generatePreview && (
                                    <div className="space-y-4">
                                        <div className="border-t pt-4">
                                            <h4 className="font-semibold text-gray-800 mb-3">生成预览</h4>
                                            
                                            {/* 统计卡片 */}
                                            <div className="grid grid-cols-3 gap-3 mb-4">
                                                <div className="bg-blue-50 rounded-lg p-3 text-center">
                                                    <p className="text-sm text-blue-600">使用额度</p>
                                                    <p className="text-xl font-bold text-blue-700">¥{generatePreview.usedQuota?.toLocaleString()}</p>
                                                </div>
                                                <div className="bg-green-50 rounded-lg p-3 text-center">
                                                    <p className="text-sm text-green-600">生成产品</p>
                                                    <p className="text-xl font-bold text-green-700">{generatePreview.stats?.total} 个</p>
                                                </div>
                                                <div className="bg-orange-50 rounded-lg p-3 text-center">
                                                    <p className="text-sm text-orange-600">剩余额度</p>
                                                    <p className="text-xl font-bold text-orange-700">¥{generatePreview.remainingQuota?.toLocaleString()}</p>
                                                </div>
                                            </div>

                                            {/* 产品列表 */}
                                            <div className="space-y-2">
                                                <p className="text-sm font-medium text-gray-700">产品明细：</p>
                                                {generatePreview.products?.map((product: any, index: number) => (
                                                    <div key={index} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2">
                                                        <div className="flex items-center gap-3">
                                                            <Badge variant="outline" className={product.period === 3 ? "text-orange-600 border-orange-300" : "text-red-600 border-red-300"}>
                                                                {product.period}天({product.period * 24}小时)
                                                            </Badge>
                                                            <span className="text-sm text-gray-600">{product.name}</span>
                                                        </div>
                                                        <span className="font-semibold text-gray-800">¥{product.price.toLocaleString()}</span>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* 说明 */}
                                            <div className="mt-4 p-3 bg-amber-50 rounded-lg text-sm text-amber-800">
                                                <p className="font-medium mb-1">生成说明：</p>
                                                <ul className="list-disc list-inside space-y-1 text-amber-700">
                                                    <li>3天产品：总收益5%，会员到手2%，能量值3%</li>
                                                    <li>7天产品：总收益10%，会员到手5%，能量值5%</li>
                                                    <li>生成后产品自动上架，可立即销售</li>
                                                </ul>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setShowQuotaGenerateDialog(false)}>
                                    取消
                                </Button>
                                <Button
                                    className="bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-700 hover:to-fuchsia-700"
                                    onClick={handleGenerateWithQuota}
                                    disabled={submitting || !generatePreview}
                                >
                                    {submitting ? (
                                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                    ) : (
                                        <Zap className="w-4 h-4 mr-2" />
                                    )}
                                    确认生成 {generatePreview?.stats?.total || 0} 个产品
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* 购买订单确认/拒绝对话框 */}
                    <Dialog open={showBuyOrderDialog} onOpenChange={setShowBuyOrderDialog}>
                        <DialogContent className="max-w-md">
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    {buyOrderAction === "confirm" ? (
                                        <>
                                            <CheckCircle className="w-5 h-5 text-green-600" />
                                            确认收款
                                        </>
                                    ) : (
                                        <>
                                            <XCircle className="w-5 h-5 text-red-600" />
                                            拒绝订单
                                        </>
                                    )}
                                </DialogTitle>
                            </DialogHeader>
                            
                            {selectedBuyOrder && (
                                <div className="space-y-4 py-4">
                                    {/* 订单信息 */}
                                    <div className="bg-gray-50 rounded-xl p-4">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm text-gray-500">会员</span>
                                            <span className="font-medium">{selectedBuyOrder.username || "未知用户"} {selectedBuyOrder.unique_id ? `(${selectedBuyOrder.unique_id})` : ''}</span>
                                        </div>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm text-gray-500">手机号</span>
                                            <span className="font-medium">{selectedBuyOrder.phone || "未提供"}</span>
                                        </div>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm text-gray-500">产品</span>
                                            <span className="font-medium">{selectedBuyOrder.product_name || "未知产品"}</span>
                                        </div>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm text-gray-500">编号</span>
                                            <span className="font-medium text-gray-600">{selectedBuyOrder.product_code || "无"}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-gray-500">金额</span>
                                            <span className="text-lg font-bold text-purple-600">¥{selectedBuyOrder.product_price?.toLocaleString() || selectedBuyOrder.amount?.toLocaleString() || 0}</span>
                                        </div>
                                    </div>

                                    {buyOrderAction === "confirm" ? (
                                        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                                            <p className="text-sm text-green-800">
                                                <strong>确认后请确保：</strong>
                                            </p>
                                            <ul className="text-xs text-green-700 mt-2 space-y-1 list-disc list-inside">
                                                <li>会员已线下完成付款</li>
                                                <li>确认后产品将分配给该会员</li>
                                                <li>系统将自动扣除额度并创建持仓记录</li>
                                            </ul>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-gray-700">拒绝原因（选填）</label>
                                            <Textarea
                                                value={rejectReason}
                                                onChange={(e) => setRejectReason(e.target.value)}
                                                placeholder="请输入拒绝原因..."
                                                rows={3}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}

                            <DialogFooter>
                                <Button variant="outline" onClick={() => setShowBuyOrderDialog(false)}>
                                    取消
                                </Button>
                                {buyOrderAction === "confirm" ? (
                                    <Button
                                        className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700"
                                        onClick={handleBuyOrderAction}
                                        disabled={submitting}
                                    >
                                        {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                                        确认收款
                                    </Button>
                                ) : (
                                    <Button
                                        variant="destructive"
                                        onClick={handleBuyOrderAction}
                                        disabled={submitting}
                                    >
                                        {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <XCircle className="w-4 h-4 mr-2" />}
                                        确认拒绝
                                    </Button>
                                )}
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* 积分转能量值对话框 */}
                    <Dialog open={showPointsToEnergyDialog} onOpenChange={setShowPointsToEnergyDialog}>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <Zap className="w-5 h-5 text-amber-500" />
                                    积分转能量值
                                </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                                    <div className="flex justify-between items-center">
                                        <span className="text-sm text-amber-700">当前积分</span>
                                        <span className="text-lg font-bold text-amber-600">{Number(user?.points || 0).toLocaleString()}</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">转换积分数量</label>
                                    <Input
                                        type="number"
                                        placeholder="请输入要转换的积分数量"
                                        value={pointsConvertAmount}
                                        onChange={(e) => setPointsConvertAmount(e.target.value)}
                                        min="1"
                                        max={String(user?.points || 0)}
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        1积分 = 1能量值，转换后积分扣除，能量值等额增加
                                    </p>
                                </div>
                                {pointsConvertAmount && parseFloat(pointsConvertAmount) > 0 && (
                                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                                        <p className="text-sm text-green-700">
                                            转换后：积分 <strong>-{pointsConvertAmount}</strong>，能量值 <strong>+{pointsConvertAmount}</strong>
                                        </p>
                                    </div>
                                )}
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setShowPointsToEnergyDialog(false)}>
                                    取消
                                </Button>
                                <Button
                                    className="bg-amber-500 hover:bg-amber-600"
                                    onClick={handlePointsToEnergy}
                                    disabled={submitting || !pointsConvertAmount || parseFloat(pointsConvertAmount) <= 0 || parseFloat(pointsConvertAmount) > (user?.points || 0)}
                                >
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
                                    确认转换
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </main>
        </div>
    );
}