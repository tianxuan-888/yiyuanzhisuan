import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 生成 UUID
const generateUUID = () => crypto.randomUUID();

// 能量值下发（总公司 → 分公司 → 服务商）
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅管理员和分公司可操作
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'branch'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { fromUserId, toUserId, amount, note } = body;

    // 参数验证
    if (!fromUserId || !toUserId || !amount || amount <= 0) {
      return NextResponse.json({ success: false, error: '参数不完整或金额无效' }, { status: 400 });
    }

    // 验证操作者权限
    if (user.role !== 'admin' && user.userId !== fromUserId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const client = getSupabaseClient();

    // 查询转出方用户信息
    const { data: fromUser, error: fromError } = await client
      .from('users')
      .select('id, username, role, energy_value')
      .eq('id', fromUserId)
      .maybeSingle();

    if (fromError || !fromUser) {
      return NextResponse.json({ success: false, error: '转出方用户不存在' }, { status: 404 });
    }

    // 验证角色权限：只有 admin 和 branch 可以释放能量值
    if (fromUser.role !== 'admin' && fromUser.role !== 'branch') {
      return NextResponse.json({ success: false, error: '只有总公司和分公司可以释放能量值' }, { status: 403 });
    }

    // 查询接收方用户信息
    const { data: toUser, error: toError } = await client
      .from('users')
      .select('id, username, role, energy_value')
      .eq('id', toUserId)
      .maybeSingle();

    if (toError || !toUser) {
      return NextResponse.json({ success: false, error: '接收方用户不存在' }, { status: 404 });
    }

    // 检查能量值是否足够
    const fromEnergy = parseFloat(fromUser.energy_value || '0');
    if (fromEnergy < amount) {
      return NextResponse.json({
        success: false,
        error: '能量值余额不足',
        data: { required: amount, current: fromEnergy, short: amount - fromEnergy }
      }, { status: 400 });
    }

    const now = new Date().toISOString();
    const transactionId = generateUUID();

    // 白名单过滤更新字段
    const fromUpdate = { energy_value: fromEnergy - amount };
    const toUpdate = { energy_value: parseFloat(toUser.energy_value || '0') + amount };

    // 扣除转出方能量值
    const { error: updateFromError } = await client
      .from('users')
      .update(fromUpdate)
      .eq('id', fromUserId);

    if (updateFromError) {
      throw new Error(`扣除能量值失败: ${updateFromError.message}`);
    }

    // 增加接收方能量值
    const { error: updateToError } = await client
      .from('users')
      .update(toUpdate)
      .eq('id', toUserId);

    if (updateToError) {
      // 回滚
      await client.from('users').update({ energy_value: fromEnergy }).eq('id', fromUserId);
      throw new Error(`增加能量值失败: ${updateToError.message}`);
    }

    // 记录流水
    await client.from('energy_transactions').insert({
      id: transactionId,
      type: 'release',
      amount: amount,
      from_user_id: fromUserId,
      to_user_id: toUserId,
      note: note || '能量值下发',
      status: 'completed',
      created_at: now
    });

    return NextResponse.json({
      success: true,
      message: '能量值下发成功',
      data: {
        transactionId,
        fromEnergy: fromEnergy - amount,
        toEnergy: parseFloat(toUser.energy_value || '0') + amount,
        amount
      }
    });
  } catch (error) {
    console.error('能量值下发失败:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
