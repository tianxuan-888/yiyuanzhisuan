'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, RefreshCw, Building2, Users, Zap, TrendingUp, ArrowLeft, ChevronRight, Database } from 'lucide-react';
import { BranchDetailView } from './BranchDetailView';

// 合并状态类型
interface BranchesState {
  branchesData: { branches: any[]; summary: any };
  loading: boolean;
  searchTerm: string;
  selectedBranch: any | null;
  activeTab: string;
}

interface ProviderSummary {
  totalQuota: number;
  usedQuota: number;
  availableQuota: number;
  totalSoldProducts: number;
  totalSoldAmount: number;
}

interface BranchStats {
  branchCount: number;
  quotaApplied: number;
  quotaTotal: number;
  quotaUsed: number;
  quotaAvailable: number;
  providerQuotaTotal: number;
  providerQuotaUsed: number;
  providerQuotaAvailable: number;
  energyBalance: number;
  energyBranchBalance: number;
  energyProviderBalance: number;
  energyMemberBalance: number;
  providerCount: number;
  totalUserCount: number;
  providerUserCount: number;
  memberUserCount: number;
  energyQuota: number;
  totalProductRevenue: number;
  productOrderCount: number;
  providerSummary: ProviderSummary;
}

interface BranchData {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  stats: BranchStats;
}

interface BranchSummary {
  totalBranches: number;
  totalQuotaApplied: number;
  totalEnergyBalance: number;
  totalEnergyBranchBalance: number;
  totalEnergyProviderBalance: number;
  totalEnergyMemberBalance: number;
  totalProviders: number;
  totalUsers: number;
  totalProductRevenue: number;
  totalQuotaAvailable: number;
  totalQuota: number;
  totalProviderQuota: number;
  totalSoldProducts: number;
}

export function BranchesManagement() {
  const [state, setState] = useState<BranchesState>({
    branchesData: { branches: [], summary: {} },
    loading: true,
    searchTerm: '',
    selectedBranch: null,
    activeTab: 'overview'
  });

  const { branchesData, loading, searchTerm, selectedBranch, activeTab } = state;
  const setBranchesData = (data: any) => setState(s => ({ ...s, branchesData: data }));
  const setLoading = (v: boolean) => setState(s => ({ ...s, loading: v }));
  const setSearchTerm = (v: string) => setState(s => ({ ...s, searchTerm: v }));
  const setSelectedBranch = (v: any) => setState(s => ({ ...s, selectedBranch: v }));
  const setActiveTab = (v: string) => setState(s => ({ ...s, activeTab: v }));

  useEffect(() => {
    loadBranchesData();
  }, []);

  const loadBranchesData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch('/api/admin/branch-management?includeProviders=true', { headers });
      const result = await response.json();
      if (result.success) {
        setBranchesData(result.data as { branches: BranchData[]; summary: BranchSummary });
      }
    } catch (error) {
      console.error('加载服务网点数据失败:', error);
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

  const formatMoney = (amount: number | string | undefined | null) => {
    const num = Number(amount) || 0;
    return '¥' + num.toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
      </div>
    );
  }

  // 如果选择了服务网点，显示详情
  if (selectedBranch) {
    return (
      <BranchDetailView 
        branchId={selectedBranch.id} 
        branchName={selectedBranch.name}
        onBack={() => setSelectedBranch(null)} 
      />
    );
  }

  const branches = branchesData?.branches || [];
  const summary = branchesData?.summary || {} as BranchSummary;

  // 过滤分支
  const filteredBranches = searchTerm
    ? branches.filter((b: BranchData) => 
        b.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.phone.includes(searchTerm)
      )
    : branches;

  return (
    <div className="space-y-6">
      {/* 核心统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">服务网点数量</p>
                <p className="text-2xl font-bold mt-1">{summary.totalBranches || 0}</p>
              </div>
              <Building2 className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">服务商数量</p>
                <p className="text-2xl font-bold mt-1">{summary.totalProviders || 0}</p>
              </div>
              <Users className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">算力额度</p>
                <p className="text-2xl font-bold mt-1">{formatEnergy(summary.totalQuota)}</p>
              </div>
              <Zap className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">能量值额度</p>
                <p className="text-2xl font-bold mt-1">{formatEnergy(summary.totalEnergyBalance)}</p>
                <p className="text-xs opacity-70 mt-1">
                  服务网点: {formatEnergy(summary.totalEnergyBranchBalance)} | 服务商: {formatEnergy(summary.totalEnergyProviderBalance)} | 会员: {formatEnergy(summary.totalEnergyMemberBalance)}
                </p>
              </div>
              <Zap className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">已售产品</p>
                <p className="text-2xl font-bold mt-1">{summary.totalSoldProducts || 0}</p>
              </div>
              <TrendingUp className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-cyan-500 to-cyan-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">销售总额</p>
                <p className="text-2xl font-bold mt-1">{formatMoney(summary.totalProductRevenue ?? 0)}</p>
              </div>
              <Database className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tab切换 */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">概览视图</TabsTrigger>
          <TabsTrigger value="detail">详情列表</TabsTrigger>
        </TabsList>

        {/* 概览视图 */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredBranches.length === 0 ? (
              <div className="col-span-full text-center py-8 text-gray-500">
                暂无服务网点数据
              </div>
            ) : (
              filteredBranches.map((branch: BranchData) => (
                <Card 
                  key={branch.id} 
                  className="cursor-pointer hover:shadow-lg transition-shadow"
                  onClick={() => setSelectedBranch(branch)}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-purple-600" />
                        {branch.name}
                      </div>
                      <ChevronRight className="w-5 h-5 text-gray-400" />
                    </CardTitle>
                    <p className="text-sm text-gray-500">{branch.phone}</p>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-blue-50 rounded-lg p-3">
                        <div className="text-xs text-gray-500">服务网点额度</div>
                        <div className="text-lg font-bold text-blue-600">{formatEnergy(branch.stats.quotaTotal)}</div>
                      </div>
                      <div className="bg-indigo-50 rounded-lg p-3">
                        <div className="text-xs text-gray-500">能量值额度</div>
                        <div className="text-lg font-bold text-indigo-600">{formatEnergy(branch.stats.energyBalance)}</div>
                      </div>
                      <div className="bg-purple-50 rounded-lg p-3">
                        <div className="text-xs text-gray-500">服务商</div>
                        <div className="text-lg font-bold text-purple-600">{branch.stats.providerCount}</div>
                      </div>
                      <div className="bg-green-50 rounded-lg p-3">
                        <div className="text-xs text-gray-500">会员</div>
                        <div className="text-lg font-bold text-green-600">{branch.stats.memberUserCount}</div>
                      </div>
                      <div className="bg-orange-50 rounded-lg p-3 col-span-2">
                        <div className="text-xs text-gray-500">销售额</div>
                        <div className="text-lg font-bold text-orange-600">{formatMoney(branch.stats.totalProductRevenue ?? 0)}</div>
                      </div>
                    </div>

                    {/* 能量值分布 */}
                    <div className="mt-3 pt-3 border-t">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>能量值分布</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="bg-blue-50 rounded p-2 text-center">
                          <div className="text-gray-500">服务网点</div>
                          <div className="font-medium text-blue-600">{formatEnergy(branch.stats.energyBranchBalance || 0)}</div>
                        </div>
                        <div className="bg-purple-50 rounded p-2 text-center">
                          <div className="text-gray-500">服务商</div>
                          <div className="font-medium text-purple-600">{formatEnergy(branch.stats.energyProviderBalance || 0)}</div>
                        </div>
                        <div className="bg-green-50 rounded p-2 text-center">
                          <div className="text-gray-500">会员</div>
                          <div className="font-medium text-green-600">{formatEnergy(branch.stats.energyMemberBalance || 0)}</div>
                        </div>
                      </div>
                    </div>

                    {/* 服务网点额度使用进度 */}
                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>服务网点额度使用</span>
                        <span>{branch.stats.quotaTotal > 0 ? ((branch.stats.quotaUsed / branch.stats.quotaTotal) * 100).toFixed(0) : 0}%</span>
                      </div>
                      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"
                          style={{ width: `${branch.stats.quotaTotal > 0 ? Math.min((branch.stats.quotaUsed / branch.stats.quotaTotal) * 100, 100) : 0}%` }}
                        />
                      </div>
                    </div>

                    {/* 已售产品和销售额 */}
                    <div className="mt-3 pt-3 border-t">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">已售产品:</span>
                        <span className="font-medium">{branch.stats.providerSummary?.totalSoldProducts || 0}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* 详情列表 */}
        <TabsContent value="detail">
          {/* 搜索和操作 */}
          <div className="flex gap-4 items-center mb-4">
            <Input
              placeholder="搜索服务网点名称或手机号..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm"
            />
            <Button variant="outline" onClick={loadBranchesData}>
              <RefreshCw className="w-4 h-4 mr-2" />
              刷新
            </Button>
          </div>

          {/* 数据表格 */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>服务网点</TableHead>
                      <TableHead className="text-right">算力额度</TableHead>
                      <TableHead className="text-right">已分配</TableHead>
                      <TableHead className="text-right">服务商</TableHead>
                      <TableHead className="text-right">能量值额度</TableHead>
                      <TableHead className="text-right">已售产品</TableHead>
                      <TableHead className="text-right">会员</TableHead>
                      <TableHead className="text-right">销售额</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBranches.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                          暂无数据
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredBranches.map((branch: BranchData) => (
                        <TableRow 
                          key={branch.id} 
                          className="cursor-pointer hover:bg-slate-50 transition-colors"
                          onClick={() => setSelectedBranch(branch)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Building2 className="w-4 h-4 text-purple-600" />
                              <div>
                                <div className="font-medium">{branch.name}</div>
                                <div className="text-xs text-gray-500">{branch.phone}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="text-blue-600 font-medium">{formatEnergy(branch.stats.quotaTotal)}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="text-orange-600">{formatEnergy(branch.stats.quotaUsed)}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline">{branch.stats.providerCount}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="text-purple-600 font-medium">{formatEnergy(branch.stats.energyBalance)}</div>
                            <div className="text-xs text-gray-400">
                              分: {formatEnergy(branch.stats.energyBranchBalance || 0)} / 商: {formatEnergy(branch.stats.energyProviderBalance || 0)} / 会: {formatEnergy(branch.stats.energyMemberBalance || 0)}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="secondary">{branch.stats.providerSummary.totalSoldProducts}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline">{branch.stats.memberUserCount}</Badge>
                          </TableCell>
                          <TableCell className="text-right text-green-600 font-medium">
                            {formatMoney(branch.stats.totalProductRevenue ?? 0)}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => setSelectedBranch(branch)}
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
