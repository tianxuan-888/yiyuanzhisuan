import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

// 获取当前用户可转账的对象列表
// 统一使用 PostgreSQL 直连
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: '用户ID不能为空' },
        { status: 400 }
      );
    }

    // 查询当前用户信息
    const currentUsers = await query(
      'SELECT id, username, role, energy_value, provider_id, branch_id FROM users WHERE id = $1',
      [userId]
    );

    if (currentUsers.length === 0) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      );
    }

    const currentUser = currentUsers[0];

    // 从 energy_accounts 表获取最新的能量值
    const energyAccounts = await query(
      'SELECT balance FROM energy_accounts WHERE user_id = $1',
      [userId]
    );
    const energyValue = energyAccounts.length > 0 ? Number(energyAccounts[0].balance || 0) : 0;

    const result: any = {
      current_user: {
        id: currentUser.id,
        username: currentUser.username,
        role: currentUser.role,
        energy_value: energyValue,  // 从 energy_accounts 表获取
      },
      transfer_targets: {},
    };

    // 辅助函数：从 energy_accounts 表批量获取用户能量值
    const getEnergyValues = async (userIds: string[]): Promise<Map<string, number>> => {
      if (userIds.length === 0) return new Map();
      const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');
      const eaResult = await query(
        `SELECT user_id, balance FROM energy_accounts WHERE user_id IN (${placeholders})`,
        userIds
      );
      const map = new Map<string, number>();
      for (const row of eaResult) {
        map.set(row.user_id, Number(row.balance) || 0);
      }
      return map;
    };

    // ========== 根据角色返回不同的转账对象 ==========

    // 服务商可转账对象：所属分公司 + 所有服务商 + 自己的会员
    if (currentUser.role === 'provider') {
      // 查询所属分公司
      if (currentUser.branch_id) {
        const branches = await query(
          'SELECT id, username, phone, unique_id, role, energy_value FROM users WHERE id = $1',
          [currentUser.branch_id]
        );
        
        if (branches.length > 0) {
          const eaMap = await getEnergyValues([branches[0].id]);
          result.transfer_targets.branch = {
            ...branches[0],
            energy_value: eaMap.get(branches[0].id) || 0
          };
        }
      }

      // 查询所有服务商（排除自己）
      const providers = await query(
        'SELECT id, username, phone, role, energy_value FROM users WHERE role = $1 AND id != $2',
        ['provider', userId]
      );
      if (providers.length > 0) {
        const eaMap = await getEnergyValues(providers.map(p => p.id));
        result.transfer_targets.providers = providers.map(p => ({
          ...p,
          energy_value: eaMap.get(p.id) || 0
        }));
      } else {
        result.transfer_targets.providers = [];
      }

      // 查询自己的会员
      const members = await query(
        'SELECT id, username, phone, role, energy_value FROM users WHERE provider_id = $1 AND role = $2',
        [userId, 'member']
      );
      if (members.length > 0) {
        const eaMap = await getEnergyValues(members.map(m => m.id));
        result.transfer_targets.members = members.map(m => ({
          ...m,
          energy_value: eaMap.get(m.id) || 0
        }));
      } else {
        result.transfer_targets.members = [];
      }
    }

    // 分公司可转账对象：旗下所有服务商和会员
    if (currentUser.role === 'branch') {
      // 查询该分公司的所有服务商
      const providers = await query(
        'SELECT id, username, phone, unique_id, role, energy_value FROM users WHERE branch_id = $1 AND role = $2',
        [userId, 'provider']
      );
      if (providers.length > 0) {
        const eaMap = await getEnergyValues(providers.map(p => p.id));
        result.transfer_targets.providers = providers.map(p => ({
          ...p,
          energy_value: eaMap.get(p.id) || 0
        }));
      } else {
        result.transfer_targets.providers = [];
      }

      // 查询该分公司的所有会员
      const members = await query(
        `SELECT u.id, u.username, u.phone, u.unique_id, u.role, u.energy_value 
         FROM users u 
         WHERE u.provider_id IN (SELECT id FROM users WHERE branch_id = $1 AND role = 'provider')
         AND u.role = 'member'`,
        [userId]
      );
      if (members.length > 0) {
        const eaMap = await getEnergyValues(members.map(m => m.id));
        result.transfer_targets.members = members.map(m => ({
          ...m,
          energy_value: eaMap.get(m.id) || 0
        }));
      } else {
        result.transfer_targets.members = [];
      }
    }

    // 会员可转账对象：自己的服务商
    if (currentUser.role === 'member') {
      if (currentUser.provider_id) {
        const providers = await query(
          'SELECT id, username, role, energy_value FROM users WHERE id = $1',
          [currentUser.provider_id]
        );
        if (providers.length > 0) {
          const eaMap = await getEnergyValues([providers[0].id]);
          result.transfer_targets.provider = {
            ...providers[0],
            energy_value: eaMap.get(providers[0].id) || 0
          };
        }
      }
    }

    // admin 暂不支持
    if (currentUser.role === 'admin') {
      result.transfer_targets = {};
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('获取转账对象列表失败:', error);
    return NextResponse.json(
      { error: error.message || '获取失败' },
      { status: 500 }
    );
  }
}
