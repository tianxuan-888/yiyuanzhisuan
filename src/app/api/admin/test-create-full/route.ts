import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 创建测试数据：服务网点 + 2个服务商 + 5个会员
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const timestamp = Date.now();

    // 生成标准UUID
    const genUUID = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });

    // 1. 创建服务网点用户
    const branchId = genUUID();
    const branchUsername = '测试服务网点B' + timestamp;
    const { error: branchUserError } = await client
      .from('users')
      .insert({
        id: branchId,
        username: branchUsername,
        password: '$2b$10$test_hash',
        phone: '13900000002',
        role: 'branch',
        is_active: true,
        energy_value: '0',
        balance: '0',
        created_at: new Date().toISOString(),
      });

    if (branchUserError) {
      throw new Error(`创建服务网点用户失败: ${branchUserError.message}`);
    }

    // 2. 创建2个服务商用户
    const provider1Id = genUUID();
    const provider2Id = genUUID();
    const provider1Name = '服务商001' + timestamp;
    const provider2Name = '服务商002' + timestamp;

    const { error: providerUserError } = await client
      .from('users')
      .insert([
        {
          id: provider1Id,
          username: provider1Name,
          password: '$2b$10$test_hash',
          phone: '13900000011',
          role: 'provider',
          branch_id: branchId,
          is_active: true,
          energy_value: '0',
          balance: '0',
          created_at: new Date().toISOString(),
        },
        {
          id: provider2Id,
          username: provider2Name,
          password: '$2b$10$test_hash',
          phone: '13900000012',
          role: 'provider',
          branch_id: branchId,
          is_active: true,
          energy_value: '0',
          balance: '0',
          created_at: new Date().toISOString(),
        }
      ]);

    if (providerUserError) {
      throw new Error(`创建服务商用户失败: ${providerUserError.message}`);
    }

    // 3. 创建providers表记录
    const { error: providersError } = await client
      .from('providers')
      .insert([
        {
          id: genUUID(),
          user_id: provider1Id,
          branch_id: branchId,
          quota: 0,
          used_quota: 0,
          total_sales: 0,
          split_count: 0,
          is_active: true,
          created_at: new Date().toISOString(),
        },
        {
          id: genUUID(),
          user_id: provider2Id,
          branch_id: branchId,
          quota: 0,
          used_quota: 0,
          total_sales: 0,
          split_count: 0,
          is_active: true,
          created_at: new Date().toISOString(),
        }
      ]);

    if (providersError) {
      throw new Error(`创建providers记录失败: ${providersError.message}`);
    }

    // 4. 创建5个会员（3个给服务商1，2个给服务商2）
    const members = [];
    for (let i = 1; i <= 5; i++) {
      const memberId = genUUID();
      const providerId = i <= 3 ? provider1Id : provider2Id;
      const memberName = '会员00' + i + timestamp;

      const { error: memberError } = await client
        .from('users')
        .insert({
          id: memberId,
          username: memberName,
          password: '$2b$10$test_hash',
          phone: '1390000' + (100 + i),
          role: 'member',
          provider_id: providerId,
          branch_id: branchId,
          is_active: true,
          energy_value: '0',
          balance: '0',
          created_at: new Date().toISOString(),
        });

      if (memberError) {
        throw new Error(`创建会员失败: ${memberError.message}`);
      }

      members.push({ id: memberId, username: memberName });
    }

    // 5. 创建收益账户（初始为0）
    const allUserIds = [branchId, provider1Id, provider2Id, ...members.map(m => m.id)];
    const energyAccounts = allUserIds.map(userId => ({
      user_id: userId,
      balance: 0,
      total_in: 0,
      total_out: 0,
      created_at: new Date().toISOString(),
    }));

    const { error: energyError } = await client
      .from('energy_accounts')
      .insert(energyAccounts);

    if (energyError) {
      console.warn('创建收益账户失败（可能已存在）:', energyError.message);
    }

    return NextResponse.json({
      success: true,
      message: '测试数据创建成功',
      data: {
        branch: { id: branchId, username: branchUsername, phone: '13900000002' },
        providers: [
          { id: provider1Id, username: provider1Name, phone: '13900000011' },
          { id: provider2Id, username: provider2Name, phone: '13900000012' }
        ],
        members: members,
        stats: {
          quota: 0,
          energy: 0
        }
      }
    });
  } catch (error: any) {
    console.error('创建测试数据失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
