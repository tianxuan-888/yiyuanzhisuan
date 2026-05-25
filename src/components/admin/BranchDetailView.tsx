'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, Building2, Users, Zap, Package, TrendingUp, ChevronRight } from 'lucide-react';

interface ProviderDetail {
  providerId: string;
  providerName: string;
  quota: number;
  usedQuota: number;
  availableQuota: number;
  totalSales: number;
  memberCount: number;
  soldProducts: number;
  soldAmount: number;
}

interface MemberDetail {
  memberId: string;
  memberName: string;
  totalPurchase: number;
  orderCount: number;
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
  totalProductRevenue: number;
  productOrderCount: number;
  providerSummary: {
    totalQuota: number;
    usedQuota: number;
    availableQuota: number;
    totalSoldProducts: number;
    totalSoldAmount: number;
  };
}

interface BranchDetail {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  stats: BranchStats;
  providers: ProviderDetail[];
  members: MemberDetail[];
}

interface BranchSummary {
  totalBranches: number;
  totalQuotaApplied: number;
  totalEnergyBalance: number;
  totalProviders: number;
  totalUsers: number;
  totalProductRevenue: number;
  totalQuotaAvailable: number;
  totalProviderQuota: number;
  totalSoldProducts: number;
}

interface Props {
  branchId: string;
  branchName: string;
  onBack: () => void;
}

export function BranchDetailView({ branchId, branchName, onBack }: Props) {
  const [branchData, setBranchData] = useState<BranchDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBranchDetail();
  }, [branchId]);

  const loadBranchDetail = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(`/api/admin/branch-management?branchId=${branchId}&includeProviders=true`, { headers });
      const result = await response.json();
      if (result.success && result.data.branches.length > 0) {
        setBranchData(result.data.branches[0]);
      }
    } catch (error) {
      console.error('加载服务网点详情失败:', error);
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

  if (!branchData) {
    return (
      <div className="text-center py-8 text-gray-500">
        未找到服务网点数据
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 返回按钮和标题 */}
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回列表
        </Button>
        <div>
          <h2 className="text-xl font-bold">{branchData.name}</h2>
          <p className="text-sm text-gray-500">服务网点详情</p>
        </div>
      </div>

      {/* 核心统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">算力额度</p>
                <p className="text-2xl font-bold mt-1">{formatEnergy(branchData.stats.quotaTotal)}</p>
                <p className="text-xs opacity-70 mt-1">已用: {formatEnergy(branchData.stats.quotaUsed)}</p>
              </div>
              <Zap className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">服务商</p>
                <p className="text-2xl font-bold mt-1">{branchData.stats.providerCount}</p>
                <p className="text-xs opacity-70 mt-1">收益额度: {formatEnergy(branchData.stats.providerQuotaTotal)}</p>
              </div>
              <Users className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">已售产品</p>
                <p className="text-2xl font-bold mt-1">{branchData.stats.providerSummary.totalSoldProducts}</p>
                <p className="text-xs opacity-70 mt-1">销售额: {formatMoney(branchData.stats.providerSummary.totalSoldAmount)}</p>
              </div>
              <TrendingUp className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">会员</p>
                <p className="text-2xl font-bold mt-1">{branchData.stats.memberUserCount}</p>
                <p className="text-xs opacity-70 mt-1">购买总额: {formatMoney(branchData.stats.totalProductRevenue)}</p>
              </div>
              <Users className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tab切换 */}
      <Tabs defaultValue="providers" className="space-y-4">
        <TabsList>
          <TabsTrigger value="providers">服务商详情</TabsTrigger>
          <TabsTrigger value="members">会员购买</TabsTrigger>
          <TabsTrigger value="overview">算力统计</TabsTrigger>
          <TabsTrigger value="energy">收益统计</TabsTrigger>
        </TabsList>

        {/* 服务商详情Tab */}
        <TabsContent value="providers">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-purple-600" />
                服务商列表
              </CardTitle>
            </CardHeader>
            <CardContent>
              {branchData.providers.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  暂无服务商数据
                </div>
              ) : (
                <div className="space-y-4">
                  {branchData.providers.map((provider) => (
                    <div key={provider.providerId} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                            <Users className="w-5 h-5 text-purple-600" />
                          </div>
                          <div>
                            <h3 className="font-medium">{provider.providerName}</h3>
                            <p className="text-sm text-gray-500">ID: {provider.providerId.slice(0, 8)}...</p>
                          </div>
                        </div>
                        <Badge variant="outline" className="bg-purple-50">
                          直属会员: {provider.memberCount}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div className="bg-blue-50 rounded-lg p-3">
                          <div className="text-xs text-gray-500">总额度</div>
                          <div className="text-lg font-bold text-blue-600">{formatEnergy(provider.quota)}</div>
                        </div>
                        <div className="bg-orange-50 rounded-lg p-3">
                          <div className="text-xs text-gray-500">已使用</div>
                          <div className="text-lg font-bold text-orange-600">{formatEnergy(provider.usedQuota)}</div>
                        </div>
                        <div className="bg-green-50 rounded-lg p-3">
                          <div className="text-xs text-gray-500">可用额度</div>
                          <div className="text-lg font-bold text-green-600">{formatEnergy(provider.availableQuota)}</div>
                        </div>
                        <div className="bg-purple-50 rounded-lg p-3">
                          <div className="text-xs text-gray-500">已售产品</div>
                          <div className="text-lg font-bold text-purple-600">{provider.soldProducts}</div>
                        </div>
                        <div className="bg-orange-50 rounded-lg p-3">
                          <div className="text-xs text-gray-500">销售金额</div>
                          <div className="text-lg font-bold text-orange-600">{formatMoney(provider.soldAmount)}</div>
                        </div>
                      </div>

                      {/* 额度使用进度条 */}
                      <div className="mt-4">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>额度使用</span>
                          <span>{provider.quota > 0 ? ((provider.usedQuota / provider.quota) * 100).toFixed(1) : 0}%</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all"
                            style={{ width: `${provider.quota > 0 ? Math.min((provider.usedQuota / provider.quota) * 100, 100) : 0}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 会员购买Tab */}
        <TabsContent value="members">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5 text-green-600" />
                会员购买情况
              </CardTitle>
            </CardHeader>
            <CardContent>
              {branchData.members.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  暂无会员购买数据
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>会员名称</TableHead>
                        <TableHead className="text-right">购买金额</TableHead>
                        <TableHead className="text-right">订单数量</TableHead>
                        <TableHead className="text-right">平均单价</TableHead>
                        <TableHead>状态</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {branchData.members.map((member) => (
                        <TableRow key={member.memberId}>
                          <TableCell className="font-medium">{member.memberName}</TableCell>
                          <TableCell className="text-right text-green-600">
                            {formatMoney(member.totalPurchase)}
                          </TableCell>
                          <TableCell className="text-right">{member.orderCount}</TableCell>
                          <TableCell className="text-right">
                            {member.orderCount > 0 
                              ? formatMoney(member.totalPurchase / member.orderCount) 
                              : '-'}
                          </TableCell>
                          <TableCell>
                            <Badge variant={member.totalPurchase > 0 ? 'default' : 'secondary'}>
                              {member.totalPurchase > 0 ? '已购买' : '未购买'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* 会员购买汇总 */}
              {branchData.members.length > 0 && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">会员总数</div>
                      <div className="text-xl font-bold">{branchData.members.length}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">已购买会员</div>
                      <div className="text-xl font-bold text-green-600">
                        {branchData.members.filter(m => m.totalPurchase > 0).length}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">购买总金额</div>
                      <div className="text-xl font-bold text-blue-600">
                        {formatMoney(branchData.members.reduce((sum, m) => sum + m.totalPurchase, 0))}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">订单总数</div>
                      <div className="text-xl font-bold">
                        {branchData.members.reduce((sum, m) => sum + m.orderCount, 0)}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 算力统计Tab */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 服务网点算力额度 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-blue-600" />
                  服务网点算力额度
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                    <div>
                      <div className="font-medium">总额度</div>
                      <div className="text-sm text-gray-500">智算中心分配给该服务网点</div>
                    </div>
                    <div className="text-2xl font-bold text-blue-600">
                      {formatEnergy(branchData.stats.quotaTotal)}
                    </div>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg">
                    <div>
                      <div className="font-medium">已分配</div>
                      <div className="text-sm text-gray-500">已分配给服务商</div>
                    </div>
                    <div className="text-2xl font-bold text-orange-600">
                      {formatEnergy(branchData.stats.quotaUsed)}
                    </div>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                    <div>
                      <div className="font-medium">剩余额度</div>
                      <div className="text-sm text-gray-500">可继续分配</div>
                    </div>
                    <div className="text-2xl font-bold text-green-600">
                      {formatEnergy(branchData.stats.quotaAvailable)}
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="flex justify-between text-sm text-gray-500 mb-1">
                      <span>分配进度</span>
                      <span>{branchData.stats.quotaTotal > 0 ? ((branchData.stats.quotaUsed / branchData.stats.quotaTotal) * 100).toFixed(1) : 0}%</span>
                    </div>
                    <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"
                        style={{ width: `${branchData.stats.quotaTotal > 0 ? Math.min((branchData.stats.quotaUsed / branchData.stats.quotaTotal) * 100, 100) : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 服务商算力额度汇总 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-purple-600" />
                  服务商算力额度
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-purple-50 rounded-lg">
                    <div>
                      <div className="font-medium">服务商总额度</div>
                      <div className="text-sm text-gray-500">所有服务商的算力额度</div>
                    </div>
                    <div className="text-2xl font-bold text-purple-600">
                      {formatEnergy(branchData.stats.providerSummary.totalQuota)}
                    </div>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                    <div>
                      <div className="font-medium">已使用额度</div>
                      <div className="text-sm text-gray-500">服务商已使用</div>
                    </div>
                    <div className="text-2xl font-bold text-blue-600">
                      {formatEnergy(branchData.stats.providerSummary.usedQuota)}
                    </div>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                    <div>
                      <div className="font-medium">可用额度</div>
                      <div className="text-sm text-gray-500">服务商可使用</div>
                    </div>
                    <div className="text-2xl font-bold text-green-600">
                      {formatEnergy(branchData.stats.providerSummary.availableQuota)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 产品销售统计 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                  产品销售统计
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                    <div>
                      <div className="font-medium">已售产品数量</div>
                      <div className="text-sm text-gray-500">已完成订单数</div>
                    </div>
                    <div className="text-2xl font-bold text-green-600">
                      {branchData.stats.providerSummary.totalSoldProducts}
                    </div>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg">
                    <div>
                      <div className="font-medium">销售总额</div>
                      <div className="text-sm text-gray-500">已完成订单金额</div>
                    </div>
                    <div className="text-2xl font-bold text-orange-600">
                      {formatMoney(branchData.stats.providerSummary.totalSoldAmount)}
                    </div>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                    <div>
                      <div className="font-medium">会员购买金额</div>
                      <div className="text-sm text-gray-500">所有会员购买总额</div>
                    </div>
                    <div className="text-2xl font-bold text-blue-600">
                      {formatMoney(branchData.stats.totalProductRevenue)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 会员统计 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-purple-600" />
                  会员统计
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-purple-50 rounded-lg">
                    <div>
                      <div className="font-medium">服务商数量</div>
                      <div className="text-sm text-gray-500">直属服务商</div>
                    </div>
                    <div className="text-2xl font-bold text-purple-600">
                      {branchData.stats.providerCount}
                    </div>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                    <div>
                      <div className="font-medium">会员数量</div>
                      <div className="text-sm text-gray-500">直属会员</div>
                    </div>
                    <div className="text-2xl font-bold text-blue-600">
                      {branchData.stats.memberUserCount}
                    </div>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                    <div>
                      <div className="font-medium">收益持有</div>
                      <div className="text-sm text-gray-500">体系内收益</div>
                    </div>
                    <div className="text-2xl font-bold text-green-600">
                      {formatEnergy(branchData.stats.energyBalance)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 收益统计Tab */}
        <TabsContent value="energy">
          <div className="space-y-6">
            {/* 收益概览卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="bg-gradient-to-br from-yellow-500 to-orange-500 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">收益总额</p>
                      <p className="text-2xl font-bold mt-1">{formatEnergy(branchData.stats.energyBalance)}</p>
                      <p className="text-xs opacity-70 mt-1">服务网点体系总和</p>
                    </div>
                    <Zap className="w-10 h-10 opacity-50" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">服务网点收益</p>
                      <p className="text-2xl font-bold mt-1">{formatEnergy(branchData.stats.energyBranchBalance)}</p>
                      <p className="text-xs opacity-70 mt-1">服务网点持有</p>
                    </div>
                    <Building2 className="w-10 h-10 opacity-50" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">服务商收益</p>
                      <p className="text-2xl font-bold mt-1">{formatEnergy(branchData.stats.energyProviderBalance)}</p>
                      <p className="text-xs opacity-70 mt-1">服务商持有</p>
                    </div>
                    <Users className="w-10 h-10 opacity-50" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-pink-500 to-pink-600 text-white">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-80">会员收益</p>
                      <p className="text-2xl font-bold mt-1">{formatEnergy(branchData.stats.energyMemberBalance)}</p>
                      <p className="text-xs opacity-70 mt-1">会员持有</p>
                    </div>
                    <Users className="w-10 h-10 opacity-50" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 收益分布图表 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 收益构成 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-yellow-500" />
                    收益构成
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* 服务网点 */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                          服务网点
                        </span>
                        <span className="font-medium">{formatEnergy(branchData.stats.energyBranchBalance)}</span>
                      </div>
                      <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full"
                          style={{ width: `${branchData.stats.energyBalance > 0 ? ((branchData.stats.energyBranchBalance / branchData.stats.energyBalance) * 100) : 0}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-500">
                        {branchData.stats.energyBalance > 0 ? ((branchData.stats.energyBranchBalance / branchData.stats.energyBalance) * 100).toFixed(1) : 0}%
                      </p>
                    </div>

                    {/* 服务商 */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full bg-purple-500"></span>
                          服务商
                        </span>
                        <span className="font-medium">{formatEnergy(branchData.stats.energyProviderBalance)}</span>
                      </div>
                      <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-purple-500 to-purple-600 rounded-full"
                          style={{ width: `${branchData.stats.energyBalance > 0 ? ((branchData.stats.energyProviderBalance / branchData.stats.energyBalance) * 100) : 0}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-500">
                        {branchData.stats.energyBalance > 0 ? ((branchData.stats.energyProviderBalance / branchData.stats.energyBalance) * 100).toFixed(1) : 0}%
                      </p>
                    </div>

                    {/* 会员 */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full bg-pink-500"></span>
                          会员
                        </span>
                        <span className="font-medium">{formatEnergy(branchData.stats.energyMemberBalance)}</span>
                      </div>
                      <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-pink-500 to-pink-600 rounded-full"
                          style={{ width: `${branchData.stats.energyBalance > 0 ? ((branchData.stats.energyMemberBalance / branchData.stats.energyBalance) * 100) : 0}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-500">
                        {branchData.stats.energyBalance > 0 ? ((branchData.stats.energyMemberBalance / branchData.stats.energyBalance) * 100).toFixed(1) : 0}%
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 收益占比 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-green-600" />
                    收益占比
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center p-4 bg-blue-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center">
                          <Building2 className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <div className="font-medium">服务网点</div>
                          <div className="text-sm text-gray-500">
                            {branchData.stats.energyBalance > 0 ? ((branchData.stats.energyBranchBalance / branchData.stats.energyBalance) * 100).toFixed(1) : 0}%
                          </div>
                        </div>
                      </div>
                      <div className="text-xl font-bold text-blue-600">
                        {formatEnergy(branchData.stats.energyBranchBalance)}
                      </div>
                    </div>

                    <div className="flex justify-between items-center p-4 bg-purple-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-purple-500 flex items-center justify-center">
                          <Users className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <div className="font-medium">服务商</div>
                          <div className="text-sm text-gray-500">
                            {branchData.stats.energyBalance > 0 ? ((branchData.stats.energyProviderBalance / branchData.stats.energyBalance) * 100).toFixed(1) : 0}%
                          </div>
                        </div>
                      </div>
                      <div className="text-xl font-bold text-purple-600">
                        {formatEnergy(branchData.stats.energyProviderBalance)}
                      </div>
                    </div>

                    <div className="flex justify-between items-center p-4 bg-pink-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-pink-500 flex items-center justify-center">
                          <Users className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <div className="font-medium">会员</div>
                          <div className="text-sm text-gray-500">
                            {branchData.stats.energyBalance > 0 ? ((branchData.stats.energyMemberBalance / branchData.stats.energyBalance) * 100).toFixed(1) : 0}%
                          </div>
                        </div>
                      </div>
                      <div className="text-xl font-bold text-pink-600">
                        {formatEnergy(branchData.stats.energyMemberBalance)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 说明 */}
            <Card className="bg-amber-50 border-amber-200">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <TrendingUp className="w-5 h-5 text-amber-600 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-amber-800">收益统计说明</h4>
                    <ul className="text-sm text-amber-700 mt-2 space-y-1">
                      <li>• 收益总额：服务网点体系内所有收益之和（服务网点 + 服务商 + 会员）</li>
                      <li>• 服务网点收益：服务网点自身持有的收益</li>
                      <li>• 服务商收益：该服务网点下所有服务商的收益之和</li>
                      <li>• 会员收益：该服务网点体系下所有会员的收益之和</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
