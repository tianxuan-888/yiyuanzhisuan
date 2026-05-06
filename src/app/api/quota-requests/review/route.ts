import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { execute, queryOne } from '@/lib/pg-client';

// 审核额度申请
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅管理员和分公司可审核
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'branch'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { requestId, reviewerId, action, rejectReason, customAmount } = body;

    if (!requestId || !reviewerId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '无效的操作类型' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 获取申请信息（加锁防止并发重复审批）
    const { data: quotaRequest, error: requestError } = await client
      .from('quota_requests')
      .select('*')
      .eq('id', requestId)
      .eq('status', 'pending')  // 直接过滤pending状态，防止并发
      .single();

    if (requestError || !quotaRequest) {
      return NextResponse.json({ error: '申请不存在或已被处理' }, { status: 400 });
    }

    const now = new Date().toISOString();

    // 白名单过滤更新字段
    const baseUpdate = {
      reviewed_by: reviewerId,
      reviewed_at: now
    };

    if (action === 'reject') {
      // 拒绝申请
      const { error: updateError } = await client
        .from('quota_requests')
        .update({
          ...baseUpdate,
          status: 'rejected',
          reject_reason: rejectReason || '审核未通过'
        })
        .eq('id', requestId);

      if (updateError) {
        throw new Error(`更新申请状态失败: ${updateError.message}`);
      }

      return NextResponse.json({ success: true, message: '申请已拒绝' });
    }

    // 通过申请
    const approvedAmount = customAmount || quotaRequest.requested_amount;
    const finalAmount = Math.floor(approvedAmount * quotaRequest.multiplier);

    // 获取申请人信息
    const { data: requester } = await client
      .from('users')
      .select('id, username, real_name, role')
      .eq('id', quotaRequest.requester_id)
      .single();

    // 如果是分公司申请，检查总公司额度
    if (quotaRequest.requester_type === 'branch') {
      const { data: companyQuota, error: quotaError } = await client
        .from('company_quota')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (quotaError) {
        console.error('获取总公司额度失败:', quotaError.message);
      }

      if (companyQuota && companyQuota.available_quota < finalAmount) {
        return NextResponse.json({
          error: `总公司额度不足，当前可用额度: ¥${companyQuota.available_quota.toLocaleString()}`
        }, { status: 400 });
      }

      // 扣除总公司额度
      if (companyQuota) {
        await client.from('company_quota').update({
          available_quota: companyQuota.available_quota - finalAmount,
          used_quota: companyQuota.used_quota + finalAmount
        }).eq('id', companyQuota.id);
      }

      // 给分公司增加额度（quota_accounts 表）
      try {
        const { query: pgQuery } = await import('@/lib/pg-client');
        // 先检查分公司是否已有 quota_accounts 记录
        const existingAccount = await pgQuery(
          `SELECT id FROM quota_accounts WHERE user_id = $1`,
          [quotaRequest.requester_id]
        );

        if (existingAccount && existingAccount.length > 0) {
          // 更新已有记录
          await pgQuery(
            `UPDATE quota_accounts SET 
              balance = balance + $1, 
              total_in = total_in + $1,
              updated_at = NOW()
            WHERE user_id = $2`,
            [finalAmount, quotaRequest.requester_id]
          );
        } else {
          // 创建新记录
          await pgQuery(
            `INSERT INTO quota_accounts (user_id, balance, total_in, total_out, created_at, updated_at)
             VALUES ($1, $2, $2, 0, NOW(), NOW())`,
            [quotaRequest.requester_id, finalAmount]
          );
        }

        // 记录额度流转
        await pgQuery(
          `INSERT INTO quota_records (from_user_id, to_user_id, amount, type, note, created_at)
           VALUES ($1, $2, $3, 'transfer', $4, NOW())`,
          [
            quotaRequest.parent_id || '00000000-0000-0000-0000-000000000001',
            quotaRequest.requester_id,
            finalAmount,
            `分公司额度申请审批通过`
          ]
        );
      } catch (dbError) {
        console.error('更新分公司额度账户失败:', dbError);
        // 不回滚，因为申请状态还没更新，可以重试
      }

      // 分公司申请配比20%能量值
      const energyAmount = Math.floor(approvedAmount * 0.2);
      if (energyAmount > 0) {
        try {
          // 给分公司增加能量值
          const { data: energyAccount } = await client
            .from('energy_accounts')
            .select('*')
            .eq('user_id', quotaRequest.requester_id)
            .maybeSingle();

          if (energyAccount) {
            await client
              .from('energy_accounts')
              .update({
                balance: energyAccount.balance + energyAmount,
                total_in: energyAccount.total_in + energyAmount,
              })
              .eq('id', energyAccount.id);
          } else {
            await client
              .from('energy_accounts')
              .insert({
                user_id: quotaRequest.requester_id,
                balance: energyAmount,
                total_in: energyAmount,
                total_out: 0,
              });
          }

          // 记录能量值流水
          await client
            .from('energy_transactions')
            .insert({
              type: 'quota_match',
              amount: energyAmount,
              from_user_id: quotaRequest.parent_id || '00000000-0000-0000-0000-000000000001',
              to_user_id: quotaRequest.requester_id,
            });

          // 同步更新 users 表的 energy_value - 使用 SQL 直接执行
          const userRow = await queryOne('SELECT energy_value FROM users WHERE id = $1', [quotaRequest.requester_id]);
          if (userRow) {
            const currentEv = parseFloat(String(userRow.energy_value)) || 0;
            await execute('UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2', [currentEv + energyAmount, quotaRequest.requester_id]);
          }
        } catch (energyError) {
          console.error('更新分公司能量值失败:', energyError);
        }
      }
    }

    // 更新申请状态
    await client.from('quota_requests').update({
      ...baseUpdate,
      status: 'approved',
      approved_amount: approvedAmount,
      final_amount: finalAmount
    }).eq('id', requestId);

    return NextResponse.json({
      success: true,
      message: `申请已通过，分配额度 ¥${finalAmount.toLocaleString()}`
    });
  } catch (error) {
    console.error('审核额度申请失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
