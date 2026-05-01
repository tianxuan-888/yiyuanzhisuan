import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 能量值互转接口（服务商之间互转）
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅服务商可操作
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { fromProviderId, toProviderId, amount, note } = body;

    // 参数验证
    if (!fromProviderId || !toProviderId || !amount) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 验证操作者权限
    if (user.role !== 'admin' && user.userId !== fromProviderId) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    if (fromProviderId === toProviderId) {
      return NextResponse.json({ error: '不能给自己转账' }, { status: 400 });
    }

    const transferAmount = parseFloat(amount);

    if (transferAmount < 50) {
      return NextResponse.json({ error: '转账金额不能少于50' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 查询转出方服务商信息
    const { data: fromProvider, error: fromError } = await client
      .from('users')
      .select('id, username, role, energy_value')
      .eq('id', fromProviderId)
      .maybeSingle();

    if (fromError) {
      throw new Error(`查询转出方失败: ${fromError.message}`);
    }

    if (!fromProvider) {
      return NextResponse.json({ error: '转出方用户不存在' }, { status: 404 });
    }

    if (fromProvider.role !== 'provider') {
      return NextResponse.json({ error: '转出方不是服务商' }, { status: 400 });
    }

    // 检查能量值是否足够
    const fromEnergyValue = parseFloat(fromProvider.energy_value || '0');

    if (fromEnergyValue < transferAmount) {
      return NextResponse.json({ error: `能量值不足，当前只有 ${fromEnergyValue}` }, { status: 400 });
    }

    // 查询转入方服务商信息
    const { data: toProvider, error: toError } = await client
      .from('users')
      .select('id, username, role, energy_value')
      .eq('id', toProviderId)
      .maybeSingle();

    if (toError) {
      throw new Error(`查询转入方失败: ${toError.message}`);
    }

    if (!toProvider) {
      return NextResponse.json({ error: '转入方用户不存在' }, { status: 404 });
    }

    if (toProvider.role !== 'provider') {
      return NextResponse.json({ error: '转入方不是服务商' }, { status: 400 });
    }

    // 白名单过滤
    const safeFromUpdate = { energy_value: fromEnergyValue - transferAmount };
    const safeToUpdate = { energy_value: parseFloat(toProvider.energy_value || '0') + transferAmount };

    // 更新转出方能量值
    const { error: updateFromError } = await client
      .from('users')
      .update(safeFromUpdate)
      .eq('id', fromProviderId);

    if (updateFromError) {
      throw new Error(`更新转出方能量值失败: ${updateFromError.message}`);
    }

    // 更新转入方能量值
    const { error: updateToError } = await client
      .from('users')
      .update(safeToUpdate)
      .eq('id', toProviderId);

    if (updateToError) {
      // 回滚
      await client.from('users').update({ energy_value: fromEnergyValue }).eq('id', fromProviderId);
      throw new Error(`更新转入方能量值失败: ${updateToError.message}`);
    }

    // 记录流水
    await client.from('energy_transactions').insert({
      id: crypto.randomUUID(),
      type: 'transfer',
      amount: transferAmount,
      from_user_id: fromProviderId,
      to_user_id: toProviderId,
      note: note || '服务商间能量值转账',
      status: 'completed',
      created_at: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      message: '转账成功',
      data: {
        fromEnergy: fromEnergyValue - transferAmount,
        toEnergy: parseFloat(toProvider.energy_value || '0') + transferAmount,
        amount: transferAmount
      }
    });
  } catch (error) {
    console.error('能量值转账失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
