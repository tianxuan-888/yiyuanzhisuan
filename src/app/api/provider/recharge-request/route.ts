import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { execute, queryOne } from '@/storage/database/pg-client';

// 获取服务商的充值申请列表
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = await verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '无效的认证令牌' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');
    const status = searchParams.get('status');

    if (!providerId) {
      return NextResponse.json({ error: '服务商ID不能为空' }, { status: 400 });
    }

    // 查询充值申请
    let statusFilter = status ? `AND status = '${status}'` : '';
    const recordsResult = await execute(
      `SELECT id, provider_id, member_id, amount, status, note, reviewed_by, reviewed_at, created_at, updated_at
       FROM energy_recharge_records
       WHERE provider_id = $1 ${statusFilter}
       ORDER BY created_at DESC`,
      [providerId]
    );
    const records: any[] = (recordsResult as any)?.rows || recordsResult || [];

    // 获取关联会员信息
    const memberIds = [...new Set((records || []).map((r: any) => r.member_id))];
    const memberMap: Record<string, any> = {};
    if (memberIds.length > 0) {
      const membersResult = await execute(
        `SELECT id, username, phone, unique_id FROM users WHERE id = ANY($1)`,
        [memberIds]
      );
      const members: any[] = (membersResult as any)?.rows || membersResult || [];
      (members || []).forEach((m: any) => {
        memberMap[m.id] = { username: m.username, phone: m.phone, unique_id: m.unique_id };
      });
    }

    const requests = (records || []).map((r: any) => ({
      id: r.id,
      memberId: r.member_id,
      memberName: memberMap[r.member_id]?.username || '未知',
      memberPhone: memberMap[r.member_id]?.phone || '未知',
      uniqueId: memberMap[r.member_id]?.unique_id || '',
      amount: Number(r.amount),
      note: r.note || null,
      status: r.status || 'pending',
      createdAt: r.created_at,
    }));

    return NextResponse.json({ success: true, data: requests });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('获取充值申请失败:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// 审批充值申请（操作balance而非energy_value）
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = await verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '无效的认证令牌' }, { status: 401 });
    }

    const body = await request.json();
    const { requestId, providerId, action, note } = body;

    if (!requestId || !providerId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 查询充值记录
    const record = await queryOne(
      'SELECT * FROM energy_recharge_records WHERE id = $1',
      [requestId]
    );

    if (!record) {
      return NextResponse.json({ error: '充值申请不存在' }, { status: 404 });
    }

    if (record.provider_id !== providerId) {
      return NextResponse.json({ error: '无权操作此申请' }, { status: 403 });
    }

    if (record.status !== 'pending') {
      return NextResponse.json({ error: '该申请已被处理' }, { status: 400 });
    }

    const amount = Number(record.amount);
    const memberId = record.member_id;

    if (action === 'approve') {
      // 1. 检查服务商balance是否充足
      const providerUser = await queryOne('SELECT balance FROM users WHERE id = $1', [providerId]);
      const providerBalance = parseFloat(String(providerUser?.balance)) || 0;

      if (providerBalance < amount) {
        return NextResponse.json({ error: '服务商收益不足，无法充值' }, { status: 400 });
      }

      // 2. 扣减服务商balance
      await execute(
        'UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE id = $2',
        [amount, providerId]
      );

      // 3. 增加会员balance
      await execute(
        'UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE id = $2',
        [amount, memberId]
      );

      // 4. 更新充值记录状态
      await execute(
        `UPDATE energy_recharge_records SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [providerId, requestId]
      );

      // 5. 查询更新后余额
      const updatedProvider = await queryOne('SELECT balance FROM users WHERE id = $1', [providerId]);
      const updatedMember = await queryOne('SELECT balance FROM users WHERE id = $1', [memberId]);

      const memberInfo = await queryOne('SELECT username FROM users WHERE id = $1', [memberId]);

      return NextResponse.json({
        success: true,
        message: `已成功充值 ${amount} 智算金给 ${memberInfo?.username || '会员'}`,
        data: {
          amount,
          memberBalance: parseFloat(String(updatedMember?.balance)) || 0,
          providerBalance: parseFloat(String(updatedProvider?.balance)) || 0,
        },
      });
    } else if (action === 'reject') {
      await execute(
        `UPDATE energy_recharge_records SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), note = $2, updated_at = NOW() WHERE id = $3`,
        [providerId, note ? `${record.note || ''} | 拒绝原因: ${note}` : record.note, requestId]
      );

      return NextResponse.json({
        success: true,
        message: '已拒绝充值申请',
      });
    }

    return NextResponse.json({ error: '无效的操作' }, { status: 400 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('审批充值申请失败:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
