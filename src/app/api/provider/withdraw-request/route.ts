import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 服务商收益提现申请
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { amount, alipayAccount, realName, note } = body;
    const providerId = authUser.userId;

    if (!amount) {
      return NextResponse.json({ error: '缺少提现金额' }, { status: 400 });
    }

    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      return NextResponse.json({ error: '提现金额无效' }, { status: 400 });
    }

    if (withdrawAmount < 50) {
      return NextResponse.json({ error: '最低提现金额为50收益' }, { status: 400 });
    }

    // 计算手续费和到账金额
    const fee = Math.round(withdrawAmount * 0.05 * 100) / 100; // 5%手续费
    const actualAmount = withdrawAmount - fee; // 95%到账

    const result = await withTransaction(async (client) => {
      // 1. 查询服务商信息
      const providerRes = await client.query(
        'SELECT id, username, energy_value, branch_id FROM users WHERE id = $1',
        [providerId]
      );

      if (!providerRes.rows || providerRes.rows.length === 0) {
        throw Object.assign(new Error('服务商不存在'), { statusCode: 404 });
      }

      const provider = providerRes.rows[0];
      const currentEnergy = parseFloat(provider.energy_value) || 0;

      if (currentEnergy < withdrawAmount) {
        throw Object.assign(new Error('收益余额不足'), { statusCode: 400 });
      }

      // 获取服务网点ID
      let branchId = provider.branch_id;
      if (!branchId) {
        const providerRecordRes = await client.query(
          'SELECT branch_id FROM providers WHERE user_id = $1',
          [providerId]
        );
        if (providerRecordRes.rows && providerRecordRes.rows.length > 0) {
          branchId = providerRecordRes.rows[0].branch_id;
        }
      }

      if (!branchId) {
        throw Object.assign(new Error('未找到所属服务网点，无法提现'), { statusCode: 400 });
      }

      // 2. 冻结/扣减服务商收益
      const newEnergy = currentEnergy - withdrawAmount;
      await client.query(
        'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
        [newEnergy.toFixed(2), providerId]
      );

      // 同步更新 energy_accounts
      await client.query(
        `UPDATE energy_accounts SET balance = balance - $1, total_out = total_out + $1, updated_at = NOW()
         WHERE user_id = $2`,
        [withdrawAmount.toFixed(2), providerId]
      );

      // 3. 创建提现记录（写入 withdrawals 表，与会员提现一致）
      const withdrawalRes = await client.query(
        `INSERT INTO withdrawals (user_id, user_role, amount, fee, actual_amount, alipay_account, real_name, status, note, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, NOW(), NOW()) RETURNING id`,
        [providerId, 'provider', withdrawAmount.toFixed(2), fee.toFixed(2), actualAmount.toFixed(2), alipayAccount || null, realName || null, note || `服务商收益提现: ${withdrawAmount}，到账${actualAmount}`]
      );

      const withdrawalId = withdrawalRes.rows[0].id;

      // 4. 记入服务网点现金收益
      await client.query(
        `INSERT INTO branch_revenue_records (branch_id, type, amount, related_user_id, related_withdrawal_id, status, note, created_at)
         VALUES ($1, 'provider_withdraw', $2, $3, $4, 'received', $5, NOW())`,
        [branchId, actualAmount.toFixed(2), providerId, withdrawalId, `服务商提现: ${withdrawAmount}收益，到账${actualAmount}元`]
      );

      // 5. 手续费沉淀到智算总台
      await client.query(
        `INSERT INTO company_fee_records (type, amount, source_user_id, source_role, source_withdrawal_id, note, created_at)
         VALUES ('withdrawal_fee', $1, $2, 'provider', $3, $4, NOW())`,
        [fee.toFixed(2), providerId, withdrawalId, `服务商提现手续费5%: ${fee}元`]
      );

      // 6. 记录收益流水（withdraw_freeze）
      const adminRes = await client.query(
        'SELECT id FROM users WHERE role = $1 LIMIT 1',
        ['admin']
      );
      const adminId = adminRes.rows && adminRes.rows.length > 0 ? adminRes.rows[0].id : null;

      await client.query(
        `INSERT INTO energy_transactions (user_id, type, amount, from_user_id, to_user_id, note, created_at)
         VALUES ($2, 'withdraw_freeze', $1, $2, $3, $4, NOW())`,
        [withdrawAmount.toFixed(2), providerId, adminId, `服务商提现冻结: ${withdrawAmount}收益`]
      );

      return { withdrawalId, newEnergy, fee, actualAmount, branchId };
    });

    return NextResponse.json({
      success: true,
      message: `提现申请已提交，等待服务网点审核。实际到账: ${result.actualAmount}元（扣除5%手续费 ${result.fee}元）`,
      data: {
        withdrawalId: result.withdrawalId,
        amount: withdrawAmount.toFixed(2),
        fee: result.fee.toFixed(2),
        actualAmount: result.actualAmount.toFixed(2),
        newEnergy: result.newEnergy.toFixed(2),
      },
    });
  } catch (error: any) {
    console.error('服务商提现申请失败:', error);
    const statusCode = error.statusCode || 500;
    return NextResponse.json(
      { error: error.message || '提现申请失败' },
      { status: statusCode }
    );
  }
}

// 获取服务商提现记录（从 withdrawals 表查询）
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId') || authUser.userId;
    const status = searchParams.get('status') || 'all';

    let sql = `SELECT * FROM withdrawals WHERE user_id = $1 AND user_role = 'provider'`;
    const params: any[] = [providerId];

    if (status !== 'all') {
      sql += ' AND status = $2';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';

    const records = await query(sql, params);

    return NextResponse.json({ success: true, data: records || [] });
  } catch (error: any) {
    console.error('获取提现记录失败:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
