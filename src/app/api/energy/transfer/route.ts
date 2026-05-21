import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { authenticateRequest } from '@/lib/auth';
import { deductEnergy, addEnergy, getEnergyBalance, transferEnergy } from '@/lib/energy-util';

// 收益互转接口（支持多角色）
// 会员→服务商：创建审核记录（服务商线下打款后审核通过）
// 其他角色：即时转账
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { from_user_id, to_user_id, amount, note, payment_method, real_name, alipay_account } = body;

    // 参数验证
    if (!from_user_id || !to_user_id || !amount) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 验证操作者权限：管理员或本人
    if (user.role !== 'admin' && user.userId !== from_user_id) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    if (from_user_id === to_user_id) {
      return NextResponse.json({ error: '不能给自己转账' }, { status: 400 });
    }

    const transferAmount = parseFloat(amount);

    if (transferAmount < 50) {
      return NextResponse.json({ error: '转账金额不能少于50' }, { status: 400 });
    }

    const supabase = getSupabase();

    // 查询转出方用户信息
    const { data: fromUser } = await supabase
      .from('users')
      .select('id, username, role, energy_value, provider_id, branch_id')
      .eq('id', from_user_id)
      .single();

    if (!fromUser) {
      return NextResponse.json({ error: '转出方用户不存在' }, { status: 404 });
    }

    // 获取转出方收益余额
    const fromEnergyValue = await getEnergyBalance(from_user_id);

    if (fromEnergyValue < transferAmount) {
      return NextResponse.json({ error: `收益不足，当前只有 ${fromEnergyValue}` }, { status: 400 });
    }

    // 查询接收方用户信息
    const { data: toUser } = await supabase
      .from('users')
      .select('id, username, role, energy_value, provider_id, branch_id')
      .eq('id', to_user_id)
      .single();

    if (!toUser) {
      return NextResponse.json({ error: '接收方用户不存在' }, { status: 404 });
    }

    // ===== 会员 → 服务商：创建审核记录（服务商线下打款后审核） =====
    if (fromUser.role === 'member' && toUser.role === 'provider') {
      // 验证服务关系
      if (fromUser.provider_id !== to_user_id) {
        return NextResponse.json({ error: '只能向所属服务商转账' }, { status: 403 });
      }

      // 验证支付信息
      if (!payment_method) {
        return NextResponse.json({ error: '请选择收款方式' }, { status: 400 });
      }
      if (payment_method === 'alipay' && !alipay_account) {
        return NextResponse.json({ error: '请输入支付宝账号' }, { status: 400 });
      }
      if (payment_method === 'wechat' && !real_name) {
        return NextResponse.json({ error: '微信收款需提供真实姓名' }, { status: 400 });
      }
      if (!real_name) {
        return NextResponse.json({ error: '请输入真实姓名' }, { status: 400 });
      }

      // 1. 冻结会员收益（扣减，如果审核拒绝会退还，status设为pending等待审核）
      const deductResult = await deductEnergy(from_user_id, transferAmount, 'transfer_out', {
        toUserId: to_user_id,
        note: '收益转账（待服务商审核）',
        status: 'pending',
      });

      if (!deductResult.success) {
        return NextResponse.json({ error: '冻结收益失败: ' + deductResult.error }, { status: 500 });
      }

      // 2. 创建审核记录
      const now = new Date().toISOString();
      const { data: wdRecord, error: wdErr } = await supabase
        .from('energy_withdraw_requests')
        .insert({
          id: crypto.randomUUID(),
          user_id: from_user_id,
          amount: transferAmount,
          actual_amount: transferAmount,
          fee_amount: 0,
          status: 'pending',
          payment_method,
          real_name,
          alipay_account,
          withdraw_type: 'transfer',
          to_user_id,
          note: note || '会员收益转账给服务商',
          created_at: now,
          updated_at: now,
        })
        .select('id')
        .single();

      if (wdErr) {
        console.error('[energy-transfer] 创建审核记录失败:', wdErr.message);
        // 退还收益
        await addEnergy(from_user_id, transferAmount, 'refund', {
          fromUserId: to_user_id,
          note: '创建审核记录失败，退还',
        });
        return NextResponse.json({ error: '创建审核记录失败: ' + wdErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: '转账申请已提交，等待服务商线下打款并审核',
        data: {
          requestId: wdRecord.id,
          amount: transferAmount,
          toUser: toUser.username
        }
      });
    }

    // ===== 其他角色间转账：即时完成 =====

    // 角色关系验证
    if (fromUser.role === 'provider' && toUser.role === 'branch') {
      const { data: providerData } = await supabase
        .from('providers')
        .select('branch_id')
        .eq('user_id', from_user_id)
        .single();
      if (!providerData || providerData.branch_id !== to_user_id) {
        return NextResponse.json({ error: '只能向所属服务网点转账' }, { status: 403 });
      }
    }

    if (fromUser.role === 'branch' && toUser.role === 'provider') {
      const { data: providerData } = await supabase
        .from('providers')
        .select('branch_id')
        .eq('user_id', to_user_id)
        .single();
      if (!providerData || providerData.branch_id !== from_user_id) {
        return NextResponse.json({ error: '只能向旗下服务商转账' }, { status: 403 });
      }
    }

    // 服务商 → 会员：验证服务关系
    if (fromUser.role === 'provider' && toUser.role === 'member') {
      const { data: memberData } = await supabase
        .from('users')
        .select('provider_id')
        .eq('id', to_user_id)
        .single();
      if (!memberData || memberData.provider_id !== from_user_id) {
        return NextResponse.json({ error: '只能向所属会员转账' }, { status: 403 });
      }
    }

    // 执行即时转账（使用 energy-util 的 transferEnergy）
    const result = await transferEnergy(from_user_id, to_user_id, transferAmount, {
      note: note || '收益转账',
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: '转账成功',
      data: {
        fromEnergy: result.fromNewBalance,
        toEnergy: result.toNewBalance,
        amount: transferAmount
      }
    });
  } catch (error) {
    console.error('收益转账失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
