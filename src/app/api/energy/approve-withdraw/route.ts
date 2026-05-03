import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { generateUUID } from '@/lib/utils';
import { addEnergy } from '@/lib/energy-util';

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

    const supabase = getSupabase();

    // 查询申请记录
    const { data: withdrawRequest, error: queryError } = await supabase
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

    if (withdrawRequest.approver_id !== user.userId) {
      return NextResponse.json({ error: '无权审核此申请' }, { status: 403 });
    }

    const amount = parseFloat(withdrawRequest.amount);
    const actualAmount = amount * 0.95;
    const feeAmount = amount * 0.05;
    const applicantId = withdrawRequest.user_id;

    if (action === 'reject') {
      // 拒绝：返还冻结的能量值
      const addResult = await addEnergy(applicantId, amount, 'withdraw_return', {
        note: `变现申请被拒绝，返还冻结能量值 ${amount}`,
      });

      if (!addResult.success) {
        return NextResponse.json({ error: addResult.error }, { status: 500 });
      }

      // 更新申请状态
      await supabase
        .from('energy_withdraw_requests')
        .update({
          status: 'rejected',
          reviewed_by: user.userId,
          reviewed_at: new Date().toISOString(),
          review_note: note || '审核拒绝',
        })
        .eq('id', requestId);

      return NextResponse.json({
        success: true,
        message: '已拒绝申请，能量值已返还',
      });
    }

    // 批准：执行变现
    // 1. 更新申请状态
    await supabase
      .from('energy_withdraw_requests')
      .update({
        status: 'approved',
        reviewed_by: user.userId,
        reviewed_at: new Date().toISOString(),
        review_note: note || '审核通过',
      })
      .eq('id', requestId);

    // 2. 给申请人返还95%能量值（变现到账）
    const addResult = await addEnergy(applicantId, actualAmount, 'withdraw_complete', {
      note: `变现完成：获得${actualAmount}（原申请${amount}，扣除手续费${feeAmount}）`,
    });

    if (!addResult.success) {
      return NextResponse.json({ error: addResult.error }, { status: 500 });
    }

    // 3. 手续费5%归总公司
    const { data: adminData } = await supabase
      .from('users')
      .select('id')
      .eq('role', 'admin')
      .maybeSingle();

    if (adminData) {
      const feeResult = await addEnergy(adminData.id, feeAmount, 'withdraw_fee', {
        note: `变现手续费回收：用户变现${amount}，回收${feeAmount}（5%）`,
      });
      // 即使手续费记录失败，变现本身已成功，不回滚
    }

    return NextResponse.json({
      success: true,
      message: `审核通过，用户获得 ${actualAmount} 能量值（已扣除5%手续费 ${feeAmount}）`,
      data: {
        amount,
        actualAmount,
        feeAmount,
      }
    });
  } catch (error: any) {
    console.error('审核变现申请失败:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
