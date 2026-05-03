import { NextRequest, NextResponse } from 'next/server';
import { query, execute, queryOne } from '@/storage/database/pg-client';
import { verifyToken } from '@/lib/auth';

// 获取服务商的充值申请列表
export async function GET(request: NextRequest) {
  try {
    // 验证授权
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

    // 从 energy_recharge_records 表查询充值申请
    let sql = `
      SELECT r.id, r.provider_id, r.member_id, r.amount, r.status, r.note,
             r.reviewed_by, r.reviewed_at, r.created_at, r.updated_at,
             u.username as member_name, u.phone as member_phone
      FROM energy_recharge_records r
      LEFT JOIN users u ON r.member_id::varchar = u.id
      WHERE r.provider_id = $1::uuid
    `;
    const params: unknown[] = [providerId];

    if (status) {
      sql += ' AND r.status = $2';
      params.push(status);
    }

    sql += ' ORDER BY r.created_at DESC';

    const records = await query(sql, params);

    const requests = (records || []).map((r: Record<string, unknown>) => ({
      id: r.id,
      memberId: r.member_id,
      memberName: r.member_name || '未知',
      memberPhone: r.member_phone || '未知',
      amount: parseFloat(String(r.amount)),
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

// 审批充值申请
export async function POST(request: NextRequest) {
  try {
    // 验证授权
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

    // 从 energy_recharge_records 查询充值记录
    const record = await queryOne<{ id: string; provider_id: string; member_id: string; amount: string; status: string; note: string }>(
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

    const amount = parseFloat(record.amount);
    const memberId = record.member_id;

    if (action === 'approve') {
      // 获取会员信息（用于流水描述）
      const member = await queryOne<{ username: string }>(
        'SELECT username FROM users WHERE id = $1',
        [memberId]
      );

      // 1. 检查服务商能量值是否充足
      const providerAccount = await queryOne<{ balance: string }>(
        'SELECT balance FROM energy_accounts WHERE user_id = $1',
        [providerId]
      );

      if (!providerAccount || parseFloat(providerAccount.balance) < amount) {
        return NextResponse.json({ error: '服务商能量值不足，无法充值' }, { status: 400 });
      }

      // 2. 记录服务商支出流水
      await execute(
        `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, description, status, created_at)
         VALUES (gen_random_uuid(), $1, 'transfer_out', $2, $1, $3, $4, 'completed', NOW())`,
        [providerId, amount, memberId, `给会员${member?.username || ''}充值能量值`]
      );

      // 3. 记录会员充值流水
      await execute(
        `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, description, status, created_at)
         VALUES (gen_random_uuid(), $1, 'recharge', $2, $3, $1, $4, 'completed', NOW())`,
        [memberId, amount, providerId, `服务商充值能量值`]
      );

      // 4. 扣减服务商能量值（energy_accounts + users.energy_value 同步）
      await execute(
        `UPDATE energy_accounts 
         SET balance = balance - $1, total_out = total_out + $1, updated_at = NOW()
         WHERE user_id = $2`,
        [amount, providerId]
      );
      await execute(
        `UPDATE users SET energy_value = (SELECT balance FROM energy_accounts WHERE user_id = $1), updated_at = NOW() WHERE id = $1`,
        [providerId]
      );

      // 5. 增加会员能量值（energy_accounts + users.energy_value 同步）
      await execute(
        `UPDATE energy_accounts 
         SET balance = balance + $1, total_in = total_in + $1, updated_at = NOW()
         WHERE user_id = $2`,
        [amount, memberId]
      );
      await execute(
        `UPDATE users SET energy_value = (SELECT balance FROM energy_accounts WHERE user_id = $1), updated_at = NOW() WHERE id = $1`,
        [memberId]
      );

      // 6. 更新充值记录状态
      await execute(
        `UPDATE energy_recharge_records SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [providerId, requestId]
      );

      // 获取更新后的能量值
      const memberEnergy = await queryOne<{ balance: string }>(
        'SELECT balance FROM energy_accounts WHERE user_id = $1',
        [memberId]
      );

      const providerEnergy = await queryOne<{ balance: string }>(
        'SELECT balance FROM energy_accounts WHERE user_id = $1',
        [providerId]
      );

      return NextResponse.json({
        success: true,
        message: `已成功充值 ${amount} 能量值给 ${member?.username || '会员'}`,
        data: {
          amount,
          memberEnergy: parseFloat(memberEnergy?.balance || '0'),
          providerEnergy: parseFloat(providerEnergy?.balance || '0'),
        },
      });
    } else if (action === 'reject') {
      // 拒绝：更新记录状态
      const rejectNote = note || '';
      await execute(
        `UPDATE energy_recharge_records SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), note = COALESCE(note, '') || $2, updated_at = NOW() WHERE id = $3`,
        [providerId, rejectNote ? ` | 拒绝原因: ${rejectNote}` : '', requestId]
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
