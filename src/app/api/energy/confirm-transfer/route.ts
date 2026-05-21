import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 服务商确认收益转账接口
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅服务商可确认
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { transferId, providerId, action, proofImageUrl } = body;

    // 参数验证
    if (!transferId || !providerId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '无效的操作' }, { status: 400 });
    }

    // 验证操作者权限
    if (user.role !== 'admin' && user.userId !== providerId) {
      return NextResponse.json({ error: '无权操作此转账' }, { status: 403 });
    }

    const client = getSupabaseClient();

    // 查询转账记录
    const { data: transfer, error: transferError } = await client
      .from('energy_transfers')
      .select('*')
      .eq('id', transferId)
      .maybeSingle();

    if (transferError) {
      throw new Error(`查询转账记录失败: ${transferError.message}`);
    }

    if (!transfer) {
      return NextResponse.json({ error: '转账记录不存在' }, { status: 404 });
    }

    // 验证服务商
    if (user.role !== 'admin' && transfer.to_user_id !== providerId) {
      return NextResponse.json({ error: '无权操作此转账' }, { status: 403 });
    }

    // 验证转账状态
    if (transfer.status !== 'pending') {
      return NextResponse.json({ error: '转账状态不正确' }, { status: 400 });
    }

    const transferAmount = parseFloat(transfer.amount);

    if (action === 'reject') {
      // 拒绝转账：退还收益给会员
      const { data: userData } = await client
        .from('users')
        .select('energy_value')
        .eq('id', transfer.from_user_id)
        .single();

      if (userData) {
        const currentEnergyValue = parseFloat(userData.energy_value || '0');
        // 白名单过滤
        const safeUpdate = { energy_value: currentEnergyValue + transferAmount };
        await client.from('users').update(safeUpdate).eq('id', transfer.from_user_id);
      }

      // 更新转账记录 - 白名单过滤
      await client.from('energy_transfers').update({
        status: 'rejected',
        notes: transfer.notes ? `${transfer.notes}\n拒绝` : '拒绝',
        updated_at: new Date().toISOString()
      }).eq('id', transferId).eq('status', 'pending'); // 乐观锁

      // 发送通知
      await client.from('notifications').insert({
        receiver_id: transfer.from_user_id,
        receiver_role: 'member',
        sender_id: providerId,
        type: 'energy_transfer_rejected',
        title: '收益转账已拒绝',
        content: `您的 ${transferAmount} 收益转账申请已被拒绝，收益已退还`
      });

      return NextResponse.json({ success: true, message: '已拒绝转账，收益已退还' });
    }

    // 批准转账
    // 白名单过滤
    await client.from('energy_transfers').update({
      status: 'completed',
      proof_image_url: proofImageUrl || null,
      notes: transfer.notes,
      updated_at: new Date().toISOString()
    }).eq('id', transferId).eq('status', 'pending'); // 乐观锁

    // 发送通知
    await client.from('notifications').insert({
      receiver_id: transfer.from_user_id,
      receiver_role: 'member',
      sender_id: providerId,
      type: 'energy_transfer_completed',
      title: '收益转账已完成',
      content: `您的 ${transferAmount} 收益已转入服务商账户`
    });

    return NextResponse.json({ success: true, message: '转账确认成功' });
  } catch (error) {
    console.error('确认转账失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
