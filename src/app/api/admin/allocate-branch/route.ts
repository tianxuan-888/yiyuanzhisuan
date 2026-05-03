import { NextRequest, NextResponse } from 'next/server';
import { query, execute } from '@/storage/database/pg-client';

// 总公司向分公司分配额度（分配时自动赠送20%能量值给分公司）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { adminId, branchId, amount, note } = body;

    // 参数验证
    if (!adminId || !branchId || !amount) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 验证是总公司操作
    const admin = await query<{
      id: string;
      username: string;
      role: string;
    }>(
      'SELECT id, username, role FROM users WHERE id = $1',
      [adminId]
    );

    if (!admin || admin.length === 0) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      );
    }

    if (admin[0].role !== 'admin') {
      return NextResponse.json(
        { error: '只有总公司管理员可以执行此操作' },
        { status: 403 }
      );
    }

    // 验证分公司存在
    const branch = await query<{
      id: string;
      username: string;
      role: string;
    }>(
      'SELECT id, username, role FROM users WHERE id = $1',
      [branchId]
    );

    if (!branch || branch.length === 0) {
      return NextResponse.json(
        { error: '分公司不存在' },
        { status: 404 }
      );
    }

    if (branch[0].role !== 'branch') {
      return NextResponse.json(
        { error: '目标用户不是分公司' },
        { status: 400 }
      );
    }

    const allocateAmount = parseFloat(amount);
    if (isNaN(allocateAmount) || allocateAmount <= 0) {
      return NextResponse.json(
        { error: '分配额度必须大于0' },
        { status: 400 }
      );
    }

    // 临时调试：打印使用的 Supabase URL
    console.log(`[ALLOCATE-DEBUG] NEXT_PUBLIC_SUPABASE_URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL?.substring(0,30)}, COZE_SUPABASE_URL: ${process.env.COZE_SUPABASE_URL?.substring(0,30)}, SUPABASE_URL: ${process.env.SUPABASE_URL?.substring(0,30)}`);

    // 计算赠送的能量值（20%给分公司）
    const bonusEnergy = allocateAmount * 0.2;

    // 验证总公司可用额度是否足够
    const companyQuota = await query<{
      id: string;
      total_quota: number;
      used_quota: number;
      available_quota: number;
    }>(
      'SELECT id, total_quota, used_quota, available_quota FROM company_quota LIMIT 1'
    );

    if (!companyQuota || companyQuota.length === 0) {
      return NextResponse.json(
        { error: '总公司额度记录不存在' },
        { status: 500 }
      );
    }

    const availableQuota = Number(companyQuota[0].available_quota || 0);
    if (allocateAmount > availableQuota) {
      return NextResponse.json(
        { error: `总公司可用额度不足，当前可用 ${availableQuota.toLocaleString()} 元` },
        { status: 400 }
      );
    }

    // 获取总公司当前能量值（从 energy_accounts 表）
    const adminAccount = await query<{ balance: number }>(
      'SELECT balance FROM energy_accounts WHERE user_id = $1',
      [adminId]
    );
    const adminEnergyBefore = adminAccount.length > 0 ? Number(adminAccount[0].balance || 0) : 0;
    console.log('[ALLOCATE] adminAccount raw:', JSON.stringify(adminAccount), 'adminEnergyBefore:', adminEnergyBefore);

    // 验证总公司能量值是否足够（需要扣除20%赠送部分）
    if (adminEnergyBefore < bonusEnergy) {
      return NextResponse.json(
        { error: `总公司能量值不足，需要 ${bonusEnergy.toLocaleString()}，当前 ${adminEnergyBefore.toLocaleString()}` },
        { status: 400 }
      );
    }

    // ========== 开始执行分配 ==========

    // 0. 扣减总公司额度（company_quota）
    await execute(
      `UPDATE company_quota SET
         used_quota = used_quota + $1,
         available_quota = available_quota - $1
       WHERE id = $2`,
      [allocateAmount, companyQuota[0].id || '1']
    );

    // 0.1 扣减总公司能量值（admin energy_accounts）
    await execute(
      `UPDATE energy_accounts SET
         balance = balance - $1,
         total_out = total_out + $1,
         updated_at = NOW()
       WHERE user_id = $2`,
      [bonusEnergy, adminId]
    );

    // 0.2 记录总公司能量值扣减流水
    await execute(
      `INSERT INTO energy_transactions
       (id, user_id, type, amount, energy_before, energy_after, related_user_id, note, status, from_user_id, to_user_id, created_at)
       VALUES ($1, $2, 'transfer_out', $3, $4, $5, $6, $7, 'completed', $8, $9, NOW())`,
      [
        crypto.randomUUID(),
        adminId,
        bonusEnergy,
        adminEnergyBefore.toFixed(2),
        (adminEnergyBefore - bonusEnergy).toFixed(2),
        branchId,
        `向分公司分配额度 ${allocateAmount.toLocaleString()} 元，赠送能量值20%（${bonusEnergy.toLocaleString()}）`,
        adminId,
        branchId
      ]
    );

    // 1. 增加分公司能量值（使用 energy_accounts 表）
    const branchAccount = await query(
      'SELECT balance FROM energy_accounts WHERE user_id = $1',
      [branchId]
    );
    const branchEnergyBefore = branchAccount.length > 0 ? Number(branchAccount[0].balance || 0) : 0;
    const branchEnergyAfter = branchEnergyBefore + bonusEnergy;

    // 增加分公司能量值
    await execute(
      `INSERT INTO energy_accounts (user_id, balance, total_in, total_out, created_at, updated_at)
       VALUES ($1, $2, $3, 0, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         balance = energy_accounts.balance + $2,
         total_in = energy_accounts.total_in + $3,
         updated_at = NOW()`,
      [branchId, bonusEnergy, bonusEnergy]
    );

    // 2. 记录分公司的能量值增加（transfer_in 类型）
    await execute(
      `INSERT INTO energy_transactions 
       (id, user_id, type, amount, energy_before, energy_after, related_user_id, note, status, from_user_id, to_user_id, created_at)
       VALUES ($1, $2, 'transfer_in', $3, $4, $5, $6, $7, 'completed', $8, $9, NOW())`,
      [
        crypto.randomUUID(),
        branchId,
        bonusEnergy,
        branchEnergyBefore.toFixed(2),
        branchEnergyAfter.toFixed(2),
        adminId,
        `总公司分配额度 ${allocateAmount.toLocaleString()} 元，获得赠送能量值20%（${bonusEnergy.toLocaleString()}）`,
        adminId,
        branchId
      ]
    );

    // 3. 在 quota_accounts 表创建分配记录（使用算力额度表记录额度分配）
    await execute(
      `INSERT INTO quota_accounts (user_id, balance, total_in, total_out, created_at, updated_at)
       VALUES ($1, $2, $3, 0, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         balance = quota_accounts.balance + $2,
         total_in = quota_accounts.total_in + $3,
         updated_at = NOW()`,
      [branchId, allocateAmount, allocateAmount]
    );

    // 4. 记录分配记录（quota_records）
    const recordId = crypto.randomUUID();
    await execute(
      `INSERT INTO quota_records (id, from_user_id, to_user_id, amount, type, note, created_at)
       VALUES ($1, $2, $3, $4, 'allocate', $5, NOW())`,
      [recordId, adminId, branchId, allocateAmount, note || `总公司分配额度给分公司 ${branch[0].username}`]
    );

    // 5. 记录能量值流水（使用 quota_match 类型，算力额度匹配能量值）
    await execute(
      `INSERT INTO energy_transactions 
       (id, user_id, type, amount, energy_before, energy_after, related_user_id, note, status, from_user_id, to_user_id, created_at)
       VALUES ($1, $2, 'quota_match', $3, $4, $5, $6, $7, 'completed', $8, $9, NOW())`,
      [
        crypto.randomUUID(),
        branchId,
        bonusEnergy,
        branchEnergyBefore.toFixed(2),
        branchEnergyAfter.toFixed(2),
        recordId,
        `总公司下发算力额度 ${allocateAmount} 元，同步配套20%能量值 ${bonusEnergy}`,
        adminId,
        branchId
      ]
    );

    // 6. 发送通知给分公司
    const notifId = crypto.randomUUID();
    await execute(
      `INSERT INTO notifications (id, receiver_id, receiver_role, sender_id, type, title, content, created_at)
       VALUES ($1, $2, 'branch', $3, 'quota_allocated', '额度已到账', $4, NOW())`,
      [
        notifId,
        branchId,
        adminId,
        `总公司已分配额度 ${allocateAmount.toLocaleString()} 元到您的账户，同时赠送 ${bonusEnergy.toLocaleString()} 能量值（20%）。请前往额度管理页面使用。`
      ]
    );

    return NextResponse.json({
      success: true,
      message: `已成功分配额度 ${allocateAmount.toLocaleString()} 元给 ${branch[0].username}`,
      data: {
        allocated_amount: allocateAmount,
        bonus_energy: bonusEnergy,
        admin_energy_before: adminEnergyBefore,
        admin_energy_after: adminEnergyBefore - bonusEnergy,
        company_quota_available: Number(companyQuota[0].available_quota) - allocateAmount,
        branch_energy_before: branchEnergyBefore,
        branch_energy_after: branchEnergyAfter,
        branch_name: branch[0].username,
      },
    });
  } catch (error) {
    console.error('分配额度失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '分配额度失败' },
      { status: 500 }
    );
  }
}
