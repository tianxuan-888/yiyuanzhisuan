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

    // 查询服务商收到的充值申请（通过 transactions 表）
    // 返回所有记录，不只是pending状态
    let sql = `
      SELECT t.*, u.username as member_name, u.phone as member_phone
      FROM transactions t
      LEFT JOIN users u ON t.description::jsonb->>'member_id' = u.id
      WHERE t.user_id = $1 AND t.type = 'recharge'
    `;
    const params: any[] = [providerId];

    // 默认返回所有状态的记录
    sql += ' ORDER BY t.created_at DESC';

    const records = await query(sql, params);

    // 解析 description 获取详情
    const requests = (records || []).map((t: any) => {
      try {
        const data = typeof t.description === 'string' ? JSON.parse(t.description) : t.description;
        return {
          id: t.id,
          memberId: data?.member_id || null,
          memberName: data?.member_name || t.member_name || '未知',
          memberPhone: data?.member_phone || t.member_phone || '未知',
          amount: parseFloat(t.amount),
          note: data?.note || null,
          status: t.status || 'pending',
          createdAt: t.created_at,
        };
      } catch {
        return {
          id: t.id,
          amount: parseFloat(t.amount),
          status: t.status || 'pending',
          createdAt: t.created_at,
        };
      }
    });

    return NextResponse.json({ success: true, data: requests });
  } catch (error: any) {
    console.error('获取充值申请失败:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
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

    // 查询充值记录
    const record = await queryOne<{ id: string; user_id: string; amount: string; description: string; status: string }>(
      'SELECT * FROM transactions WHERE id = $1',
      [requestId]
    );

    if (!record) {
      return NextResponse.json({ error: '充值申请不存在' }, { status: 404 });
    }

    if (record.user_id !== providerId) {
      return NextResponse.json({ error: '无权操作此申请' }, { status: 403 });
    }

    if (record.status !== 'pending') {
      return NextResponse.json({ error: '该申请已被处理' }, { status: 400 });
    }

    const amount = parseFloat(record.amount);

    if (action === 'approve') {
      // 批准：给会员充值能量值
      const data = typeof record.description === 'string' ? JSON.parse(record.description) : record.description;
      const memberId = data?.member_id;

      if (!memberId) {
        return NextResponse.json({ error: '无法获取会员信息' }, { status: 400 });
      }

      // 1. 记录服务商支出流水（先记录，避免数据不一致）
      await execute(
        `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, description, status, created_at)
         VALUES (gen_random_uuid(), $2, 'transfer_out', $1, $2, $3, $4, 'completed', NOW())`,
        [amount, providerId, memberId, JSON.stringify({ note: `给${data?.member_name || '会员'}充值`, requestId })]
      );

      // 2. 记录会员充值流水（类型为recharge）
      await execute(
        `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, description, status, created_at)
         VALUES (gen_random_uuid(), $3, 'recharge', $1, $2, $3, $4, 'completed', NOW())`,
        [amount, providerId, memberId, JSON.stringify({ note: `来自${data?.member_name || '服务商'}充值`, requestId })]
      );

      // 3. 扣减服务商能量值（energy_accounts）
      await execute(
        `UPDATE energy_accounts 
         SET balance = balance - $1, total_out = total_out + $1, updated_at = NOW()
         WHERE user_id = $2 AND balance >= $1`,
        [amount, providerId]
      );

      // 3.1 同步更新服务商 users.energy_value
      await execute(
        `UPDATE users SET energy_value = (SELECT balance FROM energy_accounts WHERE user_id = $1), updated_at = NOW() WHERE id = $1`,
        [providerId]
      );

      // 4. 增加会员能量值（energy_accounts）
      await execute(
        `UPDATE energy_accounts 
         SET balance = balance + $1, total_in = total_in + $1, updated_at = NOW()
         WHERE user_id = $2`,
        [amount, memberId]
      );

      // 4.1 同步更新会员 users.energy_value
      await execute(
        `UPDATE users SET energy_value = (SELECT balance FROM energy_accounts WHERE user_id = $1), updated_at = NOW() WHERE id = $1`,
        [memberId]
      );

      // 5. 更新充值记录状态
      await execute(
        `UPDATE transactions SET status = 'approved' WHERE id = $1`,
        [requestId]
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
        message: `已成功充值 ${amount} 能量值给 ${data?.member_name || '会员'}`,
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
        `UPDATE transactions SET status = 'rejected' WHERE id = $1`,
        [requestId]
      );

      return NextResponse.json({
        success: true,
        message: '已拒绝充值申请',
      });
    }

    return NextResponse.json({ error: '无效的操作' }, { status: 400 });
  } catch (error: any) {
    console.error('审批充值申请失败:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
