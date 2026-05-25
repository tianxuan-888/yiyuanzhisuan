'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export type MemberLevel = 'normal';

interface UserData {
  id: string;
  username: string;
  role: string;
  phone: string | null;
  real_name: string | null;
  alipay_account: string | null;
  provider_id: string | null;
  inviter_id: string | null;
  balance: number;
  points: number;
  energy_value?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  unique_id?: string;
  branch_id?: string | null;
}

interface UserInfo {
  id: string;
  phone: string;
  name: string;
  role: string;
  memberLevel: MemberLevel;
  balance: number;
  points: number;
  energy_value: number;
  providerId: string | null;
  inviterId: string | null;
  branch_id?: string | null;
  unique_id?: string;
  invite_code?: string;
  real_name?: string | null;
  alipay_account?: string | null;
  username?: string;
  is_active?: boolean;
  buy_locked?: boolean;
  created_at?: string;
  updated_at?: string | null;
}

function getMemberLevel(user: UserData | null): MemberLevel {
  return 'normal';
}

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
    const isLoggedIn = localStorage.getItem('isLoggedIn');
    const userId = localStorage.getItem('userId');
    const userName = localStorage.getItem('userName');
    const userRole = localStorage.getItem('userRole');
    const userDataStr = localStorage.getItem('userData');

    if (!isLoggedIn || isLoggedIn !== 'true') {
      setLoading(false);
      setIsAuthenticated(false);
      return;
    }

    setIsAuthenticated(true);

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
          energy_value: Number(userData.energy_value || 0),
        });
      } catch {
        if (userId && userName && userRole) {
          setUser({
            id: userId, phone: '', name: userName, role: userRole,
            memberLevel: 'normal', balance: 0, providerId: null, inviterId: null,
            unique_id: undefined, branch_id: null, points: 0, energy_value: 0,
          });
        }
      }
    } else if (userId && userName && userRole) {
      setUser({
        id: userId, phone: '', name: userName, role: userRole,
        memberLevel: 'normal', balance: 0, providerId: null, inviterId: null,
        unique_id: undefined, branch_id: null, points: 0, energy_value: 0,
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
    router.push('/');
  };

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
          balance: Number(data.data.balance) || 0,
          providerId: data.data.provider_id,
          inviterId: data.data.inviter_id,
          unique_id: data.data.unique_id || undefined,
          invite_code: data.data.invite_code || undefined,
          points: Number(data.data.points) || 0,
          energy_value: Number(data.data.energy_value) || 0,
        });
      }
    } catch (err) {
      console.error('刷新用户数据失败:', err);
    }
  };

  return { user, loading, isLoading: loading, isAuthenticated, logout, refreshUser, setUser };
}
