'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

// 会员等级类型
export type MemberLevel = 'normal';

// 用户信息接口
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
  energyValue?: number; // 登录接口返回的字段名
  balance: number;
  points: number;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  unique_id?: string; // 会员专属ID（HM格式）
  branch_id?: string | null; // 服务商所属服务网点ID
}

interface UserInfo {
  id: string;
  phone: string;
  name: string;
  role: string;
  memberLevel: MemberLevel;
  energyValue: number;
  balance: number;
  points: number;
  providerId: string | null;
  inviterId: string | null;
  branch_id?: string | null; // 服务商所属服务网点ID
  unique_id?: string;
  invite_code?: string;
  real_name?: string | null;
  alipay_account?: string | null;
  username?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string | null;
}

// 根据用户数据判断会员等级
function getMemberLevel(user: UserData | null): MemberLevel {
  return 'normal';
}

// 角色重定向映射
const roleRedirects: Record<string, string> = {
  admin: '/admin',
  branch: '/branch',
  provider: '/provider',
  member: '/member',
};

export function useAuth(requiredRole?: string) {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // 检查登录状态
    const isLoggedIn = localStorage.getItem('isLoggedIn');
    const userId = localStorage.getItem('userId');
    const userName = localStorage.getItem('userName');
    const userRole = localStorage.getItem('userRole');
    const userDataStr = localStorage.getItem('userData');

    // 如果未登录
    if (!isLoggedIn || isLoggedIn !== 'true') {
      setLoading(false);
      setIsAuthenticated(false);
      return;
    }

    setIsAuthenticated(true);

    // 如果有完整的用户数据，使用它
    if (userDataStr) {
      try {
        const userData: UserData = JSON.parse(userDataStr);
        const memberLevel = getMemberLevel(userData);
        
        setUser({
          id: userData.id,
          phone: userData.phone || '',
          name: userData.username,
          role: userData.role,
          memberLevel,
          // 支持两种字段名：energyValue (登录接口返回) 和 energy_value (原字段)
          energyValue: Number(userData.energyValue || userData.energy_value) || 0,
          balance: Number(userData.balance || 0),
          points: Number(userData.points ?? 0),
          providerId: userData.provider_id,
          inviterId: userData.inviter_id,
          unique_id: userData.unique_id || undefined,
          invite_code: (userData as any).invite_code || undefined,
          branch_id: userData.branch_id,
          username: userData.username,
          real_name: userData.real_name,
          alipay_account: userData.alipay_account,
          is_active: userData.is_active,
          created_at: userData.created_at,
        });
      } catch {
        // 解析失败，使用基本信息
        if (userId && userName && userRole) {
          setUser({
            id: userId,
            phone: '',
            name: userName,
            role: userRole,
            memberLevel: 'normal',
            energyValue: 0,
            balance: 0,
            providerId: null,
            inviterId: null,
            unique_id: undefined,
            branch_id: null,
            points: 0,
          });
        }
      }
    } else if (userId && userName && userRole) {
      // 只有基本信息
      setUser({
        id: userId,
        phone: '',
        name: userName,
        role: userRole,
        memberLevel: 'normal',
        energyValue: 0,
        balance: 0,
        providerId: null,
        inviterId: null,
        unique_id: undefined,
        branch_id: null,
        points: 0,
      });
    }

    setLoading(false);
  }, [router, requiredRole]);

  const logout = () => {
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('userId');
    localStorage.removeItem('userName');
    localStorage.removeItem('userRole');
    localStorage.removeItem('userData');
    localStorage.removeItem('token');
    setUser(null);
    setIsAuthenticated(false);
    // 跳转到登录页面
    router.push('/');
  };

  // 刷新用户数据
  const refreshUser = async () => {
    const userId = localStorage.getItem('userId');
    if (!userId) return;

    try {
      const response = await fetch(`/api/users/${userId}`);
      const data = await response.json();
      
      if (data.success) {
        localStorage.setItem('userData', JSON.stringify(data.data));
        const memberLevel = getMemberLevel(data.data);
        
        setUser({
          id: data.data.id,
          phone: data.data.phone || '',
          name: data.data.username,
          role: data.data.role,
          memberLevel,
          energyValue: Number(data.data.energy_value) || 0,
          balance: Number(data.data.balance) || 0,
          providerId: data.data.provider_id,
          inviterId: data.data.inviter_id,
          unique_id: data.data.unique_id || undefined,
          invite_code: data.data.invite_code || undefined,
          points: Number(data.data.points) || 0,
        });
      }
    } catch (err) {
      console.error('刷新用户数据失败:', err);
    }
  };

  return { user, loading, isLoading: loading, isAuthenticated, logout, refreshUser, setUser };
}
