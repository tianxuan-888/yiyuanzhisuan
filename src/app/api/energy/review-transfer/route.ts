import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 服务商审核会员能量值转账申请
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    // 仅服务商和管理员可操作
    if (user.role !== 'provider' && user.role !== 'admin') {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { requestId, providerId, action, reviewNote } = body;

    if (!requestId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '无效的操作类型' }, { status: 400 });
    }

    // 查询转账申请
    const requests = await query(
      `SELECT ewr.*, u.username, u.energy_value, u.phone, u.real_name as user_real_name
       FROM energy_withdraw_requests ewr
       LEFT JOIN users u ON ewr.user_id = u.id
       WHERE ewr.id = $1`,
      [requestId]
    );

    if (!requests || requests.length === 0) {
      return NextResponse.json({ error: '转账申请不存在' }, { status: 404 });
    }

    const transferRequest = requests[0];

    // 验证状态
    if (transferRequest.status !== 'pending') {
      return NextResponse.json({ error: '该申请已处理' }, { status: 400 });
    }

    // 验证是转账类型
    if (transferRequest.withdraw_type !== 'transfer') {
      return NextResponse.json({ error: '该申请不是转账类型' }, { status: 400 });
    }

    // 验证服务商权限
    if (user.role !== 'admin' && transferRequest.to_user_id !== providerId) {
      return NextResponse.json({ error: '无权操作此转账' }, { status: 403 });
    }

    const transferAmount = parseFloat(transferRequest.amount);

    if (action === 'reject') {
      // 拒绝：退还能量值给会员
      const result = await withTransaction(async (client) => {
        // 更新申请状态
        await client.query(
          `UPDATE energy_withdraw_requests SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), review_note = $2, updated_at = NOW() WHERE id = $3`,
          [providerId || user.userId, reviewNote || '服务商拒绝', requestId]
        );

        // 退还能量值
        const currentEnergy = parseFloat(transferRequest.energy_value || '0');
        const newEnergy = currentEnergy + transferAmount;
        await client.query(
          'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
          [newEnergy, transferRequest.user_id]
        );

        // 同步 energy_accounts
        const accRes = await client.query(
          'SELECT id FROM energy_accounts WHERE user_id = $1',
          [transferRequest.user_id]
        );
        if (accRes.rows && accRes.rows.length > 0) {
          await client.query(
            'UPDATE energy_accounts SET balance = $1, total_in = total_in + $2, updated_at = NOW() WHERE user_id = $3',
            [newEnergy, transferAmount, transferRequest.user_id]
          );
        }

        // 更新之前的 pending 流水为 cancelled
        await client.query(
          `UPDATE energy_transactions SET status = 'cancelled' WHERE user_id = $1 AND type = 'transfer_out' AND status = 'pending' AND note LIKE '%待服务商审核%'`,
          [transferRequest.user_id]
        );

        // 记录退还流水
        await client.query(
          `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, note, status, created_at)
           VALUES ($1, $2, 'transfer_in', $3, $4, $2, $5, 'completed', NOW())`,
          [crypto.randomUUID(), transferRequest.user_id, transferAmount, transferRequest.to_user_id, '转账被拒绝，能量值退还']
        );

        return { newEnergy };
      });

      return NextResponse.json({
        success: true,
        message: '已拒绝转账，能量值已退还给会员',
        data: { newEnergy: result.newEnergy }
      });
    }

    // 批准转账
    const result = await withTransaction(async (client) => {
      // 更新申请状态
      await client.query(
        `UPDATE energy_withdraw_requests SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), review_note = $2, updated_at = NOW() WHERE id = $3`,
        [providerId || user.userId, reviewNote || '服务商审核通过', requestId]
      );

      // 给服务商增加能量值
      const toUserRes = await client.query(
        'SELECT energy_value FROM users WHERE id = $1',
        [transferRequest.to_user_id]
      );
      const toEnergyValue = toUserRes.rows && toUserRes.rows.length > 0 ? parseFloat(toUserRes.rows[0].energy_value || '0') : 0;
      const newToEnergy = toEnergyValue + transferAmount;

      await client.query(
        'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
        [newToEnergy, transferRequest.to_user_id]
      );

      // 同步服务商 energy_accounts
      const toAccRes = await client.query(
        'SELECT id FROM energy_accounts WHERE user_id = $1',
        [transferRequest.to_user_id]
      );
      if (toAccRes.rows && toAccRes.rows.length > 0) {
        await client.query(
          'UPDATE energy_accounts SET balance = $1, total_in = total_in + $2, updated_at = NOW() WHERE user_id = $3',
          [newToEnergy, transferAmount, transferRequest.to_user_id]
        );
      } else {
        await client.query(
          'INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at) VALUES ($1, $2, $3, $4, 0, NOW(), NOW())',
          [crypto.randomUUID(), transferRequest.to_user_id, newToEnergy, transferAmount]
        );
      }

      // 更新会员的 pending 流水为 completed
      await client.query(
        `UPDATE energy_transactions SET status = 'completed', note = '能量值转账给服务商（已审核通过）' WHERE user_id = $1 AND type = 'transfer_out' AND status = 'pending'`,
        [transferRequest.user_id]
      );

      // 记录服务商转入流水
      await client.query(
        `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, note, status, created_at)
         VALUES ($1, $2, 'transfer_in', $3, $4, $2, $5, 'completed', NOW())`,
        [crypto.randomUUID(), transferRequest.to_user_id, transferAmount, transferRequest.user_id, '会员能量值转入（审核通过）']
      );

      return { newToEnergy };
    });

    return NextResponse.json({
      success: true,
      message: '转账审核通过，能量值已转入您的账户',
      data: { newToEnergy: result.newToEnergy }
    });
  } catch (error) {
    console.error('审核能量值转账失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// 获取待审核的转账申请列表
export async function GET(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');
    const status = searchParams.get('status') || 'pending';

    if (!providerId) {
      return NextResponse.json({ error: '缺少服务商ID' }, { status: 400 });
    }

    // 验证权限
    if (user.role !== 'admin' && user.role !== 'provider') {
      return NextResponse.json({ error: '无权查看' }, { status: 403 });
    }

    let sql = `
      SELECT ewr.*, 
             u.username, u.phone, u.real_name as user_real_name, u.unique_id,
             u.energy_value as user_energy_value
      FROM energy_withdraw_requests ewr
      LEFT JOIN users u ON ewr.user_id = u.id
      WHERE ewr.to_user_id = $1 AND ewr.withdraw_type = 'transfer'
    `;
    const params: any[] = [providerId];

    if (status) {
      sql += ' AND ewr.status = $2';
      params.push(status);
    }

    sql += ' ORDER BY ewr.created_at DESC';

    const data = await query(sql, params);

    return NextResponse.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('获取转账审核列表失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
