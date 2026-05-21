'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, RefreshCw, Users, Zap, TrendingUp, Wallet, Package, ArrowLeft } from 'lucide-react';

// 服务商数据类型
interface ProviderData {
  id: string;
  name: string;
  phone: string;
  branchName?: string;
  account?: {
    energyBalance: number;
  };
  quota?: {
    available: number;
  };
  stats?: {
    memberCount: number;
    totalSales: number;
  };
}

// 合并状态类型
interface ProviderState {
  providersData: { providers: any[]; summary: any } | null;
  loading: boolean;
  searchTerm: string;
  selectedProvider: any | null;
  activeTab: string;
}

interface Props {
  branchId?: string;
  onBack?: () => void;
}

export function ProviderManagement({ branchId, onBack }: Props) {
  const [state, setState] = useState<ProviderState>({
    providersData: null,
    loading: true,
    searchTerm: '',
    selectedProvider: null,
    activeTab: 'overview'
  });

  const { providersData, loading, searchTerm, selectedProvider, activeTab } = state;
  const setProvidersData = (data: any) => setState(s => ({ ...s, providersData: data }));
  const setLoading = (v: boolean) => setState(s => ({ ...s, loading: v }));
  const setSearchTerm = (v: string) => setState(s => ({ ...s, searchTerm: v }));
  const setSelectedProvider = (v: any) => setState(s => ({ ...s, selectedProvider: v }));
  const setActiveTab = (v: string) => setState(s => ({ ...s, activeTab: v }));

  useEffect(() => {
    loadProvidersData();
  }, [branchId]);

  const loadProvidersData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const url = branchId 
        ? `/api/admin/provider-management?branchId=${branchId}` 
        : '/api/admin/provider-management';
      const response = await fetch(url, { headers });
      const result = await response.json();
      if (result.success) {
        setProvidersData(result.data);
      }
    } catch (error) {
      console.error('加载服务商数据失败:', error);
    }
    setLoading(false);
  };

  const formatEnergy = (amount: number | string | undefined | null) => {
    const num = Number(amount) || 0;
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + '万';
    }
    return num.toLocaleString();
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
      </div>
    );
  }

  // 如果选择了服务商，显示详情
  if (selectedProvider) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => setSelectedProvider(null)}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回列表
          </Button>
          <h2 className="text-xl font-bold">服务商详情：{selectedProvider.name}</h2>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">总览</TabsTrigger>
            <TabsTrigger value="account">账户信息</TabsTrigger>
            <TabsTrigger value="performance">业绩统计</TabsTrigger>
            <TabsTrigger value="members">会员列表</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-gray-500">能量值余额</div>
                  <div className="text-2xl font-bold text-purple-600">
                    {formatEnergy(selectedProvider.account.energyBalance)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-gray-500">现金余额</div>
                  <div className="text-2xl font-bold text-green-600">
                    {formatEnergy(selectedProvider.account.cashBalance)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-gray-500">可用额度</div>
                  <div className="text-2xl font-bold text-blue-600">
                    {formatEnergy(selectedProvider.quota.available)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-gray-500">累计收益</div>
                  <div className="text-2xl font-bold text-orange-600">
                    {formatEnergy(selectedProvider.stats.totalProfit)}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="mt-4">
              <CardHeader>
                <CardTitle>基本信息</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-gray-500">服务商名称</div>
                    <div className="font-medium">{selectedProvider.name}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">真实姓名</div>
                    <div className="font-medium">{selectedProvider.realName}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">手机号</div>
                    <div className="font-medium">{selectedProvider.phone}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">所属服务网点</div>
                    <div className="font-medium">{selectedProvider.branchName}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">注册时间</div>
                    <div className="font-medium">{formatDate(selectedProvider.createdAt)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="account">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Zap className="w-5 h-5 text-purple-600" />
                    能量值账户
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-500">当前余额</span>
                      <span className="font-bold text-purple-600">
                        {formatEnergy(selectedProvider.account.energyBalance)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Wallet className="w-5 h-5 text-green-600" />
                    现金账户
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-500">当前余额</span>
                      <span className="font-bold text-green-600">
                        {formatEnergy(selectedProvider.account.cashBalance)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Package className="w-5 h-5 text-blue-600" />
                    算力额度
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-500">总额度</span>
                      <span className="font-bold">
                        {formatEnergy(selectedProvider.quota.total)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">已使用</span>
                      <span className="font-bold text-orange-600">
                        {formatEnergy(selectedProvider.quota.used)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">可用额度</span>
                      <span className="font-bold text-green-600">
                        {formatEnergy(selectedProvider.quota.available)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="performance">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                <CardContent className="pt-6">
                  <div className="text-sm opacity-80">累计销售额</div>
                  <div className="text-2xl font-bold">
                    {formatEnergy(selectedProvider.stats.totalSales)}
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
                <CardContent className="pt-6">
                  <div className="text-sm opacity-80">成交订单数</div>
                  <div className="text-2xl font-bold">
                    {selectedProvider.stats.orderCount}
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
                <CardContent className="pt-6">
                  <div className="text-sm opacity-80">直属会员</div>
                  <div className="text-2xl font-bold">
                    {selectedProvider.stats.memberCount}
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
                <CardContent className="pt-6">
                  <div className="text-sm opacity-80">下级服务商</div>
                  <div className="text-2xl font-bold">
                    {selectedProvider.stats.subProviderCount}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="mt-4">
              <CardHeader>
                <CardTitle>业绩统计</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <TrendingUp className="w-8 h-8 text-blue-600" />
                      <div>
                        <div className="font-medium">累计销售总额</div>
                        <div className="text-sm text-gray-500">所有已完成订单的金额总和</div>
                      </div>
                    </div>
                    <div className="text-2xl font-bold text-blue-600">
                      {formatEnergy(selectedProvider.stats.totalSales)}
                    </div>
                  </div>

                  <div className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Users className="w-8 h-8 text-purple-600" />
                      <div>
                        <div className="font-medium">体系总人数</div>
                        <div className="text-sm text-gray-500">服务商本人 + 直属会员 + 下级服务商</div>
                      </div>
                    </div>
                    <div className="text-2xl font-bold text-purple-600">
                      {selectedProvider.stats.totalUserCount} 人
                    </div>
                  </div>

                  <div className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Zap className="w-8 h-8 text-orange-600" />
                      <div>
                        <div className="font-medium">累计收益</div>
                        <div className="text-sm text-gray-500">从能量值流转中获得的收益</div>
                      </div>
                    </div>
                    <div className="text-2xl font-bold text-orange-600">
                      {formatEnergy(selectedProvider.stats.totalProfit)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="members">
            <Card>
              <CardHeader>
                <CardTitle>直属会员列表</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-gray-500">
                  会员详情功能开发中...
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  const providers = providersData?.providers || [];
  const summary = providersData?.summary || {};

  // 过滤服务商
  const filteredProviders = searchTerm
    ? providers.filter((p: ProviderData) => 
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.phone.includes(searchTerm)
      )
    : providers;

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">服务商总数</p>
                <p className="text-2xl font-bold">{summary.totalProviders || 0}</p>
              </div>
              <Users className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">会员总数</p>
                <p className="text-2xl font-bold">{summary.totalMembers || 0}</p>
              </div>
              <Users className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">能量值总额</p>
                <p className="text-2xl font-bold">{formatEnergy(summary.totalEnergyBalance)}</p>
              </div>
              <Zap className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">销售总额</p>
                <p className="text-2xl font-bold">{formatEnergy(summary.totalSales)}</p>
              </div>
              <TrendingUp className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 搜索和筛选 */}
      <div className="flex gap-4 items-center">
        {onBack && (
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回服务网点
          </Button>
        )}
        <Input
          placeholder="搜索服务商名称或手机号..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-sm"
        />
        <Button variant="outline" onClick={loadProvidersData}>
          <RefreshCw className="w-4 h-4 mr-2" />
          刷新
        </Button>
      </div>

      {/* 数据表格 */}
      <Card>
        <CardHeader>
          <CardTitle>服务商详情列表</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>服务商名称</TableHead>
                  <TableHead>联系方式</TableHead>
                  <TableHead>所属服务网点</TableHead>
                  <TableHead className="text-right">能量值</TableHead>
                  <TableHead className="text-right">可用额度</TableHead>
                  <TableHead className="text-right">会员数</TableHead>
                  <TableHead className="text-right">累计销售</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProviders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                      暂无数据
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProviders.map((provider: ProviderData) => (
                    <TableRow 
                      key={provider.id} 
                      className="cursor-pointer hover:bg-slate-50 transition-colors"
                      onClick={() => setSelectedProvider(provider)}
                    >
                      <TableCell className="font-medium">{provider.name}</TableCell>
                      <TableCell>{provider.phone}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{provider.branchName || '-'}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-purple-600">
                        {formatEnergy(provider.account?.energyBalance || 0)}
                      </TableCell>
                      <TableCell className="text-right text-blue-600">
                        {formatEnergy(provider.quota?.available || 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline">{provider.stats?.memberCount || 0}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-green-600">
                        {formatEnergy(provider.stats?.totalSales || 0)}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => setSelectedProvider(provider)}
                        >
                          查看详情
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
