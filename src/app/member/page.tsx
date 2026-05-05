"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

import {
    Cpu,
    Zap,
    TrendingUp,
    TrendingDown,
    Star,
    Coins,
    Wallet,
    ArrowRight,
    Server,
    Gift,
    Users,
    Loader2,
    Bell,
    Package,
    ShoppingCart,
    Clock,
    CheckCircle,
    AlertCircle,
    Copy,
    Share2,
    Award,
    UserPlus,
    Link,
    LinkIcon,
    History,
    ArrowUpCircle,
    ArrowDownCircle,
    Filter,
    FileText,
    User,
    Upload,
    Network,
    Lock,
    Eye,
    EyeOff,
    Banknote,
    ArrowRightLeft,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";

interface Product {
    id: string;
    name: string;
    code: string;
    price: number;
    period: number;
    total_rate: number;
    market_rate: number;
    profit_rate: number;
    market_fee?: number;
    status: string;
    provider_id?: string;
    image_url?: string;
}

interface UserProduct {
    id: string;
    product_id: string;
    purchase_price: number;
    expected_profit: number;
    market_fee: number;
    status: string;
    purchase_date: string;
    expire_date: string;
    products?: {
        name: string;
        code: string;
        period: number;
    };
}

interface PendingOrder {
    orderId: string;
    orderStatus: string;
    orderCreatedAt: string;
    productId: string;
    productName: string;
    productPrice: number;
    productPeriod: number;
    totalRate: number;
    profitRate: number;
}

interface Notification {
    id: string;
    type: string;
    title: string;
    content: string;
    amount: number;
    is_read?: boolean;
    created_at: string;
}

interface Stats {
    energy_value: number;
    balance: number;
    points: number;
    total_holding: number;
    total_profit: number;
    available_profit: number;
    product_count: number;
}

export default function MemberPage() {
    const {
        user,
        loading: authLoading,
        logout,
        setUser,
        refreshUser,
    } = useAuth("member");

    // 统一认证 fetch
    const authFetch = async (url: string, options: RequestInit = {}) => {
        const token = localStorage.getItem('token');
        const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return fetch(url, { ...options, headers });
    };

    const [stats, setStats] = useState<Stats>({
        energy_value: 0,
        balance: 0,
        points: 0,
        total_holding: 0,
        total_profit: 0,
        available_profit: 0,
        product_count: 0
    });

    const [products, setProducts] = useState<Product[]>([]);
    const [userProducts, setUserProducts] = useState<UserProduct[]>([]);
    const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState("products");
    const [profileSubTab, setProfileSubTab] = useState<"info" | "payment" | "invite" | "chain" | "password">("info");
    const [chainData, setChainData] = useState<any>(null);
    const [currentProviderId, setCurrentProviderId] = useState<string | null>(null);
    const [chainLoading, setChainLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // 修改密码状态
    const [oldPassword, setOldPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showOldPassword, setShowOldPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [changingPassword, setChangingPassword] = useState(false);

    // 用户名编辑状态
    const [editingUsername, setEditingUsername] = useState(false);
    const [newUsername, setNewUsername] = useState("");
    const [savingUsername, setSavingUsername] = useState(false);

    const [message, setMessage] = useState<{
        type: "success" | "error";
        text: string;
    } | null>(null);

    const [showPurchaseDialog, setShowPurchaseDialog] = useState(false);
    const [showSellDialog, setShowSellDialog] = useState(false);
    const [showApplyDialog, setShowApplyDialog] = useState(false);
    const [showRechargeDialog, setShowRechargeDialog] = useState(false);
    const [showTransferDialog, setShowTransferDialog] = useState(false);
    const [showProfitToEnergyDialog, setShowProfitToEnergyDialog] = useState(false);
    const [rechargeAmount, setRechargeAmount] = useState("100");
    const [rechargeNote, setRechargeNote] = useState("");
    const [transferAmount, setTransferAmount] = useState("100");
    const [paymentMethod, setPaymentMethod] = useState<'alipay' | 'wechat'>('alipay');
    const [paymentAccount, setPaymentAccount] = useState("");
    const [transferRealName, setTransferRealName] = useState("");
    const [profitToEnergyAmount, setProfitToEnergyAmount] = useState("100");
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [submittingProductIds, setSubmittingProductIds] = useState<Set<string>>(new Set());
    const [selectedUserProduct, setSelectedUserProduct] = useState<UserProduct | null>(null);
    const [applyType, setApplyType] = useState<"first_gen" | "second_gen">("first_gen");
    const [applicantName, setApplicantName] = useState("");
    const [phone, setPhone] = useState("");
    const [alipayAccount, setAlipayAccount] = useState("");
    const [wechatAccount, setWechatAccount] = useState("");
    const [paymentQRCode, setPaymentQRCode] = useState<string | null>(null);
    const [parentProviderId, setParentProviderId] = useState("");
    const [branchId, setBranchId] = useState("");
    const [quotaRequest, setQuotaRequest] = useState("50000");
    const [realtimeEnergy, setRealtimeEnergy] = useState<number>(0);

    // 邀请新用户相关状态
    const [inviteCode, setInviteCode] = useState("");
    const [referralStats, setReferralStats] = useState({
        directCount: 0,
        totalInvest: 0,
        totalReward: 0,
    });
    interface ReferralStats {
    directCount: number;
    totalInvest: number;
    totalReward: number;
}

interface EnergyRecord {
    id: string;
    type: string;
    amount: number;
    status: string;
    from_user_id?: string;
    to_user_id?: string;
    note?: string;
    description?: string;
    created_at?: string;
    createdAt?: string;
    recordType?: 'recharge' | 'transfer_in' | 'transfer_out' | 'consume' | 'market_transfer' | 'purchase' | 'convert_from_balance' | 'withdraw';
}

interface EnergyStats {
    totalRecharge: number;
    totalTransferOut: number;
    totalTransferIn: number;
    totalConsume: number;
    rechargeCount: number;
    transferOutCount: number;
    transferInCount: number;
    consumeCount: number;
}

const [copySuccess, setCopySuccess] = useState(false);

    // 能量值记录相关状态
    const [energyRecords, setEnergyRecords] = useState<EnergyRecord[]>([]);
    const [energyStats, setEnergyStats] = useState<EnergyStats>({
        totalRecharge: 0,
        totalTransferOut: 0,
        totalTransferIn: 0,
        totalConsume: 0,
        rechargeCount: 0,
        transferOutCount: 0,
        transferInCount: 0,
        consumeCount: 0,
    });
    const [energyRecordFilter, setEnergyRecordFilter] = useState<'all' | 'recharge' | 'transfer_in' | 'transfer_out' | 'consume'>('all');
    const [energyRecordsLoading, setEnergyRecordsLoading] = useState(false);

    // 收益记录相关状态
    const [profitRecords, setProfitRecords] = useState<any[]>([]);
    const [profitStats, setProfitStats] = useState<any>({
        totalPrincipal: 0,
        totalProfit: 0,
        converted: 0,
        available: 0,
    });
    const [showProfitConvertDialog, setShowProfitConvertDialog] = useState(false);
    const [convertAmount, setConvertAmount] = useState("");
    const [profitConvertAmount, setProfitConvertAmount] = useState("");
    const [showWithdrawDialog, setShowWithdrawDialog] = useState(false);
    const [withdrawAmount, setWithdrawAmount] = useState("");
    const [withdrawAlipay, setWithdrawAlipay] = useState("");
    const [withdrawRealName, setWithdrawRealName] = useState("");
    const [withdrawRecords, setWithdrawRecords] = useState<any[]>([]);
    const [pointsRecords, setPointsRecords] = useState<any[]>([]);
    const [rechargeRequests, setRechargeRequests] = useState<any[]>([]);
    const [pendingRechargeCount, setPendingRechargeCount] = useState(0);
    
    // 收益明细相关状态
    const [profitDetails, setProfitDetails] = useState<any[]>([]);
    const [profitDetailsStats, setProfitDetailsStats] = useState<any>({});
    const [profitDetailFilter, setProfitDetailFilter] = useState<'all' | 'profit_in' | 'convert_to_energy' | 'withdraw'>('all');

    // 购买限制相关状态
    const [purchaseLimits, setPurchaseLimits] = useState<any>(null);

    const loadData = useCallback(async () => {
        const userId = localStorage.getItem("userId");
        const userDataStr = localStorage.getItem("userData");

        if (!userId)
            return;

        // 从本地存储获取邀请码（使用 unique_id 或 HM + 手机号后6位）
        if (userDataStr) {
            try {
                const userData = JSON.parse(userDataStr);
                // 优先使用 unique_id，其次使用 HM + 手机号后6位
                const code = userData.unique_id || (userData.phone ? `HM${userData.phone.slice(-6)}` : '');
                setInviteCode(code);
            } catch (e) {
                console.error("解析用户数据失败:", e);
            }
        }

        try {
            // 使用 Promise.allSettled 避免单个失败导致全部失败
            const results = await Promise.allSettled([
                authFetch(`/api/products?status=available&memberId=${userId}`),
                authFetch(`/api/member/assets?userId=${userId}`),
                authFetch(`/api/notifications?userId=${userId}`),
                authFetch(`/api/member/referral-stats?userId=${userId}`),
                authFetch(`/api/member/energy-records?userId=${userId}`),
                authFetch(`/api/member/energy-recharge?userId=${userId}`),
                authFetch(`/api/member/purchase-limits?userId=${userId}`),
                authFetch(`/api/user/chain?userId=${userId}`),
                authFetch(`/api/member/pending-orders?userId=${userId}`),
                authFetch(`/api/member/withdraw?userId=${userId}`),
                authFetch(`/api/member/points-records?userId=${userId}`),
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

            const [productsData, assetsData, notificationsData, referralData, energyRecordsData, rechargeData, purchaseLimitsData, chainDataResult, pendingOrdersData, withdrawData, pointsData] = await Promise.all(
                results.map(safeJson)
            );

            // 处理待审核订单数据
            if (pendingOrdersData.success && pendingOrdersData.data) {
                setPendingOrders(pendingOrdersData.data);
            }

            // 处理提现记录数据
            if (withdrawData.success && withdrawData.data) {
                setWithdrawRecords(withdrawData.data);
            }

            // 处理积分记录数据
            if (pointsData.success && pointsData.data) {
                setPointsRecords(pointsData.data);
            }

            // 处理关系链数据，提取服务商ID
            if (chainDataResult.success && chainDataResult.data) {
                setChainData(chainDataResult.data);
                if (chainDataResult.data.provider?.id) {
                    setCurrentProviderId(chainDataResult.data.provider.id);
                    localStorage.setItem('providerId', chainDataResult.data.provider.id);
                }
            }

            if (productsData.success) {
                // 计算 market_fee（市场费 = 价格 × 市场利率 / 100）
                // 去重：使用Map按id去重
                const uniqueMap = new Map();
                const rawProducts = productsData.data || [];
                rawProducts.forEach((p: any) => {
                    if (!uniqueMap.has(p.id)) {
                        uniqueMap.set(p.id, {
                            ...p,
                            market_fee: Math.floor(p.price * (parseFloat(p.market_rate) || 0) / 100)
                        });
                    }
                });
                setProducts(Array.from(uniqueMap.values()));
            }

            if (assetsData.success) {
                const statsData = assetsData.data?.stats || {};
                setStats({
                    ...statsData,
                    // available_profit 已由API直接返回
                });
                // 去重
                const rawProducts = assetsData.data?.products || [];
                const uniqueProductsMap = new Map();
                rawProducts.forEach((p: any) => {
                    if (!uniqueProductsMap.has(p.id)) {
                        uniqueProductsMap.set(p.id, p);
                    }
                });
                setUserProducts(Array.from(uniqueProductsMap.values()));
            }

            if (notificationsData.success) {
                setNotifications(
                    Array.isArray(notificationsData.data?.notifications) ? notificationsData.data.notifications : []
                );
            }

            if (referralData.success && referralData.data) {
                setReferralStats(referralData.data);
            }

            if (energyRecordsData.success && energyRecordsData.data) {
                setEnergyRecords(energyRecordsData.data.records || []);
                setEnergyStats(energyRecordsData.data.stats || {
                    totalRecharge: 0,
                    totalTransferOut: 0,
                    totalTransferIn: 0,
                    totalConsume: 0,
                    rechargeCount: 0,
                    transferOutCount: 0,
                    transferInCount: 0,
                    consumeCount: 0,
                });
                // 设置实时能量值余额（从API获取，不使用缓存）
                if (energyRecordsData.data.balance !== undefined) {
                    setRealtimeEnergy(energyRecordsData.data.balance);
                }
            }

            // 处理充值申请记录（使用已解析的数据，避免重复读取 Response）
            if (rechargeData.success && rechargeData.data) {
                setRechargeRequests(rechargeData.data || []);
                // 计算待处理数量
                const pending = (rechargeData.data || []).filter((r: any) => r.status === 'pending').length;
                setPendingRechargeCount(pending);
            }

            // 处理购买限制信息
            if (purchaseLimitsData.success && purchaseLimitsData.data) {
                setPurchaseLimits(purchaseLimitsData.data);
            }
        } catch (error) {
            console.error("加载数据失败:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!authLoading && user) {
            loadData();
            setNewUsername(user.username || '');
        }
    }, [authLoading, user, loadData]);

    // 加载收益记录
    const loadProfitRecords = useCallback(async () => {
        if (!user?.id) return;
        
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`/api/member/revenue?userId=${user.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (data.success) {
                setProfitRecords(data.data?.records || []);
                setProfitStats(data.data?.stats || {
                    totalPrincipal: 0,
                    totalProfit: 0,
                    converted: 0,
                    available: 0,
                });
            }
            
            // 获取收益明细
            try {
                const detailsRes = await fetch(`/api/member/revenue/details?userId=${user.id}`);
                const detailsData = await detailsRes.json();
                if (detailsData.success) {
                    setProfitDetails(detailsData.data?.records || []);
                    setProfitDetailsStats(detailsData.data?.stats || {});
                }
            } catch (e) {
                console.error('获取收益明细失败:', e);
            }
        } catch (error) {
            console.error('获取收益记录失败:', error);
        }
    }, [user?.id]);

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
                // 从关系链数据中提取服务商ID
                if (data.data?.provider?.id) {
                    setCurrentProviderId(data.data.provider.id);
                    localStorage.setItem('providerId', data.data.provider.id);
                }
            }
        } catch (error) {
            console.error('获取关系链失败:', error);
        } finally {
            setChainLoading(false);
        }
    }, [user?.id]);

    // 全量并行刷新：用户信息 + 业务数据
    const refreshAll = useCallback(async () => {
        await Promise.allSettled([
            refreshUser(),
            loadData(),
            loadProfitRecords(),
            loadChainData(),
        ]);
    }, [refreshUser, loadData, loadProfitRecords, loadChainData]);

    useEffect(() => {
        if (profileSubTab === 'chain' && !chainData) {
            loadChainData();
        }
        // 切换到收款信息 tab 时加载数据
        if (profileSubTab === 'payment') {
            loadPaymentInfo();
        }
    }, [profileSubTab, chainData, loadChainData]);

    // 加载收款信息
    const loadPaymentInfo = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/member/payment-info', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (data.success && data.data) {
                if (data.data.alipayAccount) setAlipayAccount(data.data.alipayAccount);
                if (data.data.wechatAccount) setWechatAccount(data.data.wechatAccount);
                if (data.data.paymentQRCode) setPaymentQRCode(data.data.paymentQRCode);
            }
        } catch (error) {
            console.error('加载收款信息失败:', error);
        }
    };

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
                refreshAll();
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

    // 修改密码
    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!oldPassword) {
            showMessage("error", "请输入当前密码");
            return;
        }
        if (!newPassword) {
            showMessage("error", "请输入新密码");
            return;
        }
        if (newPassword.length < 6) {
            showMessage("error", "新密码长度不能少于6位");
            return;
        }
        if (newPassword !== confirmPassword) {
            showMessage("error", "两次输入的新密码不一致");
            return;
        }
        if (oldPassword === newPassword) {
            showMessage("error", "新密码不能与旧密码相同");
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
            } else {
                showMessage("error", data.error || "修改失败");
            }
        } catch {
            showMessage("error", "修改失败，请稍后重试");
        } finally {
            setChangingPassword(false);
        }
    };

    // 检查产品是否处于待审核状态（pendingOrders 或 submittingProductIds）
    const isProductPending = (productId: string) => {
        const hasPendingOrder = pendingOrders.some(po => po.productId === productId);
        const isSubmitting = submittingProductIds.has(productId);
        return hasPendingOrder || isSubmitting;
    };

    const showMessage = (type: "success" | "error", text: string) => {
        setMessage({
            type,
            text
        });

        setTimeout(() => setMessage(null), 3000);
    };

    const handlePurchase = async () => {
        if (!selectedProduct)
            return;

        const userId = localStorage.getItem("userId");

        if (!userId)
            return;

        // 检查能量值是否足够支付市场费
        const marketFee = selectedProduct.market_fee || 0;
        if (stats.energy_value < marketFee) {
            showMessage("error", `能量值不足，需要 ${marketFee} 能量值，当前余额 ${stats.energy_value}`);
            return;
        }

        setSubmitting(true);

        try {
            const response = await authFetch("/api/orders/buy", {
                method: "POST",
                body: JSON.stringify({
                    userId,
                    productId: selectedProduct.id,
                    deductEnergy: true // 标记购买时扣除能量值
                })
            });

            const data = await response.json();

            if (data.success) {
                // 使用API返回的消息，显示订单状态
                const message = data.data?.message || "购买申请已提交，等待服务商审核确认";
                showMessage("success", message);
                setShowPurchaseDialog(false);

                // 更新本地存储中的用户能量值
                if (data.data?.remainingEnergy !== undefined) {
                    const userDataStr = localStorage.getItem('userData');
                    if (userDataStr) {
                        try {
                            const userData = JSON.parse(userDataStr);
                            userData.energyValue = data.data.remainingEnergy;
                            userData.energy_value = data.data.remainingEnergy;
                            localStorage.setItem('userData', JSON.stringify(userData));
                        } catch (e) {
                            console.error('更新本地能量值失败:', e);
                        }
                    }
                }

                // 乐观更新：立即将该产品添加到待审核列表
                if (selectedProduct) {
                    const newPendingOrder = {
                        orderId: data.data?.order?.id || `temp-${Date.now()}`,
                        orderStatus: 'pending',
                        orderCreatedAt: new Date().toISOString(),
                        productId: selectedProduct.id,
                        productName: selectedProduct.name,
                        productPrice: selectedProduct.price,
                        productPeriod: selectedProduct.period,
                        totalRate: selectedProduct.total_rate,
                        profitRate: selectedProduct.profit_rate,
                    };
                    setPendingOrders(prev => [newPendingOrder, ...prev]);
                }

                setSelectedProduct(null);
                refreshAll();
            } else {
                // 如果购买失败，从submittingProductIds移除
                if (selectedProduct) {
                    setSubmittingProductIds(prev => {
                        const next = new Set(prev);
                        next.delete(selectedProduct.id);
                        return next;
                    });
                }
            }
        } catch (error) {
            showMessage("error", "网络错误");
            // 网络错误时也要移除
            if (selectedProduct) {
                setSubmittingProductIds(prev => {
                    const next = new Set(prev);
                    next.delete(selectedProduct.id);
                    return next;
                });
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleSell = async () => {
        if (!selectedUserProduct)
            return;

        const userId = localStorage.getItem("userId");

        if (!userId)
            return;

        setSubmitting(true);

        try {
            const response = await authFetch("/api/orders/sell", {
                method: "POST",
                body: JSON.stringify({
                    userId,
                    userProductId: selectedUserProduct.id
                })
            });

            const data = await response.json();

            if (data.success) {
                showMessage("success", "卖出申请已提交，等待审核");
                setShowSellDialog(false);
                setSelectedUserProduct(null);
                refreshAll();
            } else {
                showMessage("error", data.error || "卖出失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    const calculateProfit = (product: Product) => {
        // 使用总收益率计算预期总收益
        const totalRate = product.total_rate || (product.period === 3 ? 5 : 10);
        return Math.floor(product.price * totalRate / 100);
    };

    const calculateMarketFee = (product: Product) => {
        // 使用能量值比例计算市场费
        const marketRate = product.market_rate || (product.period === 3 ? 3 : 5);
        return Math.floor(product.price * marketRate / 100);
    };

    const handleApplyProvider = async () => {
        const userId = localStorage.getItem("userId");

        if (!userId)
            return;

        if (!applicantName || !phone) {
            showMessage("error", "请填写真实姓名和手机号");
            return;
        }

        setSubmitting(true);

        try {
            const response = await authFetch("/api/provider-applications", {
                method: "POST",
                body: JSON.stringify({
                    userId,
                    applicantName,
                    phone,
                    alipayAccount,
                    applyType,
                    parentProviderId: applyType === "second_gen" ? parentProviderId : null,
                    branchId: applyType === "first_gen" ? branchId : null,
                    quotaRequest: parseFloat(quotaRequest) || 50000
                })
            });

            const data = await response.json();

            if (data.success) {
                showMessage("success", data.message || "申请已提交，请等待审核");
                setShowApplyDialog(false);
                setApplicantName("");
                setPhone("");
                setAlipayAccount("");
                setQuotaRequest("50000");
            } else {
                showMessage("error", data.error || "申请失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    const handleRechargeEnergy = async () => {
        const userId = localStorage.getItem("userId");
        if (!userId) return;

        const amount = parseFloat(rechargeAmount);
        if (!amount || amount <= 0) {
            showMessage("error", "请输入有效的充值金额");
            return;
        }

        setSubmitting(true);

        try {
            const response = await authFetch("/api/member/energy-recharge", {
                method: "POST",
                body: JSON.stringify({
                    userId,
                    amount,
                    note: rechargeNote,
                }),
            });

            const data = await response.json();

            if (data.success) {
                showMessage("success", data.message || "充值申请已提交");
                setShowRechargeDialog(false);
                setRechargeAmount("100");
                setRechargeNote("");
                refreshAll();
            } else {
                showMessage("error", data.error || "充值申请失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    const handleEnergyTransfer = async () => {
        const userId = localStorage.getItem("userId");
        // 优先使用 state 中的 providerId，其次使用 localStorage
        const providerId = currentProviderId || localStorage.getItem("providerId");

        if (!userId) {
            showMessage("error", "缺少用户信息");
            return;
        }

        if (!providerId) {
            showMessage("error", "您还没有关联服务商，无法进行转账操作");
            return;
        }

        const amount = parseFloat(transferAmount);
        if (!amount || amount < 50) {
            showMessage("error", "转账金额不能少于50");
            return;
        }

        if (!paymentAccount) {
            showMessage("error", "请输入收款账号");
            return;
        }

        if (!transferRealName.trim()) {
            showMessage("error", "请输入真实姓名");
            return;
        }

        setSubmitting(true);

        try {
            const response = await authFetch("/api/energy/transfer", {
                    method: "POST",
                    body: JSON.stringify({
                        from_user_id: userId,
                        to_user_id: providerId,
                        amount: amount,
                        note: "会员转账给服务商",
                        payment_method: paymentMethod,
                        real_name: transferRealName.trim(),
                        alipay_account: paymentAccount,
                    }),
                });
            const data = await response.json();

            if (data.success) {
                showMessage("success", data.message || "转账申请已提交，等待服务商审核");
                setShowTransferDialog(false);
                setTransferAmount("100");
                setPaymentAccount("");
                setTransferRealName("");
                refreshAll();
            } else {
                showMessage("error", data.error || "转账失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    const handleProfitToEnergy = async () => {
        const userId = localStorage.getItem("userId");
        if (!userId) return;

        const amount = parseFloat(profitToEnergyAmount);
        if (!amount || amount <= 0) {
            showMessage("error", "请输入有效的转换金额");
            return;
        }

        setSubmitting(true);

        try {
            const response = await authFetch("/api/member/convert-to-energy", {
                method: "POST",
                body: JSON.stringify({
                    userId,
                    amount,
                }),
            });

            const data = await response.json();

            if (data.success) {
                const result = data.data || {};
                showMessage("success", `转换成功！${result.energyAmount || 0}→能量值，${result.pointsAmount || 0}→积分`);
                setShowProfitToEnergyDialog(false);
                setProfitToEnergyAmount("100");
                refreshAll();
            } else {
                showMessage("error", data.error || "转换失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    // 会员收益转能量值
    const handleProfitConvert = async () => {
        const userId = localStorage.getItem("userId");
        if (!userId) return;

        const amount = parseFloat(profitConvertAmount);
        if (!amount || amount < 50) {
            showMessage("error", "转换金额不能少于50");
            return;
        }

        setSubmitting(true);

        try {
            const response = await authFetch("/api/member/convert-to-energy", {
                method: "POST",
                body: JSON.stringify({
                    userId,
                    amount,
                }),
            });

            const data = await response.json();

            if (data.success) {
                const result = data.data || {};
                showMessage("success", `转换成功！${result.energyAmount || 0}→能量值，${result.pointsAmount || 0}→积分`);
                setShowProfitConvertDialog(false);
                setProfitConvertAmount("");
                refreshAll();
            } else {
                showMessage("error", data.error || "转换失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    // 会员提现
    const handleWithdraw = async () => {
        const userId = localStorage.getItem("userId");
        if (!userId) return;

        const amount = parseFloat(withdrawAmount);
        if (!amount || amount < 50) {
            showMessage("error", "提现金额不能少于50");
            return;
        }
        if (!withdrawAlipay.trim()) {
            showMessage("error", "请填写支付宝账号");
            return;
        }
        if (!withdrawRealName.trim()) {
            showMessage("error", "请填写真实姓名");
            return;
        }

        setSubmitting(true);
        try {
            const response = await authFetch("/api/member/withdraw", {
                method: "POST",
                body: JSON.stringify({
                    userId,
                    amount,
                    alipayAccount: withdrawAlipay.trim(),
                    realName: withdrawRealName.trim(),
                }),
            });

            const data = await response.json();
            if (data.success) {
                const w = data.data || {};
                showMessage("success", `提现申请已提交！手续费${w.fee || 0}元，实际到账${w.actualAmount || 0}元，等待分公司审核`);
                setShowWithdrawDialog(false);
                setWithdrawAmount("");
                setWithdrawAlipay("");
                setWithdrawRealName("");
                refreshAll();
            } else {
                showMessage("error", data.error || "提现失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    // 会员确认收款
    const handleConfirmReceipt = async (withdrawalId: string) => {
        const userId = localStorage.getItem("userId");
        if (!userId) return;
        setSubmitting(true);
        try {
            const response = await authFetch("/api/member/withdraw", {
                method: "POST",
                body: JSON.stringify({ userId, withdrawalId, action: "confirm_receipt" }),
            });
            const data = await response.json();
            if (data.success) {
                showMessage("success", "已确认收款，提现完成");
                refreshAll();
            } else {
                showMessage("error", data.error || "操作失败");
            }
        } catch (error) {
            showMessage("error", "网络错误");
        } finally {
            setSubmitting(false);
        }
    };

    // 加载提现记录
    const loadWithdrawRecords = async () => {
        const userId = localStorage.getItem("userId");
        if (!userId) return;
        try {
            const response = await authFetch(`/api/member/withdraw?userId=${userId}`);
            const data = await response.json();
            if (data.success) {
                setWithdrawRecords(data.data || []);
            }
        } catch (error) {
            console.error("加载提现记录失败", error);
        }
    };

    // 加载积分记录
    const loadPointsRecords = async () => {
        const userId = localStorage.getItem("userId");
        if (!userId) return;
        try {
            const response = await authFetch(`/api/member/points-records?userId=${userId}`);
            const data = await response.json();
            if (data.success) {
                setPointsRecords(data.data || []);
            }
        } catch (error) {
            console.error("加载积分记录失败", error);
        }
    };

    // 复制邀请码
    const handleCopyInviteCode = async () => {
        if (!inviteCode) return;
        
        try {
            await navigator.clipboard.writeText(inviteCode);
            setCopySuccess(true);
            showMessage("success", "邀请码已复制到剪贴板");
            setTimeout(() => setCopySuccess(false), 2000);
        } catch (err) {
            showMessage("error", "复制失败，请手动复制");
        }
    };

    // 复制邀请链接
    const handleCopyInviteLink = async () => {
        if (!inviteCode) return;
        
        const inviteLink = `${window.location.origin}/?invite=${inviteCode}`;
        
        try {
            await navigator.clipboard.writeText(inviteLink);
            showMessage("success", "邀请链接已复制到剪贴板");
        } catch (err) {
            showMessage("error", "复制失败，请手动复制");
        }
    };

    // 分享到微信
    const handleShareToWechat = () => {
        const shareText = `我在艺元智算投资GPU算力，收益稳定可靠！使用我的邀请码 ${inviteCode} 注册，一起赚取更多收益！`;
        
        if (navigator.share) {
            navigator.share({
                title: '艺元智算 - GPU算力投资平台',
                text: shareText,
                url: `${window.location.origin}/?invite=${inviteCode}`,
            }).catch(() => {});
        } else {
            handleCopyInviteLink();
            showMessage("success", "邀请信息已复制，请粘贴到微信分享");
        }
    };

    if (authLoading || loading) {
        return (
            <div
                className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
                <Loader2 className="w-16 h-16 text-purple-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100">
            {}
            {message && <div
                className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-lg ${message.type === "success" ? "bg-green-500" : "bg-red-500"} text-white shadow-lg`}>
                {message.text}
            </div>}
            {}
            <Dialog open={showPurchaseDialog} onOpenChange={setShowPurchaseDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>确认购买</DialogTitle>
                    </DialogHeader>
                    {selectedProduct && <div className="space-y-4 py-4">
                        <div className="p-4 bg-purple-50 rounded-lg">
                            <h4 className="font-medium text-lg">{selectedProduct.name}</h4>
                            <p className="text-sm text-gray-500">{selectedProduct.code}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <Label className="text-gray-500">算力价格</Label>
                                <p className="text-xl font-bold text-green-600">¥{selectedProduct.price.toLocaleString()}</p>
                            </div>
                            <div>
                                <Label className="text-gray-500">算力周期</Label>
                                <p className="text-xl font-bold">{selectedProduct.period}天</p>
                            </div>
                            <div>
                                <Label className="text-gray-500">预期收益</Label>
                                <p className="text-lg font-bold text-blue-600">+¥{calculateProfit(selectedProduct).toLocaleString()}</p>
                            </div>
                            <div>
                                <Label className="text-gray-500">到期总额</Label>
                                <p className="text-lg font-bold text-green-600">¥{(selectedProduct.price + calculateProfit(selectedProduct)).toLocaleString()}</p>
                            </div>
                        </div>
                        {/* 能量值要求 */}
                        <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-orange-800 font-medium">购买需支付市场费</span>
                                <span className="text-orange-600 font-bold">{(selectedProduct.market_fee || 0)} 能量值</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-orange-600">当前能量值余额</span>
                                <span className={`font-semibold ${stats.energy_value >= (selectedProduct.market_fee || 0) ? 'text-green-600' : 'text-red-600'}`}>
                                    {stats.energy_value.toLocaleString()} 能量值
                                </span>
                            </div>
                            {stats.energy_value < (selectedProduct.market_fee || 0) && (
                                <div className="mt-2 p-2 bg-red-100 rounded text-sm text-red-700">
                                    ⚠️ 能量值不足，请先充值后再购买
                                </div>
                            )}
                        </div>
                        <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                            <p>💡 购买时需支付市场费（能量值），到期卖出时直接获得本金+收益</p>
                        </div>
                    </div>}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => {
                            // 取消时移除提交状态
                            if (selectedProduct) {
                                setSubmittingProductIds(prev => {
                                    const next = new Set(prev);
                                    next.delete(selectedProduct.id);
                                    return next;
                                });
                            }
                            setShowPurchaseDialog(false);
                        }}>取消</Button>
                        <Button
                            className="bg-green-600 hover:bg-green-700"
                            onClick={handlePurchase}
                            disabled={submitting || !selectedProduct || stats.energy_value < (selectedProduct.market_fee || 0)}>
                            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRight className="w-4 h-4 mr-2" />}确认购买
                                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {}
            <Dialog open={showTransferDialog} onOpenChange={setShowTransferDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Zap className="w-5 h-5 text-orange-500" />能量值转账
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                            <p className="text-sm text-blue-800">
                                <strong>转账说明：</strong>
                            </p>
                            <ul className="list-disc list-inside text-xs text-blue-700 mt-2 space-y-1">
                                <li>能量值转账给服务商，服务商线下打款给您</li>
                                <li>最低转账金额：50能量值</li>
                                <li>提交后等待服务商审核确认</li>
                                <li>请确保收款信息准确，方便服务商打款</li>
                            </ul>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="transferAmount">转账金额（能量值）</Label>
                            <Input
                                id="transferAmount"
                                type="number"
                                min="50"
                                value={transferAmount}
                                onChange={e => setTransferAmount(e.target.value)}
                                placeholder="请输入转账金额，最少50"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="paymentMethod">收款方式</Label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setPaymentMethod('alipay')}
                                    className={`p-3 rounded-lg border-2 ${paymentMethod === 'alipay' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                                    <p className="font-medium text-sm">支付宝</p>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPaymentMethod('wechat')}
                                    className={`p-3 rounded-lg border-2 ${paymentMethod === 'wechat' ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}>
                                    <p className="font-medium text-sm">微信</p>
                                </button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="paymentAccount">
                                {paymentMethod === 'alipay' ? '支付宝账号' : '微信号'}
                            </Label>
                            <Input
                                id="paymentAccount"
                                value={paymentAccount}
                                onChange={e => setPaymentAccount(e.target.value)}
                                placeholder={`请输入您的${paymentMethod === 'alipay' ? '支付宝账号' : '微信号'}`}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="transferRealName">真实姓名</Label>
                            <Input
                                id="transferRealName"
                                value={transferRealName}
                                onChange={e => setTransferRealName(e.target.value)}
                                placeholder={`请输入真实姓名（需与${paymentMethod === 'alipay' ? '支付宝' : '微信'}一致）`}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowTransferDialog(false)}>取消</Button>
                        <Button
                            className="bg-orange-500 hover:bg-orange-600"
                            onClick={handleEnergyTransfer}
                            disabled={submitting || !paymentAccount || !transferRealName.trim()}>
                            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRight className="w-4 h-4 mr-2" />}提交转账
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {}
            <Dialog open={showProfitToEnergyDialog} onOpenChange={setShowProfitToEnergyDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-green-500" />收益转能量值
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                            <p className="text-sm text-green-800">
                                <strong>转换说明：</strong>
                            </p>
                            <ul className="list-disc list-inside text-xs text-green-700 mt-2 space-y-1">
                                <li>将已获得的收益转换为能量值</li>
                                <li>转换后的能量值可用于支付市场费</li>
                                <li>1收益 = 1能量值</li>
                            </ul>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="profitToEnergyAmount">转换金额（收益）</Label>
                            <Input
                                id="profitToEnergyAmount"
                                type="number"
                                min="1"
                                value={profitToEnergyAmount}
                                onChange={e => setProfitToEnergyAmount(e.target.value)}
                                placeholder="请输入转换金额"
                            />
                        </div>
                        <div className="p-3 bg-yellow-50 rounded-lg text-sm text-yellow-700">
                            <p>可转换收益：¥{stats.total_profit.toLocaleString()}</p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowProfitToEnergyDialog(false)}>取消</Button>
                        <Button
                            className="bg-green-500 hover:bg-green-600"
                            onClick={handleProfitToEnergy}
                            disabled={submitting}>
                            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}确认转换
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {}
            <Dialog open={showSellDialog} onOpenChange={setShowSellDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>申请卖出</DialogTitle>
                    </DialogHeader>
                    {selectedUserProduct && <div className="space-y-4 py-4">
                        <div className="p-4 bg-purple-50 rounded-lg">
                            <h4 className="font-medium text-lg">{selectedUserProduct.products?.name}</h4>
                            <p className="text-sm text-gray-500">{selectedUserProduct.products?.code}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <Label className="text-gray-500">购买价格（本金）</Label>
                                <p className="text-lg font-bold">¥{selectedUserProduct.purchase_price.toLocaleString()}</p>
                            </div>
                            <div>
                                <Label className="text-gray-500">预期收益</Label>
                                <p className="text-lg font-bold text-green-600">+¥{selectedUserProduct.expected_profit.toLocaleString()}</p>
                            </div>
                        </div>
                        {/* 收益明细 */}
                        <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                            <h4 className="font-medium text-green-800 mb-2">到期收益明细</h4>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-green-700">本金返还（线下）</span>
                                    <span className="font-semibold text-green-800">¥{selectedUserProduct.purchase_price.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-green-700">收益到账（线上）</span>
                                    <span className="font-semibold text-green-800">¥{selectedUserProduct.expected_profit.toLocaleString()}</span>
                                </div>
                                <div className="border-t border-green-200 pt-2 flex justify-between">
                                    <span className="text-green-800 font-medium">合计</span>
                                    <span className="font-bold text-green-900">¥{(selectedUserProduct.purchase_price + selectedUserProduct.expected_profit).toLocaleString()}</span>
                                </div>
                            </div>
                        </div>
                        <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                            <p>💡 购买时已支付市场费，到期卖出时直接返还本金（线下转账）和收益（到账上）</p>
                        </div>
                    </div>}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowSellDialog(false)}>取消</Button>
                        <Button
                            className="bg-orange-600 hover:bg-orange-700"
                            onClick={handleSell}
                            disabled={submitting}>
                            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRight className="w-4 h-4 mr-2" />}申请卖出
                                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {}
            <Dialog open={showApplyDialog} onOpenChange={setShowApplyDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Star className="w-5 h-5 text-purple-500" />申请成为服务商
                                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {}
                        <div className="space-y-2">
                            <Label>申请类型</Label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setApplyType("first_gen")}
                                    className={`p-3 rounded-lg border-2 text-left ${applyType === "first_gen" ? "border-purple-500 bg-purple-50" : "border-gray-200"}`}>
                                    <p className="font-medium">第一代服务商</p>
                                    <p className="text-xs text-gray-500 mt-1">由分公司审核</p>
                                </button>
                                <button
                                    onClick={() => setApplyType("second_gen")}
                                    className={`p-3 rounded-lg border-2 text-left ${applyType === "second_gen" ? "border-purple-500 bg-purple-50" : "border-gray-200"}`}>
                                    <p className="font-medium">第二代服务商</p>
                                    <p className="text-xs text-gray-500 mt-1">由上级服务商审核</p>
                                </button>
                            </div>
                        </div>
                        {}
                        <div className="space-y-2">
                            <Label htmlFor="applicantName">真实姓名 *</Label>
                            <Input
                                id="applicantName"
                                value={applicantName}
                                onChange={e => setApplicantName(e.target.value)}
                                placeholder="请输入真实姓名" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="phone">手机号 *</Label>
                            <Input
                                id="phone"
                                value={phone}
                                onChange={e => setPhone(e.target.value)}
                                placeholder="请输入手机号" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="alipay">支付宝账号</Label>
                            <Input
                                id="alipay"
                                value={alipayAccount}
                                onChange={e => setAlipayAccount(e.target.value)}
                                placeholder="请输入支付宝账号（用于收益提现）" />
                        </div>
                        {}
                        {applyType === "first_gen" && <div className="space-y-2">
                            <Label htmlFor="branchId">选择分公司 *</Label>
                            <Input
                                id="branchId"
                                value={branchId}
                                onChange={e => setBranchId(e.target.value)}
                                placeholder="请输入分公司ID或用户名" />
                            <p className="text-xs text-gray-500">请联系分公司获取ID</p>
                        </div>}
                        {}
                        {applyType === "second_gen" && <div className="space-y-2">
                            <Label htmlFor="parentProvider">上级服务商ID *</Label>
                            <Input
                                id="parentProvider"
                                value={parentProviderId}
                                onChange={e => setParentProviderId(e.target.value)}
                                placeholder="请输入上级服务商ID或用户名" />
                            <p className="text-xs text-gray-500">请联系您的上级服务商获取ID</p>
                        </div>}
                        {}
                        <div className="space-y-2">
                            <Label htmlFor="quota">申请额度（元）</Label>
                            <Input
                                id="quota"
                                type="number"
                                value={quotaRequest}
                                onChange={e => setQuotaRequest(e.target.value)}
                                placeholder="申请的额度" />
                            <p className="text-xs text-gray-500">建议填写50000元，可获得15个算力名额</p>
                        </div>
                        {}
                        <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                            <p className="font-medium mb-1">💡 成为服务商的好处：</p>
                            <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>获得算力额度，生成算力上架销售</li>
                                <li>享受算力销售收益</li>
                                <li>可发展下级服务商，获得团队收益</li>
                            </ul>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowApplyDialog(false)}>取消</Button>
                        <Button
                            className="bg-purple-600 hover:bg-purple-700"
                            onClick={handleApplyProvider}
                            disabled={submitting}>
                            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Star className="w-4 h-4 mr-2" />}提交申请
                                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {}
            <Dialog open={showRechargeDialog} onOpenChange={setShowRechargeDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Zap className="w-5 h-5 text-orange-500" />充值能量值
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                            <p className="text-sm text-orange-800">
                                <strong>充值说明：</strong>
                            </p>
                            <ul className="list-disc list-inside text-xs text-orange-700 mt-2 space-y-1">
                                <li>能量值用于支付卖出算力时的市场费</li>
                                <li>充值后请联系服务商线下付款</li>
                                <li>服务商确认后会为您充值能量值</li>
                            </ul>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="rechargeAmount">充值金额（能量值）</Label>
                            <Input
                                id="rechargeAmount"
                                type="number"
                                min="1"
                                value={rechargeAmount}
                                onChange={e => setRechargeAmount(e.target.value)}
                                placeholder="请输入充值金额"
                            />
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setRechargeAmount("50")}>
                                50
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setRechargeAmount("100")}>
                                100
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setRechargeAmount("500")}>
                                500
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setRechargeAmount("1000")}>
                                1000
                            </Button>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="rechargeNote">备注（可选）</Label>
                            <Input
                                id="rechargeNote"
                                value={rechargeNote}
                                onChange={e => setRechargeNote(e.target.value)}
                                placeholder="请输入备注信息"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowRechargeDialog(false)}>取消</Button>
                        <Button
                            className="bg-orange-500 hover:bg-orange-600"
                            onClick={handleRechargeEnergy}
                            disabled={submitting}>
                            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}提交申请
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 收益转能量值对话框 */}
            <Dialog open={showProfitConvertDialog} onOpenChange={setShowProfitConvertDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-green-500" />收益转能量值
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="p-4 bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border border-green-200">
                            <p className="text-sm text-gray-800">
                                <strong>可转换收益：</strong>
                                <span className="text-2xl font-bold text-green-600 ml-2">
                                    ¥{(profitStats.available || 0).toFixed(2)}
                                </span>
                            </p>
                            <ul className="list-disc list-inside text-xs text-gray-600 mt-2 space-y-1">
                                <li>转换时5%转为积分，95%转为能量值</li>
                                <li>积分可用于兑换产品</li>
                                <li>最低转换额度：50元</li>
                            </ul>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="profitConvertAmount">转换金额（元）</Label>
                            <Input
                                id="profitConvertAmount"
                                type="number"
                                min="50"
                                max={profitStats.available || 0}
                                value={profitConvertAmount}
                                onChange={e => setProfitConvertAmount(e.target.value)}
                                placeholder="请输入转换金额"
                            />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setProfitConvertAmount(String(Math.min(100, profitStats.available || 0)))}>
                                100
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setProfitConvertAmount(String(Math.min(500, profitStats.available || 0)))}>
                                500
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setProfitConvertAmount(String(profitStats.available || 0))}>
                                全部
                            </Button>
                        </div>
                        {profitConvertAmount && Number(profitConvertAmount) > 0 && (
                            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 space-y-1">
                                <p className="text-sm text-blue-800">
                                    能量值：<strong className="text-blue-600">{(Number(profitConvertAmount) * 0.95).toFixed(2)}</strong>
                                </p>
                                <p className="text-sm text-orange-800">
                                    积分：<strong className="text-orange-600">{(Number(profitConvertAmount) * 0.05).toFixed(2)}</strong>
                                </p>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowProfitConvertDialog(false)}>取消</Button>
                        <Button
                            className="bg-green-500 hover:bg-green-600"
                            onClick={handleProfitConvert}
                            disabled={submitting || !profitConvertAmount || Number(profitConvertAmount) < 50}>
                            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <TrendingUp className="w-4 h-4 mr-2" />}确认转换
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <header className="border-b bg-white shadow-sm sticky top-0 z-40">
                <div className="container mx-auto px-3 md:px-6 py-3 md:py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 md:gap-3">
                            <div
                                className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center">
                                <Cpu className="w-5 h-5 md:w-6 md:h-6 text-white" />
                            </div>
                            <div>
                                <h1 className="text-base md:text-xl font-bold text-gray-900">艺元智算</h1>
                                <p className="text-xs text-gray-500 hidden md:block">GPU算力收益平台</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 md:gap-4">
                            {/* 会员信息 */}
                            <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border border-green-200">
                            <div className="text-left">
                                <p className="text-sm font-semibold text-gray-900">
                                    {user?.name || '会员'}
                                </p>
                                <p className="text-xs text-gray-500">
                                    ID: {user?.unique_id || (user?.phone ? `HM${user.phone.slice(-6)}` : 'N/A')}
                                </p>
                            </div>
                        </div>
                            {notifications.filter(n => !n.is_read).length > 0 && <Badge className="bg-red-100 text-red-700">
                                <Bell className="w-3 h-3 mr-1" />{notifications.filter(n => !n.is_read).length}条新消息
                                                </Badge>}
                            <Badge className="bg-green-100 text-green-700 text-xs">
                                <Users className="w-3 h-3 mr-1" />会员
                                              </Badge>
                            <Button variant="ghost" onClick={logout} className="text-sm">退出</Button>
                        </div>
                    </div>
                </div>
            </header>
            <main className="container mx-auto px-3 md:px-6 py-4 md:py-8">
                {}
                {/* 资产概览 - 移除余额显示 */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-4 mb-4 md:mb-8">
                    <Card className="mobile-compact-card bg-gradient-to-br from-orange-500 to-orange-600 text-white relative overflow-hidden">
                        <CardContent className="pt-4">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <Zap className="w-5 h-5 mobile-icon" />
                                    <span className="opacity-80 text-sm mobile-label">能量值</span>
                                </div>
                            </div>
                            <p className="text-2xl font-bold mobile-num">{stats.energy_value.toLocaleString()}</p>
                            <div className="flex gap-2 mt-3">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-white border-white/30 hover:bg-white/20"
                                    onClick={() => setShowRechargeDialog(true)}>
                                    充值
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-white border-white/30 hover:bg-white/20"
                                    onClick={() => setShowTransferDialog(true)}>
                                    转账
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="mobile-compact-card bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                        <CardContent className="pt-4">
                            <div className="flex items-center gap-2">
                                <Package className="w-5 h-5 mobile-icon" />
                                <span className="opacity-80 text-sm mobile-label">持有算力</span>
                            </div>
                            <p className="text-2xl font-bold mt-2 mobile-num">¥{stats.total_holding?.toLocaleString() || 0}</p>
                        </CardContent>
                    </Card>
                    <Card className="mobile-compact-card bg-gradient-to-br from-purple-500 to-purple-600 text-white">
                        <CardContent className="pt-4">
                            <div className="flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 mobile-icon" />
                                <span className="opacity-80 text-sm mobile-label">累计收益</span>
                            </div>
                            <p className="text-2xl font-bold mt-2 mobile-num">¥{stats.total_profit?.toLocaleString() || 0}</p>
                            <div className="mt-2 pt-2 border-t border-white/20">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs opacity-70">可转能量值</p>
                                        <p className="text-lg font-semibold">¥{stats.available_profit?.toLocaleString() || 0}</p>
                                    </div>
                                    <Button
                                        size="sm"
                                        className="bg-white text-purple-600 hover:bg-purple-50"
                                        onClick={() => setShowProfitToEnergyDialog(true)}
                                        disabled={!stats.available_profit || stats.available_profit <= 0}>
                                        收益转能量值
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
                {}
                <div className="space-y-3 md:space-y-6">
                    <div className="mobile-tab-nav flex gap-4 border-b overflow-x-auto scrollbar-hide">
                        <button
                            onClick={() => setActiveTab("profile")}
                            className={`px-4 py-2 border-b-2 transition-colors flex-shrink-0 ${activeTab === "profile" ? "border-green-500 text-green-600" : "border-transparent text-gray-500"}`}>
                            <User className="w-4 h-4 inline mr-2" />我的资料
                        </button>
                        <button
                            onClick={() => setActiveTab("products")}
                            className={`px-4 py-2 border-b-2 transition-colors flex-shrink-0 ${activeTab === "products" ? "border-green-500 text-green-600" : "border-transparent text-gray-500"}`}>
                            <ShoppingCart className="w-4 h-4 inline mr-2" />购买算力
                        </button>
                        <button
                            onClick={() => setActiveTab("holdings")}
                            className={`px-4 py-2 border-b-2 transition-colors flex-shrink-0 ${activeTab === "holdings" ? "border-green-500 text-green-600" : "border-transparent text-gray-500"}`}>
                            <Package className="w-4 h-4 inline mr-2" />我的持仓
                        </button>
                        <button
                            onClick={() => setActiveTab("transfers")}
                            className={`px-4 py-2 border-b-2 transition-colors flex-shrink-0 ${activeTab === "transfers" ? "border-green-500 text-green-600" : "border-transparent text-gray-500"}`}>
                            <Zap className="w-4 h-4 inline mr-2" />能量值管理
                        </button>
                        <button
                            onClick={() => {
                                setActiveTab("notifications");
                            }}
                            className={`px-4 py-2 border-b-2 transition-colors flex-shrink-0 ${activeTab === "notifications" ? "border-green-500 text-green-600" : "border-transparent text-gray-500"}`}>
                            <Bell className="w-4 h-4 inline mr-2" />消息通知
                            {notifications.filter(n => !n.is_read).length > 0 && <Badge className="ml-2 bg-red-500 text-white text-xs">
                                {notifications.filter(n => !n.is_read).length}
                            </Badge>}
                        </button>
                        <button
                            onClick={() => {
                                setActiveTab("profit");
                                loadProfitRecords();
                            }}
                            className={`px-4 py-2 border-b-2 transition-colors flex-shrink-0 ${activeTab === "profit" ? "border-green-500 text-green-600" : "border-transparent text-gray-500"}`}>
                            <TrendingUp className="w-4 h-4 inline mr-2" />我的收益
                        </button>
                        <button
                            onClick={() => {
                                setActiveTab("points");
                                loadPointsRecords();
                            }}
                            className={`px-4 py-2 border-b-2 transition-colors flex-shrink-0 ${activeTab === "points" ? "border-green-500 text-green-600" : "border-transparent text-gray-500"}`}>
                            <Gift className="w-4 h-4 inline mr-2" />我的积分
                        </button>
                        <button
                            onClick={() => setShowApplyDialog(true)}
                            className="px-4 py-2 border-b-2 border-transparent text-purple-600 hover:text-purple-700 flex-shrink-0">
                            <Star className="w-4 h-4 inline mr-2" />申请服务商
                        </button>
                    </div>
                    {}

                    {/* 我的资料 */}
                    {activeTab === "profile" && (
                        <div className="space-y-4">
                            {/* 子Tab导航 */}
                            <div className="flex border-b bg-gray-50 rounded-t-lg overflow-hidden">
                                <button
                                    onClick={() => setProfileSubTab("info")}
                                    className={`px-6 py-3 text-sm font-medium transition-colors ${
                                        profileSubTab === "info" 
                                            ? "text-green-600 bg-white border-b-2 border-green-500" 
                                            : "text-gray-600 hover:text-green-600 hover:bg-gray-50"
                                    }`}
                                >
                                    <User className="w-4 h-4 inline mr-2" />基本资料
                                </button>
                                <button
                                    onClick={() => setProfileSubTab("payment")}
                                    className={`px-6 py-3 text-sm font-medium transition-colors ${
                                        profileSubTab === "payment" 
                                            ? "text-green-600 bg-white border-b-2 border-green-500" 
                                            : "text-gray-600 hover:text-green-600 hover:bg-gray-50"
                                    }`}
                                >
                                    <Wallet className="w-4 h-4 inline mr-2" />收款信息
                                </button>
                                <button
                                    onClick={() => setProfileSubTab("invite")}
                                    className={`px-6 py-3 text-sm font-medium transition-colors ${
                                        profileSubTab === "invite" 
                                            ? "text-green-600 bg-white border-b-2 border-green-500" 
                                            : "text-gray-600 hover:text-green-600 hover:bg-gray-50"
                                    }`}
                                >
                                    <Gift className="w-4 h-4 inline mr-2" />邀请推广
                                </button>
                                <button
                                    onClick={() => { setProfileSubTab("chain"); loadChainData(); }}
                                    className={`px-6 py-3 text-sm font-medium transition-colors ${
                                        profileSubTab === "chain" 
                                            ? "text-green-600 bg-white border-b-2 border-green-500" 
                                            : "text-gray-600 hover:text-green-600 hover:bg-gray-50"
                                    }`}
                                >
                                    <Network className="w-4 h-4 inline mr-2" />关系链
                                </button>
                                <button
                                    onClick={() => setProfileSubTab("password")}
                                    className={`px-6 py-3 text-sm font-medium transition-colors ${
                                        profileSubTab === "password" 
                                            ? "text-green-600 bg-white border-b-2 border-green-500" 
                                            : "text-gray-600 hover:text-green-600 hover:bg-gray-50"
                                    }`}
                                >
                                    <Lock className="w-4 h-4 inline mr-2" />修改密码
                                </button>
                            </div>

                            {/* 基本资料子Tab */}
                            {profileSubTab === "info" && (
                                <Card>
                                    <CardContent className="pt-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            {/* 基本信息 */}
                                            <div className="space-y-4">
                                                <h3 className="font-medium text-lg border-b pb-2">基本信息</h3>
                                                <div className="space-y-3">
                                                    <div className="flex items-center justify-between py-2 border-b">
                                                        <span className="text-gray-500">专属ID</span>
                                                        <span className="font-medium text-sm">{user?.unique_id || (user?.phone ? `HM${user.phone.slice(-6)}` : '-')}</span>
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
                                                        <Badge className="bg-green-100 text-green-700">会员</Badge>
                                                    </div>
                                                    <div className="flex items-center justify-between py-2 border-b">
                                                        <span className="text-gray-500">手机号</span>
                                                        <span>{user?.phone || '-'}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between py-2 border-b">
                                                        <span className="text-gray-500">真实姓名</span>
                                                        <span>{user?.real_name || '未填写'}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* 账户信息 */}
                                            <div className="space-y-4">
                                                <h3 className="font-medium text-lg border-b pb-2">账户信息</h3>
                                                <div className="space-y-3">
                                                    <div className="flex items-center justify-between py-2 border-b">
                                                        <span className="text-gray-500">能量值余额</span>
                                                        <span className="font-bold text-xl text-green-600">{(realtimeEnergy || user?.energyValue || 0).toLocaleString()}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between py-2 border-b">
                                                        <span className="text-gray-500">账户余额</span>
                                                        <span className="font-medium">¥{(user?.balance || 0).toLocaleString()}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between py-2 border-b">
                                                        <span className="text-gray-500">专属ID</span>
                                                        <span className="font-mono text-sm">{user?.unique_id || '-'}</span>
                                                    </div>
                                                </div>

                                                <div className="mt-4 p-4 bg-green-50 rounded-lg">
                                                    <p className="text-sm text-green-700 font-medium mb-2">温馨提示</p>
                                                    <p className="text-sm text-green-600">购买算力需要充足的能量值作为市场费</p>
                                                    <p className="text-sm text-green-600">能量值余额不足时无法卖出产品</p>
                                                </div>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            {/* 收款信息子Tab */}
                            {profileSubTab === "payment" && (
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2">
                                            <Wallet className="w-5 h-5 text-green-600" />
                                            收款信息设置
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-3 md:space-y-6">
                                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                                            <p className="text-sm text-blue-700">
                                                <strong>提示：</strong>请填写您的支付宝和微信收款信息，以便服务商为您充值能量值时进行验证。付款码用于线下转账确认。
                                            </p>
                                        </div>

                                        {/* 支付宝信息 */}
                                        <div className="space-y-4">
                                            <h3 className="font-medium text-lg flex items-center gap-2">
                                                <span className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm">支</span>
                                                支付宝
                                            </h3>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <Label>支付宝账号</Label>
                                                    <Input 
                                                        value={alipayAccount}
                                                        onChange={(e) => setAlipayAccount(e.target.value)}
                                                        className="mt-1"
                                                        placeholder="请输入支付宝账号"
                                                    />
                                                </div>
                                                <div>
                                                    <Label>真实姓名（与支付宝一致）</Label>
                                                    <Input 
                                                        value={user?.real_name || ''}
                                                        onChange={(e) => {
                                                            const newUser = { ...user, real_name: e.target.value } as typeof user;
                                                            setUser(newUser);
                                                            localStorage.setItem('userData', JSON.stringify(newUser));
                                                        }}
                                                        className="mt-1"
                                                        placeholder="请输入真实姓名"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* 微信信息 */}
                                        <div className="space-y-4 pt-4 border-t">
                                            <h3 className="font-medium text-lg flex items-center gap-2">
                                                <span className="w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center text-sm">微</span>
                                                微信
                                            </h3>
                                            <div>
                                                <Label>微信账号</Label>
                                                <Input 
                                                    value={wechatAccount}
                                                    onChange={(e) => setWechatAccount(e.target.value)}
                                                    className="mt-1"
                                                    placeholder="请输入微信账号"
                                                />
                                            </div>
                                        </div>

                                        {/* 付款码上传 */}
                                        <div className="space-y-4 pt-4 border-t">
                                            <h3 className="font-medium text-lg flex items-center gap-2">
                                                <span className="w-8 h-8 rounded-full bg-purple-500 text-white flex items-center justify-center text-sm">码</span>
                                                付款码上传
                                            </h3>
                                            <p className="text-sm text-gray-500">上传您的支付宝或微信付款码图片，方便服务商扫码转账</p>
                                            
                                            <div className="flex items-start gap-6">
                                                {/* 支付宝付款码 */}
                                                <div className="flex-1">
                                                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:border-green-500 transition-colors">
                                                        {paymentQRCode ? (
                                                            <div className="relative">
                                                                <img 
                                                                    src={paymentQRCode} 
                                                                    alt="付款码" 
                                                                    className="max-h-48 mx-auto rounded"
                                                                />
                                                                <Button
                                                                    variant="destructive"
                                                                    size="sm"
                                                                    className="mt-2"
                                                                    onClick={() => setPaymentQRCode(null)}
                                                                >
                                                                    删除
                                                                </Button>
                                                            </div>
                                                        ) : (
                                                            <label className="cursor-pointer">
                                                                <div className="py-8">
                                                                    <Upload className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                                                                    <p className="text-sm text-gray-500">点击上传付款码</p>
                                                                    <p className="text-xs text-gray-400 mt-1">支持 JPG、PNG 格式</p>
                                                                </div>
                                                                <input 
                                                                    type="file" 
                                                                    accept="image/*"
                                                                    className="hidden"
                                                                    onChange={(e) => {
                                                                        const file = e.target.files?.[0];
                                                                        if (file) {
                                                                            const reader = new FileReader();
                                                                            reader.onload = (event) => {
                                                                                setPaymentQRCode(event.target?.result as string);
                                                                            };
                                                                            reader.readAsDataURL(file);
                                                                        }
                                                                    }}
                                                                />
                                                            </label>
                                                        )}
                                                    </div>
                                                    <p className="text-center text-sm text-gray-500 mt-2">支付宝付款码</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="pt-4 border-t">
                                            <Button 
                                                className="bg-green-600"
                                                onClick={async () => {
                                                    // 保存收款信息
                                                    try {
                                                        const response = await authFetch('/api/member/payment-info', {
                                                            method: 'PUT',
                                                            body: JSON.stringify({
                                                                wechatAccount,
                                                                alipayAccount,
                                                                paymentQRCode
                                                            })
                                                        });
                                                        const data = await response.json();
                                                        if (data.success) {
                                                            showMessage("success", "收款信息已保存");
                                                        } else {
                                                            showMessage("error", data.error || "保存失败");
                                                        }
                                                    } catch {
                                                        showMessage("error", "保存失败，请稍后重试");
                                                    }
                                                }}
                                            >
                                                保存收款信息
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            {/* 邀请推广子Tab */}
                            {profileSubTab === "invite" && (
                                <div className="space-y-3 md:space-y-6">
                                    {/* 邀请码卡片 */}
                                    <Card className="bg-gradient-to-br from-green-500 to-emerald-600 text-white overflow-hidden relative">
                                        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cGF0aCBkPSJNMCAwaDEwMHYxMDBIMHoiIGZpbGw9Im5vbmUiLz48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSIyIiBmaWxsPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMSkiLz48L3N2Zz4=')] opacity-30"></div>
                                        <CardContent className="relative z-10 py-8">
                                            <div className="text-center mb-6">
                                                <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-4">
                                                    <Gift className="w-8 h-8" />
                                                </div>
                                                <h3 className="text-2xl font-bold mb-2">邀请好友</h3>
                                                <p className="text-white/80 text-sm">分享您的邀请码，好友注册后您可获得奖励</p>
                                            </div>
                                            
                                            {/* 邀请码显示 */}
                                            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-6">
                                                <div className="text-center">
                                                    <p className="text-white/70 text-sm mb-2">您的邀请码</p>
                                                    <div className="flex items-center justify-center gap-3">
                                                        <span className="text-3xl font-bold tracking-wider font-mono">
                                                            {inviteCode || "加载中..."}
                                                        </span>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="text-white border-white/30 hover:bg-white/20"
                                                            onClick={handleCopyInviteCode}
                                                        >
                                                            {copySuccess ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            {/* 操作按钮 */}
                                            <div className="grid grid-cols-2 gap-3">
                                                <Button
                                                    variant="outline"
                                                    className="bg-white/10 hover:bg-white/20 text-white border-white/30"
                                                    onClick={handleCopyInviteLink}
                                                >
                                                    <LinkIcon className="w-4 h-4 mr-2" />
                                                    复制链接
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    className="bg-white/10 hover:bg-white/20 text-white border-white/30"
                                                    onClick={handleShareToWechat}
                                                >
                                                    <Share2 className="w-4 h-4 mr-2" />
                                                    分享邀请
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* 邀请统计 */}
                                    <div className="grid grid-cols-3 gap-4">
                                        <Card className="text-center">
                                            <CardContent className="pt-4">
                                                <Users className="w-8 h-8 mx-auto mb-2 text-blue-500" />
                                                <p className="text-2xl font-bold text-gray-800">{referralStats.directCount}</p>
                                                <p className="text-sm text-gray-500">直推人数</p>
                                            </CardContent>
                                        </Card>
                                        <Card className="text-center">
                                            <CardContent className="pt-4">
                                                <TrendingUp className="w-8 h-8 mx-auto mb-2 text-green-500" />
                                                <p className="text-2xl font-bold text-gray-800">¥{referralStats.totalInvest.toLocaleString()}</p>
                                                <p className="text-sm text-gray-500">直推投资额</p>
                                            </CardContent>
                                        </Card>
                                        <Card className="text-center">
                                            <CardContent className="pt-4">
                                                <Award className="w-8 h-8 mx-auto mb-2 text-purple-500" />
                                                <p className="text-2xl font-bold text-gray-800">¥{referralStats.totalReward.toLocaleString()}</p>
                                                <p className="text-sm text-gray-500">累计奖励</p>
                                            </CardContent>
                                        </Card>
                                    </div>

                                    {/* 邀请规则 */}
                                    <Card>
                                        <CardHeader>
                                            <CardTitle className="flex items-center gap-2">
                                                <Star className="w-5 h-5 text-yellow-500" />
                                                邀请奖励规则
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                                                <h4 className="font-medium text-yellow-800 mb-2">直推奖励</h4>
                                                <ul className="space-y-2 text-sm text-yellow-700">
                                                    <li className="flex items-start gap-2">
                                                        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                                        <span>好友注册时填写您的邀请码，双方自动建立绑定关系</span>
                                                    </li>
                                                    <li className="flex items-start gap-2">
                                                        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                                        <span>好友购买算力时，您可获得好友交易额的一定比例作为奖励</span>
                                                    </li>
                                                    <li className="flex items-start gap-2">
                                                        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                                        <span>奖励实时到账，可用于能量值充值或提现</span>
                                                    </li>
                                                </ul>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>
                            )}

                            {/* 关系链子Tab */}
                            {profileSubTab === "chain" && (
                                <div className="space-y-4">
                                    {chainLoading ? (
                                        <Card>
                                            <CardContent className="py-12 text-center">
                                                <Loader2 className="w-8 h-8 animate-spin mx-auto text-green-600" />
                                                <p className="mt-4 text-gray-500">加载中...</p>
                                            </CardContent>
                                        </Card>
                                    ) : chainData ? (
                                        <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
                                            <CardHeader>
                                                <CardTitle className="flex items-center gap-2 text-white">
                                                    <Network className="w-5 h-5 text-emerald-400" />
                                                    我的关系链
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                                {/* 关系说明 */}
                                                <div className="space-y-4">
                                                    {/* 会员关系链：总公司 → 分公司 → 服务商 → 会员 */}
                                                    <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700">
                                                        <h4 className="text-emerald-400 font-medium mb-3 flex items-center gap-2">
                                                            <Badge className="bg-emerald-600 text-white text-xs">会员</Badge>
                                                            关系链说明
                                                        </h4>
                                                        <div className="flex flex-wrap items-center gap-2 text-slate-300 text-sm">
                                                            <span>总公司</span>
                                                            <ArrowRight className="w-4 h-4 text-slate-500" />
                                                            <span>分公司</span>
                                                            <ArrowRight className="w-4 h-4 text-slate-500" />
                                                            <span>服务商</span>
                                                            <ArrowRight className="w-4 h-4 text-slate-500" />
                                                            <span className="text-emerald-400 font-medium">{chainData.self?.username || '我'}</span>
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

                                                        {/* 服务商 */}
                                                        {chainData.provider && (
                                                            <div className="flex items-center gap-3 p-3 bg-purple-900/30 rounded-lg border border-purple-800/50">
                                                                <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center">
                                                                    <Server className="w-5 h-5 text-white" />
                                                                </div>
                                                                <div className="flex-1">
                                                                    <p className="text-purple-400 font-medium">{chainData.provider.username}</p>
                                                                    <p className="text-slate-400 text-sm">
                                                                        上级：{chainData.branch ? chainData.branch.username : '总公司'}
                                                                    </p>
                                                                </div>
                                                                <Badge className="bg-purple-600 text-white">服务商</Badge>
                                                            </div>
                                                        )}

                                                        {/* 推荐人（如果没有服务商，则显示推荐人） */}
                                                        {chainData.inviter && !chainData.provider && (
                                                            <div className="flex items-center gap-3 p-3 bg-yellow-900/30 rounded-lg border border-yellow-800/50">
                                                                <div className="w-10 h-10 rounded-full bg-yellow-600 flex items-center justify-center">
                                                                    <UserPlus className="w-5 h-5 text-white" />
                                                                </div>
                                                                <div className="flex-1">
                                                                    <p className="text-yellow-400 font-medium">{chainData.inviter.username}</p>
                                                                    <p className="text-slate-400 text-sm">推荐人</p>
                                                                </div>
                                                                <Badge className="bg-yellow-600 text-white">{chainData.inviter.roleName}</Badge>
                                                            </div>
                                                        )}

                                                        {/* 当前用户 */}
                                                        <div className="flex items-center gap-3 p-3 bg-emerald-900/30 rounded-lg border border-emerald-800/50">
                                                            <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center">
                                                                <User className="w-5 h-5 text-white" />
                                                            </div>
                                                            <div className="flex-1">
                                                                <p className="text-emerald-400 font-bold">{chainData.self?.username}</p>
                                                                <p className="text-slate-400 text-sm">
                                                                    下级：{chainData.branch ? chainData.branch.username + ' → ' : ''}{chainData.provider ? chainData.provider.username + ' → ' : ''}我
                                                                </p>
                                                            </div>
                                                            <Badge className="bg-emerald-600 text-white">
                                                                {chainData.self?.role === 'provider' ? '服务商' : '会员'}
                                                            </Badge>
                                                        </div>
                                                    </div>

                                                    {/* 无上级提示 */}
                                                    {!chainData.branch && !chainData.provider && !chainData.inviter && (
                                                        <div className="text-center py-8 text-slate-400">
                                                            <Network className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                                            <p>您还没有关联上级</p>
                                                            <p className="text-sm mt-1">请联系服务商获取推荐码进行关联</p>
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

                            {/* 修改密码Tab */}
                            {profileSubTab === "password" && (
                                <div className="space-y-3 md:space-y-6">
                                    <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
                                        <CardHeader>
                                            <CardTitle className="flex items-center gap-2 text-white">
                                                <Lock className="w-5 h-5 text-emerald-400" />
                                                修改登录密码
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
                                                <div className="space-y-2">
                                                    <Label className="text-slate-300">当前密码</Label>
                                                    <div className="relative">
                                                        <Input
                                                            type={showOldPassword ? "text" : "password"}
                                                            value={oldPassword}
                                                            onChange={(e) => setOldPassword(e.target.value)}
                                                            placeholder="请输入当前密码"
                                                            className="bg-slate-800 border-slate-600 text-white pr-10"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowOldPassword(!showOldPassword)}
                                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
                                                        >
                                                            {showOldPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-slate-300">新密码</Label>
                                                    <div className="relative">
                                                        <Input
                                                            type={showNewPassword ? "text" : "password"}
                                                            value={newPassword}
                                                            onChange={(e) => setNewPassword(e.target.value)}
                                                            placeholder="请输入新密码（至少6位）"
                                                            className="bg-slate-800 border-slate-600 text-white pr-10"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowNewPassword(!showNewPassword)}
                                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
                                                        >
                                                            {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-slate-300">确认新密码</Label>
                                                    <div className="relative">
                                                        <Input
                                                            type={showConfirmPassword ? "text" : "password"}
                                                            value={confirmPassword}
                                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                                            placeholder="请再次输入新密码"
                                                            className="bg-slate-800 border-slate-600 text-white pr-10"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
                                                        >
                                                            {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                        </button>
                                                    </div>
                                                </div>
                                                <Button
                                                    type="submit"
                                                    disabled={changingPassword}
                                                    className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500"
                                                >
                                                    {changingPassword ? (
                                                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                                    ) : (
                                                        <Lock className="w-4 h-4 mr-2" />
                                                    )}
                                                    {changingPassword ? "修改中..." : "确认修改"}
                                                </Button>
                                            </form>
                                        </CardContent>
                                    </Card>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === "products" && <div className="space-y-3 md:space-y-6">
                        {}
                        
                        {/* 购买限制提示 */}
                        {purchaseLimits && (
                            <div className="grid grid-cols-3 gap-2">
                                {/* 持仓金额限制 */}
                                <Card className={`border ${purchaseLimits.limits?.holdingLimitReached ? 'border-red-500 bg-red-900/20' : 'border-amber-500/50 bg-amber-900/20'}`}>
                                    <CardContent className="p-2">
                                        <div className="flex items-center gap-1 mb-1">
                                            <Wallet className={`w-3.5 h-3.5 ${purchaseLimits.limits?.holdingLimitReached ? 'text-red-400' : 'text-amber-400'}`} />
                                            <span className="text-xs font-medium text-slate-300">持仓限额</span>
                                        </div>
                                        <div className="flex justify-between items-end">
                                            <div>
                                                <p className="text-lg font-bold text-white">{Number(purchaseLimits.limits?.currentHolding || 0).toLocaleString()}</p>
                                                <p className="text-[10px] text-slate-400">/ {purchaseLimits.limits?.maxHolding?.toLocaleString()} 元</p>
                                            </div>
                                            <Badge variant="outline" className={`text-[10px] ${purchaseLimits.limits?.holdingLimitReached ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
                                                {purchaseLimits.limits?.holdingLimitReached ? '已达' : `余 ${Number(purchaseLimits.limits?.remainingHolding || 0).toLocaleString()}`}
                                            </Badge>
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* 推荐人状态 */}
                                <Card className={`border ${purchaseLimits.limits?.hasValidInviter ? 'border-green-600 bg-green-900/20' : 'border-orange-500/50 bg-orange-900/20'}`}>
                                    <CardContent className="p-2">
                                        <div className="flex items-center gap-1 mb-1">
                                            <Users className={`w-3.5 h-3.5 ${purchaseLimits.limits?.hasValidInviter ? 'text-green-400' : 'text-orange-400'}`} />
                                            <span className="text-xs font-medium text-slate-300">推荐人</span>
                                        </div>
                                        <div className="flex justify-between items-end">
                                            <div>
                                                <p className="text-lg font-bold text-white">
                                                    {purchaseLimits.limits?.hasValidInviter ? '有效' : '无'}
                                                </p>
                                                <p className="text-[10px] text-slate-400">
                                                    {purchaseLimits.limits?.hasValidInviter ? purchaseLimits.limits?.inviterInfo?.username : '未绑定'}
                                                </p>
                                            </div>
                                            <Badge variant="outline" className={`text-[10px] ${purchaseLimits.limits?.hasValidInviter ? 'bg-green-500/20 text-green-400' : 'bg-orange-500/20 text-orange-400'}`}>
                                                {purchaseLimits.limits?.hasValidInviter ? '已激活' : '待激活'}
                                            </Badge>
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* 保护期状态 */}
                                <Card className={`border ${purchaseLimits.limits?.isTimeLocked ? 'border-red-500 bg-red-900/20' : purchaseLimits.limits?.graceRemainingDays > 0 ? 'border-green-600 bg-green-900/20' : 'border-slate-600 bg-slate-800/50'}`}>
                                    <CardContent className="p-2">
                                        <div className="flex items-center gap-1 mb-1">
                                            <Clock className={`w-3.5 h-3.5 ${purchaseLimits.limits?.isTimeLocked ? 'text-red-400' : purchaseLimits.limits?.graceRemainingDays > 0 ? 'text-green-400' : 'text-slate-400'}`} />
                                            <span className="text-xs font-medium text-slate-300">保护期</span>
                                        </div>
                                        <div className="flex justify-between items-end">
                                            <div>
                                                {purchaseLimits.limits?.isTimeLocked ? (
                                                    <>
                                                        <p className="text-lg font-bold text-red-400">已锁定</p>
                                                        <p className="text-[10px] text-slate-400">需推荐人</p>
                                                    </>
                                                ) : purchaseLimits.limits?.graceRemainingDays > 0 ? (
                                                    <>
                                                        <p className="text-lg font-bold text-green-400">
                                                            {purchaseLimits.limits?.graceRemainingDays}
                                                            <span className="text-xs font-normal text-slate-400"> 天</span>
                                                        </p>
                                                        <p className="text-[10px] text-slate-400">保护中</p>
                                                    </>
                                                ) : purchaseLimits.limits?.hasValidInviter ? (
                                                    <>
                                                        <p className="text-lg font-bold text-green-400">已解除</p>
                                                        <p className="text-[10px] text-slate-400">有推荐人</p>
                                                    </>
                                                ) : (
                                                    <>
                                                        <p className="text-lg font-bold text-orange-400">待绑定</p>
                                                        <p className="text-[10px] text-slate-400">需推荐人</p>
                                                    </>
                                                )}
                                            </div>
                                            <Badge variant="outline" className={`text-[10px] ${purchaseLimits.limits?.isTimeLocked ? 'bg-red-500/20 text-red-400' : purchaseLimits.limits?.graceRemainingDays > 0 ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400'}`}>
                                                {purchaseLimits.limits?.isTimeLocked ? '已锁定' : purchaseLimits.limits?.graceRemainingDays > 0 ? '保护中' : '待绑定'}
                                            </Badge>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        )}

                        {products.length > 0 && <Card className="border-green-200 bg-gradient-to-r from-green-900 to-green-800 text-white">
                            <CardContent className="py-4">
                                <div className="flex items-center gap-3">
                                    <Zap className="w-6 h-6 text-yellow-400" />
                                    <div>
                                        <p className="font-medium text-white">服务商上架了 {products.length}个新算力</p>
                                        <p className="text-sm text-green-200">选择适合您的算力进行购买</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>}

                        {/* GPU产品说明 */}
                        <div className="grid grid-cols-3 gap-4">
                            <Card className="bg-gradient-to-br from-blue-900/80 to-slate-900 border-blue-800/50">
                                <CardContent className="p-4 text-center">
                                    <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-blue-500/20 flex items-center justify-center">
                                        <Cpu className="w-6 h-6 text-blue-400" />
                                    </div>
                                    <h4 className="font-bold text-blue-400 mb-1">蓝色系 · 入门级</h4>
                                    <p className="text-xs text-slate-400">英伟达 RTX 系列</p>
                                    <p className="text-xs text-slate-500 mt-1">¥1,000 - ¥5,000</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-gradient-to-br from-green-900/80 to-slate-900 border-green-800/50">
                                <CardContent className="p-4 text-center">
                                    <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-green-500/20 flex items-center justify-center">
                                        <Server className="w-6 h-6 text-green-400" />
                                    </div>
                                    <h4 className="font-bold text-green-400 mb-1">绿色系 · 进阶级</h4>
                                    <p className="text-xs text-slate-400">华为昇腾系列</p>
                                    <p className="text-xs text-slate-500 mt-1">¥5,000 - ¥30,000</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-gradient-to-br from-amber-900/80 to-slate-900 border-amber-800/50">
                                <CardContent className="p-4 text-center">
                                    <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-amber-500/20 flex items-center justify-center">
                                        <Zap className="w-6 h-6 text-amber-400" />
                                    </div>
                                    <h4 className="font-bold text-amber-400 mb-1">橙黄色系 · 高端级</h4>
                                    <p className="text-xs text-slate-400">思元 MLU 系列</p>
                                    <p className="text-xs text-slate-500 mt-1">¥30,000 - ¥500,000</p>
                                </CardContent>
                            </Card>
                        </div>

                        {}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {products.map(product => {
                                // 根据价格确定产品等级和颜色 (蓝色入门级、绿色进阶级、橙黄高端级)
                                const getProductTier = (price: number) => {
                                    if (price <= 5000) return { 
                                        name: '入门级', 
                                        level: 'entry',
                                        color: 'blue', 
                                        stars: 3, 
                                        bgGradient: 'from-blue-900/90 to-slate-900', 
                                        iconBg: 'from-blue-500/40 to-cyan-500/40', 
                                        iconBorder: 'border-blue-500/60', 
                                        iconColor: 'text-blue-400',
                                        btnGradient: 'from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400',
                                        badge: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
                                        headerBg: 'from-blue-600/90 to-blue-700/70',
                                    };
                                    if (price <= 30000) return { 
                                        name: '进阶级', 
                                        level: 'advanced',
                                        color: 'green', 
                                        stars: 4, 
                                        bgGradient: 'from-green-900/90 to-slate-900', 
                                        iconBg: 'from-green-500/40 to-emerald-500/40', 
                                        iconBorder: 'border-green-500/60', 
                                        iconColor: 'text-green-400',
                                        btnGradient: 'from-green-600 to-green-500 hover:from-green-500 hover:to-green-400',
                                        badge: 'bg-green-500/20 text-green-400 border-green-500/30',
                                        headerBg: 'from-green-600/90 to-green-700/70',
                                    };
                                    return { 
                                        name: '高端级', 
                                        level: 'premium',
                                        color: 'amber', 
                                        stars: 5, 
                                        bgGradient: 'from-amber-900/90 to-slate-900', 
                                        iconBg: 'from-amber-500/40 to-orange-500/40', 
                                        iconBorder: 'border-amber-500/60', 
                                        iconColor: 'text-amber-400',
                                        btnGradient: 'from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400',
                                        badge: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
                                        headerBg: 'from-amber-600/90 to-amber-700/70',
                                    };
                                };

                                // 根据GPU型号获取展示信息
                                const getGPUDisplay = (productId: string) => {
                                    // 从产品ID解析GPU信息
                                    const id = productId.toLowerCase();
                                    if (id.includes('rtx4090') || id.includes('nvidia')) {
                                        return { vendor: 'nvidia', model: 'RTX 4090', fullName: 'NVIDIA RTX 4090', icon: 'GPU', desc: '最新一代旗舰显卡，16384 CUDA核心，24GB GDDR6X显存' };
                                    }
                                    if (id.includes('rtx3090')) {
                                        return { vendor: 'nvidia', model: 'RTX 3090', fullName: 'NVIDIA RTX 3090', icon: 'GPU', desc: '旗舰级游戏显卡，10496 CUDA核心，24GB GDDR6X显存' };
                                    }
                                    if (id.includes('ascend910b') || id.includes('huawei')) {
                                        return { vendor: 'huawei', model: '昇腾 910B', fullName: '华为昇腾 910B', icon: 'AI', desc: '华为旗舰AI芯片，2560 TOPS INT8算力，256GB HBM' };
                                    }
                                    if (id.includes('ascend910')) {
                                        return { vendor: 'huawei', model: '昇腾 910', fullName: '华为昇腾 910', icon: 'AI', desc: '华为自研AI处理器，256 TOPS INT8算力' };
                                    }
                                    if (id.includes('ascend310')) {
                                        return { vendor: 'huawei', model: '昇腾 310', fullName: '华为昇腾 310', icon: 'AI', desc: '高能效AI推理芯片，边缘计算理想选择' };
                                    }
                                    if (id.includes('mlu290') || id.includes('sugon')) {
                                        return { vendor: 'sugon', model: '思元 290', fullName: '思元 MLU290', icon: 'MLU', desc: '国产高端AI训练芯片，512 TOPS FP16，128GB HBM2' };
                                    }
                                    if (id.includes('mlu270')) {
                                        return { vendor: 'sugon', model: '思元 270', fullName: '思元 MLU270', icon: 'MLU', desc: '高性能AI推理芯片，128 TOPS INT8' };
                                    }
                                    // 默认根据价格分配
                                    if (product.price <= 5000) {
                                        return { vendor: 'nvidia', model: 'RTX A4000', fullName: 'NVIDIA RTX A4000', icon: 'GPU', desc: '专业级显卡，6144 CUDA核心，16GB GDDR6显存' };
                                    }
                                    if (product.price <= 30000) {
                                        return { vendor: 'huawei', model: '昇腾 910', fullName: '华为昇腾 910', icon: 'AI', desc: '华为自研AI处理器，强大算力支持' };
                                    }
                                    return { vendor: 'sugon', model: '思元 290', fullName: '思元 MLU290', icon: 'MLU', desc: '国产高端AI训练芯片，超大规模并行计算' };
                                };

                                const tier = getProductTier(product.price);
                                const gpuInfo = getGPUDisplay(product.id);
                                const total_rate = product.total_rate || product.period === 3 ? 5 : 10;
                                const profit_rate = product.profit_rate || product.period === 3 ? 2 : 5;

                                return (
                                <Card 
                                    key={product.id}
                                    className={`bg-gradient-to-br ${tier.bgGradient} border-slate-700 overflow-hidden hover:shadow-xl transition-all duration-300 group`}
                                >
                                    {/* 顶部GPU展示区域 */}
                                    <div className="relative h-40 overflow-hidden">
                                        {/* 渐变背景 */}
                                        <div className={`absolute inset-0 bg-gradient-to-br ${tier.headerBg}`}>
                                            {/* 科技网格背景 */}
                                            <div className="absolute inset-0 opacity-10" style={{
                                                backgroundImage: `linear-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.1) 1px, transparent 1px)`,
                                                backgroundSize: '20px 20px'
                                            }} />
                                            {/* 科技线条动画 */}
                                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                                        </div>

                                        {/* GPU芯片图标 */}
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <div className={`w-24 h-24 rounded-2xl bg-gradient-to-br ${tier.iconBg} border-2 ${tier.iconBorder} flex flex-col items-center justify-center backdrop-blur-sm shadow-2xl`}>
                                                <span className={`text-2xl font-black ${tier.iconColor}`}>{gpuInfo.icon}</span>
                                                <span className={`text-[10px] font-bold mt-1 ${tier.iconColor}`}>{gpuInfo.vendor.toUpperCase()}</span>
                                            </div>
                                        </div>

                                        {/* 等级标签 */}
                                        <div className="absolute top-3 left-3">
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${tier.badge} border backdrop-blur-sm`}>
                                                {tier.name}
                                            </span>
                                        </div>

                                        {/* 星级评级 */}
                                        <div className="absolute top-3 right-3 flex gap-0.5">
                                            {[...Array(5)].map((_, i) => (
                                                <Star key={i} className={`w-3.5 h-3.5 ${i < tier.stars ? 'text-yellow-400 fill-yellow-400' : 'text-white/30'}`} />
                                            ))}
                                        </div>

                                        {/* 产品编码 */}
                                        <div className="absolute bottom-3 right-3">
                                            <span className="px-2 py-0.5 bg-slate-900/80 rounded text-xs text-slate-300 font-mono backdrop-blur-sm">
                                                {product.code || `GPU-${product.id.slice(0, 8).toUpperCase()}`}
                                            </span>
                                        </div>
                                    </div>

                                    {/* 产品信息区域 */}
                                    <CardContent className="p-5">
                                        {/* GPU型号 */}
                                        <div className="mb-3">
                                            <h3 className="text-lg font-bold text-white group-hover:text-emerald-400 transition-colors flex items-center gap-2">
                                                {gpuInfo.model}
                                                <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
                                                    {gpuInfo.vendor === 'nvidia' ? 'NVIDIA' : gpuInfo.vendor === 'huawei' ? '华为' : '思元'}
                                                </Badge>
                                            </h3>
                                            <p className="text-xs text-slate-400 mt-1">{gpuInfo.desc}</p>
                                        </div>

                                        {/* 周期标签 */}
                                        <div className="flex items-center gap-2 mb-4">
                                            <Badge variant="outline" className={`${tier.badge} border text-xs`}>
                                                <Clock className="w-3 h-3 mr-1" />
                                                {product.period}天周期
                                            </Badge>
                                            <Badge variant="outline" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
                                                到期{total_rate}%总收益
                                            </Badge>
                                        </div>

                                        {/* 核心参数 */}
                                        <div className="grid grid-cols-2 gap-3 mb-4">
                                            <div className={`p-3 rounded-xl border ${tier.color === 'blue' ? 'bg-blue-500/10 border-blue-500/30' : tier.color === 'green' ? 'bg-green-500/10 border-green-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
                                                <p className="text-xs text-slate-400 mb-1">预期收益</p>
                                                <p className={`text-xl font-bold ${tier.color === 'blue' ? 'text-blue-400' : tier.color === 'green' ? 'text-green-400' : 'text-amber-400'}`}>+{total_rate}%</p>
                                                <p className="text-xs text-slate-500">总收益率</p>
                                            </div>
                                            <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
                                                <p className="text-xs text-slate-400 mb-1">会员到手</p>
                                                <p className="text-xl font-bold text-emerald-400">{profit_rate}%</p>
                                                <p className="text-xs text-slate-500">实际收益</p>
                                            </div>
                                        </div>

                                        {/* 投资金额 */}
                                        <div className={`flex items-center justify-between p-3 rounded-lg mb-4 border ${tier.color === 'blue' ? 'bg-blue-500/10 border-blue-500/30' : tier.color === 'green' ? 'bg-green-500/10 border-green-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
                                            <span className="text-sm text-slate-400">购买金额</span>
                                            <span className="text-xl font-bold text-white">¥{product.price.toLocaleString()}</span>
                                        </div>

                                        {/* 待审核状态提示 */}
                                        {(() => {
                                            if (isProductPending(product.id)) {
                                                return (
                                                    <div className="mb-4 p-3 rounded-lg bg-yellow-500/20 border border-yellow-500/40 text-yellow-300 text-center">
                                                        <Clock className="w-4 h-4 inline mr-1" />
                                                        您已申请购买此产品，等待审核中
                                                    </div>
                                                );
                                            }
                                            return null;
                                        })()}

                                        {/* 购买按钮 */}
                                        <Button
                                            className={`w-full font-medium shadow-lg transition-all ${
                                                purchaseLimits?.limits?.canBuy === false || isProductPending(product.id)
                                                    ? 'bg-slate-600 hover:bg-slate-600 cursor-not-allowed opacity-50'
                                                    : `bg-gradient-to-r ${tier.btnGradient} text-white shadow-${tier.color === 'blue' ? 'blue' : tier.color === 'green' ? 'green' : 'amber'}-500/25`
                                            }`}
                                            disabled={purchaseLimits?.limits?.canBuy === false || isProductPending(product.id)}
                                            onClick={() => {
                                                if (purchaseLimits?.limits?.canBuy === false) {
                                                    showMessage("error", purchaseLimits?.limits?.limitMessage || "当前无法购买");
                                                    return;
                                                }
                                                if (isProductPending(product.id)) {
                                                    showMessage("success", "该产品正在等待审核，请稍后再试");
                                                    return;
                                                }
                                                // 立即标记为提交中，防止重复点击
                                                setSubmittingProductIds(prev => new Set(prev).add(product.id));
                                                setSelectedProduct(product);
                                                setShowPurchaseDialog(true);
                                            }}>
                                            {purchaseLimits?.limits?.canBuy === false ? (
                                                <>
                                                    <Lock className="w-4 h-4 mr-2" />无法购买
                                                </>
                                            ) : isProductPending(product.id) ? (
                                                <>
                                                    <Clock className="w-4 h-4 mr-2" />等待审核
                                                </>
                                            ) : (
                                                <>
                                                    <ShoppingCart className="w-4 h-4 mr-2" />立即购买
                                                </>
                                            )}
                                        </Button>
                                    </CardContent>
                                </Card>
                                );
                            })}
                            {products.length === 0 && <div className="col-span-3 text-center py-12">
                                <Package className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                                <p className="text-gray-500">暂无可购买的算力</p>
                                <p className="text-sm text-gray-400">请等待服务商上架算力</p>
                            </div>}
                        </div>
                    </div>}
                    {}
                    {/* 待审核订单提示 */}
                    {pendingOrders.length > 0 && (
                        <Card className="mb-4 border-yellow-400/50 bg-yellow-50/5">
                            <CardContent className="p-4">
                                <div className="flex items-center gap-2 text-yellow-400 mb-3">
                                    <Clock className="w-5 h-5" />
                                    <span className="font-bold">您有 {pendingOrders.length} 个待审核的购买申请</span>
                                </div>
                                <div className="space-y-2">
                                    {pendingOrders.map((po) => (
                                        <div key={po.orderId} className="flex items-center justify-between p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                                            <div>
                                                <p className="text-white font-medium">{po.productName}</p>
                                                <p className="text-sm text-gray-400">¥{po.productPrice?.toLocaleString()} · {po.productPeriod}天</p>
                                            </div>
                                            <Badge variant="outline" className="text-yellow-400 border-yellow-400/50">
                                                {po.orderStatus === 'processing' ? '审核中' : '待审核'}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                    {activeTab === "holdings" && <Card>
                        <CardHeader>
                            <CardTitle>我的持仓</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                {(() => {
                                    // 按产品周期分组
                                    const groupedProducts = userProducts.reduce((acc, up) => {
                                        const period = up.products?.period || 0;
                                        if (!acc[period]) acc[period] = [];
                                        acc[period].push(up);
                                        return acc;
                                    }, {} as Record<number, typeof userProducts>);
                                    
                                    // 按周期排序（3天在前，7天在后）
                                    const sortedPeriods = Object.keys(groupedProducts)
                                        .map(Number)
                                        .sort((a, b) => a - b);
                                    
                                    return sortedPeriods.map(period => (
                                        <div key={period} className="mb-6">
                                            {/* 分组标题 */}
                                            <div className="flex items-center gap-3 mb-3">
                                                <h3 className="font-bold text-lg">
                                                    {period}天算力套餐
                                                </h3>
                                                <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200">
                                                    {groupedProducts[period].length} 个
                                                </Badge>
                                            </div>
                                            
                                            {/* 分组内的产品列表 */}
                                            <table className="w-full">
                                                <thead>
                                                    <tr className="border-b bg-gray-50">
                                                        <th className="text-left py-3 px-4">购买时间</th>
                                                        <th className="text-left py-3 px-4">算力</th>
                                                        <th className="text-left py-3 px-4">购买价格</th>
                                                        <th className="text-left py-3 px-4">预期收益</th>
                                                        <th className="text-left py-3 px-4">市场费</th>
                                                        <th className="text-left py-3 px-4">可卖出</th>
                                                        <th className="text-left py-3 px-4">状态</th>
                                                        <th className="text-left py-3 px-4">操作</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {groupedProducts[period].map(up => {
                                                        // 计算持仓时间和可卖出时间（按产品周期）
                                                        const purchaseDate = new Date(up.purchase_date);
                                                        const now = new Date();
                                                        const holdHours = (now.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60);
                                                        
                                                        // 根据产品周期计算最低持仓时间
                                                        const periodHours: Record<number, number> = {
                                                            3: 72,   // 3天 = 72小时
                                                            7: 168,  // 7天 = 168小时
                                                            15: 360, // 15天 = 360小时
                                                            30: 720, // 30天 = 720小时
                                                            90: 2160 // 90天 = 2160小时
                                                        };
                                                        const minHoldHours = periodHours[period] || 72;
                                                        const canSell = holdHours >= minHoldHours;
                                                        const remainingHours = Math.max(0, minHoldHours - holdHours);
                                                        
                                                        // 格式化购买时间
                                                        const formatPurchaseTime = (date: Date) => {
                                                            const year = date.getFullYear();
                                                            const month = String(date.getMonth() + 1).padStart(2, '0');
                                                            const day = String(date.getDate()).padStart(2, '0');
                                                            const hours = String(date.getHours()).padStart(2, '0');
                                                            const minutes = String(date.getMinutes()).padStart(2, '0');
                                                            return `${year}-${month}-${day} ${hours}:${minutes}`;
                                                        };
                                                        
                                                        return <tr key={up.id} className="border-b hover:bg-gray-50">
                                                        <td className="py-3 px-4 text-gray-600 text-sm">
                                                            {formatPurchaseTime(purchaseDate)}
                                                        </td>
                                                        <td className="py-3 px-4">
                                                            <div>
                                                                <p className="font-medium">{up.products?.name || "-"}</p>
                                                                <p className="text-sm text-gray-500">{up.products?.code}</p>
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-4 text-green-600 font-medium">¥{up.purchase_price.toLocaleString()}
                                                        </td>
                                                        <td className="py-3 px-4 text-blue-600">+¥{up.expected_profit.toLocaleString()}
                                                        </td>
                                                        <td className="py-3 px-4 text-orange-600">
                                                            {up.market_fee || 0}能量值
                                                        </td>
                                                        <td className="py-3 px-4">
                                                            {up.status === "holding" && (
                                                                canSell ? (
                                                                    <Badge className="bg-green-100 text-green-700">
                                                                        已解锁
                                                                    </Badge>
                                                                ) : (
                                                                    <div className="text-center">
                                                                        <Badge className="bg-red-100 text-red-700">
                                                                            <Lock className="w-3 h-3 mr-1" />
                                                                            {Math.floor(remainingHours)}小时{Math.floor((remainingHours % 1) * 60)}分
                                                                        </Badge>
                                                                    </div>
                                                                )
                                                            )}
                                                        </td>
                                                        <td className="py-3 px-4">
                                                            <Badge
                                                                className={up.status === "holding" ? "bg-blue-100 text-blue-700" : up.status === "pending_sell" ? "bg-yellow-100 text-yellow-700" : up.status === "sold" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"}>
                                                                {up.status === "holding" ? "持有中" : up.status === "pending_sell" ? "待审核" : up.status === "sold" ? "已卖出" : up.status}
                                                            </Badge>
                                                        </td>
                                                        <td className="py-3 px-4">
                                                            {up.status === "holding" && canSell && <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => {
                                                                    setSelectedUserProduct(up);
                                                                    setShowSellDialog(true);
                                                                }}>卖出
                                                            </Button>}
                                                            {up.status === "holding" && !canSell && <Button
                                                                size="sm"
                                                                variant="outline"
                                                                disabled
                                                                className="opacity-50"
                                                            >锁定中
                                                            </Button>}
                                                            {up.status === "pending_sell" && <span className="text-sm text-gray-500">审核中</span>}
                                                        </td>
                                                    </tr>})}
                                                </tbody>
                                            </table>
                                        </div>
                                    ));
                                })()}
                                {userProducts.length === 0 && <div className="py-8 text-center text-gray-500">暂无持仓，请先购买算力</div>}
                            </div>
                        </CardContent>
                    </Card>}

                    {/* 能量值管理 Tab */}
                    {activeTab === "transfers" && <div className="space-y-3 md:space-y-6">
                        {/* 统计卡片 */}
                        <div className="grid grid-cols-3 gap-3 md:gap-4">
                            <Card className="bg-gradient-to-br from-green-500 to-emerald-600 text-white">
                                <CardContent className="pt-3 pb-3 md:pt-4 md:pb-4">
                                    <div className="flex items-center gap-2 mb-1">
                                        <ArrowDownCircle className="w-4 h-4" />
                                        <span className="text-xs md:text-sm opacity-80">累计转入</span>
                                    </div>
                                    <p className="text-xl md:text-2xl font-bold">{(energyStats.totalRecharge + energyStats.totalTransferIn).toLocaleString()}</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
                                <CardContent className="pt-3 pb-3 md:pt-4 md:pb-4">
                                    <div className="flex items-center gap-2 mb-1">
                                        <ArrowUpCircle className="w-4 h-4" />
                                        <span className="text-xs md:text-sm opacity-80">累计转出</span>
                                    </div>
                                    <p className="text-xl md:text-2xl font-bold">{energyStats.totalTransferOut.toLocaleString()}</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-gradient-to-br from-red-500 to-red-600 text-white">
                                <CardContent className="pt-3 pb-3 md:pt-4 md:pb-4">
                                    <div className="flex items-center gap-2 mb-1">
                                        <TrendingDown className="w-4 h-4" />
                                        <span className="text-xs md:text-sm opacity-80">市场费消耗</span>
                                    </div>
                                    <p className="text-xl md:text-2xl font-bold">-{energyStats.totalConsume.toLocaleString()}</p>
                                </CardContent>
                            </Card>
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex gap-2">
                            <Button
                                onClick={() => setShowRechargeDialog(true)}
                                className="bg-green-600 hover:bg-green-700 text-white flex-1"
                            >
                                <Zap className="w-4 h-4 mr-2" />申请能量值
                            </Button>
                            <Button
                                onClick={() => setShowTransferDialog(true)}
                                className="bg-blue-600 hover:bg-blue-700 text-white flex-1"
                            >
                                <ArrowRightLeft className="w-4 h-4 mr-2" />能量值互转
                            </Button>
                        </div>

                        {/* 充值申请记录 */}
                        {rechargeRequests.length > 0 && (
                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm flex items-center gap-2">
                                        <Clock className="w-4 h-4" />
                                        充值申请记录
                                        {rechargeRequests.filter(r => r.status === 'pending').length > 0 && (
                                            <Badge className="bg-orange-100 text-orange-700 text-xs">
                                                {rechargeRequests.filter(r => r.status === 'pending').length} 待确认
                                            </Badge>
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-2">
                                        {rechargeRequests.slice(0, 5).map((request) => (
                                            <div key={request.id} className={`flex items-center justify-between p-3 border rounded-lg text-sm ${
                                                request.status === 'pending' ? 'bg-yellow-50 border-yellow-200' :
                                                request.status === 'approved' ? 'bg-green-50 border-green-200' :
                                                'bg-red-50 border-red-200'
                                            }`}>
                                                <div className="flex items-center gap-2">
                                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs ${
                                                        request.status === 'pending' ? 'bg-yellow-100 text-yellow-600' :
                                                        request.status === 'approved' ? 'bg-green-100 text-green-600' :
                                                        'bg-red-100 text-red-600'
                                                    }`}>
                                                        {request.status === 'pending' ? <Clock className="w-4 h-4" /> :
                                                         request.status === 'approved' ? <CheckCircle className="w-4 h-4" /> :
                                                         <AlertCircle className="w-4 h-4" />}
                                                    </div>
                                                    <div>
                                                        <p className="font-medium">充值申请</p>
                                                        <p className="text-xs text-gray-500">{request.provider?.username || '服务商'} · {request.createdAt || request.created_at ? new Date(request.createdAt || request.created_at).toLocaleString('zh-CN') : ''}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-green-600">+{request.amount?.toLocaleString() || 0}</span>
                                                    <Badge className={
                                                        request.status === 'pending' ? 'bg-yellow-100 text-yellow-700 text-xs' :
                                                        request.status === 'approved' ? 'bg-green-100 text-green-700 text-xs' :
                                                        'bg-red-100 text-red-700 text-xs'
                                                    }>
                                                        {request.status === 'pending' ? '待确认' :
                                                         request.status === 'approved' ? '已通过' : '已拒绝'}
                                                    </Badge>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {/* 交易明细 */}
                        <Card>
                            <CardHeader className="pb-2">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <History className="w-5 h-5" />
                                        交易明细
                                    </CardTitle>
                                    <div className="flex gap-1 md:gap-2 flex-wrap">
                                        <Button
                                            size="sm"
                                            variant={energyRecordFilter === 'all' ? 'default' : 'outline'}
                                            onClick={() => setEnergyRecordFilter('all')}
                                            className={`text-xs ${energyRecordFilter === 'all' ? 'bg-green-600' : ''}`}
                                        >
                                            全部
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant={energyRecordFilter === 'transfer_in' ? 'default' : 'outline'}
                                            onClick={() => setEnergyRecordFilter('transfer_in')}
                                            className={`text-xs ${energyRecordFilter === 'transfer_in' ? 'bg-blue-600' : ''}`}
                                        >
                                            转入
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant={energyRecordFilter === 'transfer_out' ? 'default' : 'outline'}
                                            onClick={() => setEnergyRecordFilter('transfer_out')}
                                            className={`text-xs ${energyRecordFilter === 'transfer_out' ? 'bg-orange-600' : ''}`}
                                        >
                                            转出
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant={energyRecordFilter === 'consume' ? 'default' : 'outline'}
                                            onClick={() => setEnergyRecordFilter('consume')}
                                            className={`text-xs ${energyRecordFilter === 'consume' ? 'bg-red-600' : ''}`}
                                        >
                                            市场费
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant={energyRecordFilter === 'recharge' ? 'default' : 'outline'}
                                            onClick={() => setEnergyRecordFilter('recharge')}
                                            className={`text-xs ${energyRecordFilter === 'recharge' ? 'bg-green-600' : ''}`}
                                        >
                                            充值
                                        </Button>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                {energyRecordsLoading ? (
                                    <div className="flex justify-center py-8">
                                        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {energyRecords.length > 0 ? (
                                            energyRecords
                                                .filter(record => energyRecordFilter === 'all' || record.recordType === energyRecordFilter)
                                                .map(record => (
                                                    <div key={record.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                                                        <div className="flex items-center gap-3">
                                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                                                ['recharge', 'transfer_in', 'convert_from_balance'].includes(record.recordType || '') ? 'bg-green-100 text-green-600' :
                                                                ['transfer_out', 'consume', 'market_transfer', 'purchase', 'withdraw'].includes(record.recordType || '') ? 'bg-red-100 text-red-600' :
                                                                'bg-orange-100 text-orange-600'
                                                            }`}>
                                                                {['recharge', 'transfer_in', 'convert_from_balance'].includes(record.recordType || '') ? (
                                                                    <ArrowDownCircle className="w-5 h-5" />
                                                                ) : ['transfer_out', 'consume', 'market_transfer', 'purchase', 'withdraw'].includes(record.recordType || '') ? (
                                                                    <ArrowUpCircle className="w-5 h-5" />
                                                                ) : (
                                                                    <TrendingDown className="w-5 h-5" />
                                                                )}
                                                            </div>
                                                            <div>
                                                                <p className="font-medium">
                                                                    {record.recordType === 'recharge' ? '能量值充值' :
                                                                     record.recordType === 'transfer_in' ? '能量值转入' :
                                                                     record.recordType === 'convert_from_balance' ? '收益转能量值' :
                                                                     record.recordType === 'consume' ? '市场费消耗' :
                                                                     record.recordType === 'market_transfer' ? '市场费支付' :
                                                                     record.recordType === 'purchase' ? '购买产品支付' :
                                                                     record.recordType === 'withdraw' ? '能量值变现' :
                                                                     '能量值转出'}
                                                                </p>
                                                                <p className="text-sm text-gray-500">
                                                                    {record.description || (record.recordType === 'recharge' ? '服务商充值能量值' : 
                                                                        record.recordType === 'transfer_in' ? '从服务商转入' : 
                                                                        record.recordType === 'convert_from_balance' ? '收益余额转入能量值' :
                                                                        record.recordType === 'consume' ? '购买产品支付市场费' :
                                                                        record.recordType === 'market_transfer' ? '产品市场费' :
                                                                        record.recordType === 'purchase' ? '购买算力产品' :
                                                                        record.recordType === 'withdraw' ? '申请变现提现' :
                                                                        '转给服务商')}
                                                                </p>
                                                                <p className="text-xs text-gray-400 mt-1">
                                                                    {new Date(record.createdAt || record.created_at || '').toLocaleString('zh-CN')}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <p className={`text-lg font-bold ${
                                                                ['transfer_out', 'consume', 'market_transfer', 'purchase', 'withdraw'].includes(record.recordType || '') ? 'text-red-600' : 'text-green-600'
                                                            }`}>
                                                                {['transfer_out', 'consume', 'market_transfer', 'purchase', 'withdraw'].includes(record.recordType || '') ? '-' : '+'}{record.amount?.toLocaleString() || 0}
                                                            </p>
                                                            <Badge className={
                                                                record.status === 'completed' ? 'bg-green-100 text-green-700' :
                                                                record.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                                                                'bg-gray-100 text-gray-700'
                                                            }>
                                                                {record.status === 'completed' ? '已完成' :
                                                                 record.status === 'pending' ? '处理中' : record.status}
                                                            </Badge>
                                                        </div>
                                                    </div>
                                                ))
                                        ) : (
                                            <div className="text-center py-12">
                                                <History className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                                                <p className="text-gray-500">暂无能量值记录</p>
                                                <p className="text-sm text-gray-400 mt-1">请联系服务商充值能量值</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>}

                    {/* 消息通知 Tab */}
                    {activeTab === "notifications" && <Card>
                        <CardHeader>
                            <CardTitle>消息通知</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3">
                                {notifications.map(n => <div
                                    key={n.id}
                                    className={`p-4 border rounded-lg ${n.is_read ? "bg-gray-50" : "bg-blue-50 border-blue-200"}`}>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h4 className="font-medium">{n.title}</h4>
                                            <p className="text-sm text-gray-600 mt-1">{n.content}</p>
                                            {n.amount && <p className="text-sm text-green-600 mt-1">金额: ¥{n.amount.toLocaleString()}</p>}
                                        </div>
                                        <span className="text-xs text-gray-500">{n.created_at?.slice(0, 10)}</span>
                                    </div>
                                </div>)}
                                {notifications.length === 0 && <div className="text-center py-8 text-gray-500">暂无消息通知
                                                        </div>}
                            </div>
                        </CardContent>
                    </Card>}

                    {/* 我的收益 Tab */}
                    {activeTab === "profit" && (
                        <div className="space-y-3 md:space-y-6">
                            {/* 收益统计卡片 */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <Card className="bg-gradient-to-br from-green-500 to-emerald-600 text-white">
                                    <CardContent className="pt-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Wallet className="w-5 h-5" />
                                            <span className="text-sm opacity-80">累计本金</span>
                                        </div>
                                        <p className="text-2xl font-bold">{profitStats.totalPrincipal?.toLocaleString() || 0}</p>
                                    </CardContent>
                                </Card>
                                <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                                    <CardContent className="pt-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <TrendingUp className="w-5 h-5" />
                                            <span className="text-sm opacity-80">累计收益</span>
                                        </div>
                                        <p className="text-2xl font-bold">{profitStats.totalProfit?.toLocaleString() || 0}</p>
                                    </CardContent>
                                </Card>
                                <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
                                    <CardContent className="pt-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Zap className="w-5 h-5" />
                                            <span className="text-sm opacity-80">已转能量值</span>
                                        </div>
                                        <p className="text-2xl font-bold">{profitStats.converted?.toLocaleString() || 0}</p>
                                    </CardContent>
                                </Card>
                                <Card className="bg-gradient-to-br from-amber-500 to-orange-600 text-white">
                                    <CardContent className="pt-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Coins className="w-5 h-5" />
                                            <span className="text-sm opacity-80">可转能量值</span>
                                        </div>
                                        <p className="text-2xl font-bold">{profitStats.available?.toLocaleString() || 0}</p>
                                        {Number(profitStats.available) > 0 && (
                                            <Button
                                                size="sm"
                                                className="mt-2 w-full bg-white/20 hover:bg-white/30 text-white border-0"
                                                onClick={() => {
                                                    setConvertAmount(profitStats.available?.toString() || "0");
                                                    setShowProfitConvertDialog(true);
                                                }}
                                            >
                                                <Zap className="w-4 h-4 mr-1" />
                                                转为能量值
                                            </Button>
                                        )}
                                    </CardContent>
                                </Card>
                            </div>

                            {/* 收益说明 */}
                            <Card className="bg-slate-800/50 border-slate-700">
                                <CardContent className="pt-4">
                                    <p className="text-sm text-gray-400 text-center">
                                        产品到期卖出后，本金和收益将进入您的收益账户，可随时转为能量值用于购买更多产品
                                    </p>
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
                                    {profitRecords.length > 0 ? (
                                        <div className="space-y-3">
                                            {profitRecords.map((record: any) => (
                                                <div key={record.id} className="border rounded-lg p-4 bg-slate-50">
                                                    <div className="flex justify-between items-start">
                                                        <div>
                                                            <p className="font-medium">
                                                                本金: ¥{Number(record.principal || 0).toLocaleString()} | 
                                                                收益: ¥{Number(record.profit || 0).toLocaleString()}
                                                            </p>
                                                            <p className="text-sm text-gray-500">
                                                                总计: ¥{Number(record.total_amount || 0).toLocaleString()}
                                                            </p>
                                                            <p className="text-xs text-gray-400 mt-1">
                                                                {new Date(record.createdAt || record.created_at).toLocaleString('zh-CN')}
                                                            </p>
                                                        </div>
                                                        <Badge variant={record.status === 'pending' ? 'secondary' : 'default'}>
                                                            {record.status === 'pending' ? '待处理' : record.status === 'converted' ? '已转能量值' : '已提现'}
                                                        </Badge>
                                                    </div>
                                                    {Number(record.converted_to_energy) > 0 && (
                                                        <p className="text-xs text-green-600 mt-2">
                                                            已转能量值: {Number(record.converted_to_energy).toLocaleString()}
                                                        </p>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-center py-8 text-gray-500">
                                            <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                            <p>暂无收益记录</p>
                                            <p className="text-sm mt-1">购买产品到期后将获得收益</p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* 收益明细 */}
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <FileText className="w-5 h-5" />
                                        收益明细
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {/* 筛选标签 */}
                                    <div className="flex gap-2 mb-4 flex-wrap">
                                        <Button
                                            size="sm"
                                            variant={profitDetailFilter === 'all' ? "default" : "outline"}
                                            onClick={() => setProfitDetailFilter('all')}
                                        >
                                            全部
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant={profitDetailFilter === 'profit_in' ? "default" : "outline"}
                                            onClick={() => setProfitDetailFilter('profit_in')}
                                        >
                                            收益入账
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant={profitDetailFilter === 'convert_to_energy' ? "default" : "outline"}
                                            onClick={() => setProfitDetailFilter('convert_to_energy')}
                                        >
                                            转能量值
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant={profitDetailFilter === 'withdraw' ? "default" : "outline"}
                                            onClick={() => setProfitDetailFilter('withdraw')}
                                        >
                                            提现
                                        </Button>
                                    </div>

                                    {/* 收益明细统计 */}
                                    {profitDetailsStats && (
                                        <div className="grid grid-cols-3 gap-2 mb-4">
                                            <div className="bg-green-50 rounded-lg p-2 text-center">
                                                <p className="text-xs text-green-600">累计入账</p>
                                                <p className="font-bold text-green-600">{Number(profitDetailsStats.totalIn || 0).toLocaleString()}</p>
                                            </div>
                                            <div className="bg-purple-50 rounded-lg p-2 text-center">
                                                <p className="text-xs text-purple-600">转能量值</p>
                                                <p className="font-bold text-purple-600">{Number(profitDetailsStats.totalConvert || 0).toLocaleString()}</p>
                                            </div>
                                            <div className="bg-amber-50 rounded-lg p-2 text-center">
                                                <p className="text-xs text-amber-600">已提现</p>
                                                <p className="font-bold text-amber-600">{Number(profitDetailsStats.totalWithdraw || 0).toLocaleString()}</p>
                                            </div>
                                        </div>
                                    )}

                                    {profitDetails.length > 0 ? (
                                        <div className="space-y-3 max-h-96 overflow-y-auto">
                                            {profitDetails
                                                .filter((d: any) => profitDetailFilter === 'all' || d.type === profitDetailFilter)
                                                .map((detail: any) => (
                                                    <div key={detail.id} className="border rounded-lg p-3 bg-slate-50">
                                                        <div className="flex justify-between items-start">
                                                            <div>
                                                                <p className="font-medium flex items-center gap-2">
                                                                    {detail.type === 'profit_in' && <ArrowDownCircle className="w-4 h-4 text-green-500" />}
                                                                    {detail.type === 'convert_to_energy' && <Zap className="w-4 h-4 text-purple-500" />}
                                                                    {detail.type === 'withdraw' && <ArrowUpCircle className="w-4 h-4 text-amber-500" />}
                                                                    {detail.type === 'profit_in' ? '收益入账' : 
                                                                     detail.type === 'convert_to_energy' ? '转为能量值' : 
                                                                     detail.type === 'withdraw' ? '收益提现' : detail.type}
                                                                </p>
                                                                <p className="text-sm text-gray-500">
                                                                    余额: {Number(detail.balance_after || 0).toLocaleString()}
                                                                </p>
                                                                <p className="text-xs text-gray-400 mt-1">
                                                                    {new Date(detail.createdAt || detail.created_at).toLocaleString('zh-CN')}
                                                                </p>
                                                            </div>
                                                            <div className="text-right">
                                                                <p className={`font-bold ${detail.type === 'profit_in' ? 'text-green-600' : 'text-purple-600'}`}>
                                                                    {detail.type === 'profit_in' ? '+' : '-'}
                                                                    {Number(detail.amount || 0).toLocaleString()}
                                                                </p>
                                                                {detail.description && (
                                                                    <p className="text-xs text-gray-400 mt-1">{detail.description}</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                        </div>
                                    ) : (
                                        <div className="text-center py-8 text-gray-500">
                                            <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                            <p>暂无收益明细</p>
                                            <p className="text-sm mt-1">收益变动将在这里记录</p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                            {/* 提现功能 */}
                            <Card>
                                <CardHeader className="pb-3">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="flex items-center gap-2 text-base">
                                            <Banknote className="w-5 h-5 text-rose-500" />
                                            收益提现
                                        </CardTitle>
                                        <span className="text-xs text-muted-foreground">
                                            可提现: ¥{Number(user?.balance || 0).toLocaleString()}
                                        </span>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-sm text-muted-foreground mb-1 block">提现金额</label>
                                            <Input
                                                type="number"
                                                placeholder="请输入提现金额（最低50元）"
                                                value={withdrawAmount}
                                                onChange={e => setWithdrawAmount(e.target.value)}
                                                min="50"
                                                max={user?.balance || 0}
                                            />
                                            <p className="text-xs text-muted-foreground mt-1">
                                                可提现余额: ¥{Number(user?.balance || 0).toLocaleString()}
                                                {Number(withdrawAmount) > 0 && (
                                                    <span className="ml-3">
                                                        手续费(5%): ¥{(Number(withdrawAmount) * 0.05).toFixed(2)}
                                                        ，实际到账: ¥{(Number(withdrawAmount) * 0.95).toFixed(2)}
                                                    </span>
                                                )}
                                            </p>
                                        </div>
                                        <div>
                                            <label className="text-sm text-muted-foreground mb-1 block">支付宝账号</label>
                                            <Input
                                                placeholder="请输入支付宝账号"
                                                value={withdrawAlipay}
                                                onChange={e => setWithdrawAlipay(e.target.value)}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-sm text-muted-foreground mb-1 block">真实姓名</label>
                                            <Input
                                                placeholder="请输入真实姓名（需与支付宝一致）"
                                                value={withdrawRealName}
                                                onChange={e => setWithdrawRealName(e.target.value)}
                                            />
                                        </div>
                                        <Button
                                            className="w-full bg-rose-500 hover:bg-rose-600"
                                            disabled={!withdrawAmount || Number(withdrawAmount) < 50 || !withdrawAlipay || !withdrawRealName}
                                            onClick={handleWithdraw}
                                        >
                                            提交提现申请
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* 提现记录 */}
                            <Card>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base">提现记录</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {withdrawRecords.length > 0 ? (
                                        <div className="space-y-3">
                                            {withdrawRecords.map((record: any) => (
                                                <div key={record.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <Banknote className="w-4 h-4 text-rose-500" />
                                                            <span className="font-medium">¥{Number(record.amount).toLocaleString()}</span>
                                                            <Badge variant={
                                                                record.status === 'completed' ? 'default' :
                                                                record.status === 'rejected' ? 'destructive' :
                                                                record.status === 'approved' ? 'secondary' :
                                                                record.status === 'transferred' ? 'outline' :
                                                                'outline'
                                                            }>
                                                                {record.status === 'pending' ? '待审核' :
                                                                 record.status === 'approved' ? '已审核' :
                                                                 record.status === 'transferred' ? '已打款待确认' :
                                                                 record.status === 'completed' ? '已完成' :
                                                                 record.status === 'rejected' ? '已拒绝' : record.status}
                                                            </Badge>
                                                            {record.status === 'transferred' && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="text-xs h-6"
                                                                    onClick={async () => {
                                                                        const res = await fetch('/api/member/withdraw', {
                                                                            method: 'POST',
                                                                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                                                                            body: JSON.stringify({ withdrawalId: record.id, action: 'confirm_receipt' })
                                                                        });
                                                                        const data = await res.json();
                                                                        if (data.success) {
                                                                            alert('已确认收款');
                                                                            refreshAll();
                                                                        } else {
                                                                            alert(data.error || '操作失败');
                                                                        }
                                                                    }}
                                                                >
                                                                    确认收款
                                                                </Button>
                                                            )}
                                                        </div>
                                                        <p className="text-xs text-muted-foreground mt-1">
                                                            实际到账: ¥{Number(record.actual_amount).toLocaleString()} | 手续费: ¥{Number(record.fee).toLocaleString()}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground">
                                                            支付宝: {record.alipay_account} | {record.real_name}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground">
                                                            {new Date(record.createdAt || record.created_at).toLocaleString('zh-CN')}
                                                        </p>
                                                        {record.reject_reason && (
                                                            <p className="text-xs text-red-500 mt-1">拒绝原因: {record.reject_reason}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-center py-8 text-gray-500">
                                            <Banknote className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                            <p>暂无提现记录</p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* 积分 Tab */}
                    {activeTab === "points" && <div className="space-y-3 md:space-y-6">
                        <Card className="bg-gradient-to-br from-amber-500 to-amber-600 text-white">
                            <CardContent className="pt-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Gift className="w-5 h-5" />
                                    <span className="text-sm opacity-80">我的积分</span>
                                </div>
                                <p className="text-3xl font-bold">{Number(user?.points || 0).toLocaleString()}</p>
                                <span className="text-xs opacity-70 mt-1">收益转能量值时，5%自动转为积分，积分可兑换产品</span>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">积分记录</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {pointsRecords.length > 0 ? (
                                    <div className="space-y-3">
                                        {pointsRecords.map((record: any) => (
                                            <div key={record.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                                                <div className="flex items-center gap-3">
                                                    <Gift className="w-4 h-4 text-amber-500" />
                                                    <div>
                                                        <span className="font-medium text-amber-600">
                                                            +{Number(record.amount).toLocaleString()}
                                                        </span>
                                                        <p className="text-xs text-muted-foreground">{record.note || '收益转能量值产生'}</p>
                                                    </div>
                                                </div>
                                                <p className="text-xs text-muted-foreground">
                                                    {new Date(record.createdAt || record.created_at).toLocaleString('zh-CN')}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center py-8 text-gray-500">
                                        <Gift className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                        <p>暂无积分记录</p>
                                        <p className="text-sm mt-1">收益转能量值时自动产生积分</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>}

                    {/* 充值申请 Tab */}
                    {activeTab === "recharge" && <div className="space-y-3 md:space-y-6">
                        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
                            <CardContent className="pt-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Zap className="w-5 h-5" />
                                    <span className="text-sm opacity-80">充值申请记录</span>
                                </div>
                                <p className="text-xs opacity-70 mt-1">线下向服务商付款后，等待服务商确认充值</p>
                            </CardContent>
                        </Card>

                        {/* 充值申请列表 */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <History className="w-5 h-5" />
                                    申请记录
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {rechargeRequests.length > 0 ? (
                                        rechargeRequests.map((request) => (
                                            <div 
                                                key={request.id}
                                                className={`p-4 border rounded-lg ${
                                                    request.status === 'pending' ? 'bg-yellow-50 border-yellow-200' :
                                                    request.status === 'approved' ? 'bg-green-50 border-green-200' :
                                                    'bg-red-50 border-red-200'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                                                            request.status === 'pending' ? 'bg-yellow-100 text-yellow-600' :
                                                            request.status === 'approved' ? 'bg-green-100 text-green-600' :
                                                            'bg-red-100 text-red-600'
                                                        }`}>
                                                            {request.status === 'pending' ? (
                                                                <Clock className="w-6 h-6" />
                                                            ) : request.status === 'approved' ? (
                                                                <CheckCircle className="w-6 h-6" />
                                                            ) : (
                                                                <AlertCircle className="w-6 h-6" />
                                                            )}
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-gray-900">
                                                                充值申请
                                                            </p>
                                                            <p className="text-sm text-gray-500">
                                                                {request.provider?.username || '服务商'} · {request.provider?.phone || ''}
                                                            </p>
                                                            <p className="text-xs text-gray-400 mt-1">
                                                                {request.createdAt || request.created_at ? new Date(request.createdAt || request.created_at).toLocaleString('zh-CN') : ''}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-2xl font-bold text-orange-600">
                                                            +{request.amount?.toLocaleString() || 0}
                                                        </p>
                                                        <Badge className={
                                                            request.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                                                            request.status === 'approved' ? 'bg-green-100 text-green-700' :
                                                            'bg-red-100 text-red-700'
                                                        }>
                                                            {request.status === 'pending' ? '待确认' :
                                                             request.status === 'approved' ? '已通过' : '已拒绝'}
                                                        </Badge>
                                                    </div>
                                                </div>
                                                {request.status === 'pending' && (
                                                    <div className="mt-3 pt-3 border-t border-yellow-200">
                                                        <div className="flex items-center gap-2 text-sm text-yellow-700">
                                                            <AlertCircle className="w-4 h-4" />
                                                            <span>请线下向服务商付款，付款后联系服务商确认充值</span>
                                                        </div>
                                                    </div>
                                                )}
                                                {request.note && (
                                                    <div className="mt-2 text-sm text-gray-500">
                                                        备注：{request.note}
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-center py-12">
                                            <Zap className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                                            <p className="text-gray-500">暂无充值申请记录</p>
                                            <p className="text-sm text-gray-400 mt-1">点击上方"充值"按钮发起充值申请</p>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        {/* 充值流程说明 */}
                        <Card className="bg-blue-50 border-blue-200">
                            <CardContent className="py-4">
                                <h4 className="font-medium text-blue-900 mb-2">充值流程</h4>
                                <ol className="text-sm text-blue-700 space-y-1">
                                    <li>1. 点击上方"充值"按钮，填写充值金额</li>
                                    <li>2. 系统生成充值申请，等待服务商审核</li>
                                    <li>3. <strong>线下</strong>向服务商付款（支付宝/微信/银行转账）</li>
                                    <li>4. 服务商确认收款后，能量值自动到账</li>
                                </ol>
                            </CardContent>
                        </Card>
                    </div>}
                </div>

            </main>
        </div>
    );
}