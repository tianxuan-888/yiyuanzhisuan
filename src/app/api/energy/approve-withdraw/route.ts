import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { generateUUID } from '@/lib/utils';

// 审核变现申请（分公司审核服务商 / 总公司审核分公司）
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['branch', 'admin'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { requestId, action, note } = body;

    if (!requestId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '无效的操作' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 查询申请记录
    const { data: withdrawRequest, error: queryError } = await client
      .from('energy_withdraw_requests')
      .select('*, users:user_id(username, role)')
      .eq('id', requestId)
      .maybeSingle();

    if (queryError) {
      throw new Error(`查询申请失败: ${queryError.message}`);
    }

    if (!withdrawRequest) {
      return NextResponse.json({ error: '申请记录不存在' }, { status: 404 });
    }

    if (withdrawRequest.status !== 'pending') {
      return NextResponse.json({ error: '该申请已被处理' }, { status: 400 });
    }

    // 验证审核人权限
    if (withdrawRequest.approver_id !== user.userId) {
      return NextResponse.json({ error: '无权审核此申请' }, { status: 403 });
    }

    const amount = withdrawRequest.amount;
    const actualAmount = amount * 0.95; // 到账95%
    const feeAmount = amount * 0.05;    // 手续费5%
    const applicantId = withdrawRequest.user_id;

    if (action === 'reject') {
      // 拒绝：返还冻结的能量值
      const { data: accountData } = await client
        .from('energy_accounts')
        .select('balance, total_out')
        .eq('user_id', applicantId)
        .maybeSingle();

      const currentBalance = parseFloat(accountData?.balance || '0');
      const returnedBalance = currentBalance + amount;

      await client
        .from('energy_accounts')
        .update({
          balance: returnedBalance,
          total_out: parseFloat(accountData?.total_out || '0') - amount
        })
        .eq('user_id', applicantId);

      // 同步更新 users.energy_value
      await client
        .from('users')
        .update({ energy_value: returnedBalance })
        .eq('id', applicantId);

      await client
        .from('energy_withdraw_requests')
        .update({
          status: 'rejected',
          reviewed_by: user.userId,
          reviewed_at: new Date().toISOString(),
          review_note: note || '审核拒绝'
        })
        .eq('id', requestId);

      return NextResponse.json({
        success: true,
        message: '已拒绝申请，能量值已返还'
      });
    }

    // 批准：执行变现
    // 1. 更新申请状态
    await client
      .from('energy_withdraw_requests')
      .update({
        status: 'approved',
        reviewed_by: user.userId,
        reviewed_at: new Date().toISOString(),
        review_note: note || '审核通过'
      })
      .eq('id', requestId);

    // 2. 给申请人返还95%能量值（变现到账）
    const { data: applicantAccount } = await client
      .from('energy_accounts')
      .select('balance, total_in')
      .eq('user_id', applicantId)
      .maybeSingle();

    const newApplicantBalance = parseFloat(applicantAccount?.balance || '0') + actualAmount;

    await client
      .from('energy_accounts')
      .update({
        balance: newApplicantBalance,
        total_in: parseFloat(applicantAccount?.total_in || '0') + actualAmount
      })
      .eq('user_id', applicantId);

    // 同步更新申请人 users.energy_value
    await client
      .from('users')
      .update({ energy_value: newApplicantBalance })
      .eq('id', applicantId);

    // 3. 获取总公司账户
    const { data: adminData } = await client
      .from('users')
      .select('id')
      .eq('role', 'admin')
      .maybeSingle();

    // 3. 能量值流转记录 - 手续费回收（5%归总公司）
    if (adminData) {
      // 增加总公司能量值（回收5%）
      const { data: adminAccount } = await client
        .from('energy_accounts')
        .select('balance, total_in')
        .eq('user_id', adminData.id)
        .maybeSingle();

      const newAdminBalance = parseFloat(adminAccount?.balance || '0') + feeAmount;

      await client
        .from('energy_accounts')
        .update({
          balance: newAdminBalance,
          total_in: parseFloat(adminAccount?.total_in || '0') + feeAmount
        })
        .eq('user_id', adminData.id);

      // 同步更新 admin users.energy_value
      await client
        .from('users')
        .update({ energy_value: newAdminBalance })
        .eq('id', adminData.id);

      // 记录回收流水
      await client.from('energy_transactions').insert({
        id: generateUUID(),
        type: 'withdraw_fee',
        amount: feeAmount,
        from_user_id: applicantId,
        to_user_id: adminData.id,
        note: `变现手续费回收：用户变现${amount}，回收${feeAmount}（5%）`
      });
    }

    // 4. 记录变现完成流水
    await client.from('energy_transactions').insert({
      id: generateUUID(),
      type: 'withdraw_complete',
      amount: actualAmount,
      from_user_id: applicantId,
      to_user_id: applicantId,
      note: `变现完成：获得${actualAmount}（原申请${amount}，扣除手续费${feeAmount}）`
    });

    return NextResponse.json({
      success: true,
      message: `审核通过，用户获得 ${actualAmount} 能量值（已扣除5%手续费 ${feeAmount}）`,
      data: {
        amount,
        actualAmount,
        feeAmount
      }
    });
  } catch (error: any) {
    console.error('审核变现申请失败:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
