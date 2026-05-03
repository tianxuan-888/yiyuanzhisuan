import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 分公司直接转账能量值给服务商或会员
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    if (authUser.role !== 'branch' && authUser.role !== 'admin') {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { branchId, targetId, targetType, amount, note } = body;

    // 参数验证
    if (!branchId || !targetId || !targetType || !amount) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (targetType !== 'provider' && targetType !== 'member') {
      return NextResponse.json({ error: '目标类型无效' }, { status: 400 });
    }

    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      return NextResponse.json({ error: '转账金额必须大于0' }, { status: 400 });
    }

    // 查询分公司能量值
    const branchUsers = await query(
      'SELECT id, username, energy_value FROM users WHERE id = $1 AND role = $2',
      [branchId, 'branch']
    );

    if (!branchUsers || branchUsers.length === 0) {
      return NextResponse.json({ error: '分公司不存在' }, { status: 404 });
    }

    const branch = branchUsers[0];
    const branchEnergy = parseFloat(branch.energy_value || '0');

    if (branchEnergy < transferAmount) {
      return NextResponse.json({ error: `能量值余额不足，当前余额: ${branchEnergy}` }, { status: 400 });
    }

    // 查询目标用户
    const targetRole = targetType === 'provider' ? 'provider' : 'member';
    const targetUsers = await query(
      'SELECT id, username, energy_value FROM users WHERE id = $1 AND role = $2',
      [targetId, targetRole]
    );

    if (!targetUsers || targetUsers.length === 0) {
      return NextResponse.json({ error: `${targetType === 'provider' ? '服务商' : '会员'}不存在` }, { status: 404 });
    }

    const target = targetUsers[0];

    // 如果是服务商，验证是否属于该分公司
    if (targetType === 'provider') {
      const providerInfo = await query(
        'SELECT branch_id FROM providers WHERE user_id = $1',
        [targetId]
      );
      if (!providerInfo || providerInfo.length === 0 || providerInfo[0].branch_id !== branchId) {
        return NextResponse.json({ error: '该服务商不属于您的分公司' }, { status: 403 });
      }
    }

    const newBranchEnergy = branchEnergy - transferAmount;
    const newTargetEnergy = parseFloat(target.energy_value || '0') + transferAmount;

    // 事务内执行所有更新
    const result = await withTransaction(async (client) => {
      // 更新分公司能量值 - users表
      await client.query(
        'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
        [newBranchEnergy, branchId]
      );

      // 更新目标用户能量值 - users表
      await client.query(
        'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
        [newTargetEnergy, targetId]
      );

      // 同步分公司 energy_accounts
      const branchAccRes = await client.query('SELECT id FROM energy_accounts WHERE user_id = $1', [branchId]);
      if (branchAccRes.rows && branchAccRes.rows.length > 0) {
        await client.query(
          'UPDATE energy_accounts SET balance = $1, total_out = total_out + $2, updated_at = NOW() WHERE user_id = $3',
          [newBranchEnergy, transferAmount, branchId]
        );
      } else {
        await client.query(
          'INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at) VALUES ($1, $2, $3, 0, $4, NOW(), NOW())',
          [crypto.randomUUID(), branchId, newBranchEnergy, transferAmount]
        );
      }

      // 同步目标用户 energy_accounts
      const targetAccRes = await client.query('SELECT id FROM energy_accounts WHERE user_id = $1', [targetId]);
      if (targetAccRes.rows && targetAccRes.rows.length > 0) {
        await client.query(
          'UPDATE energy_accounts SET balance = $1, total_in = total_in + $2, updated_at = NOW() WHERE user_id = $3',
          [newTargetEnergy, transferAmount, targetId]
        );
      } else {
        await client.query(
          'INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at) VALUES ($1, $2, $3, $4, 0, NOW(), NOW())',
          [crypto.randomUUID(), targetId, newTargetEnergy, transferAmount]
        );
      }

      // 记录分公司转出流水 - energy_transactions
      await client.query(
        `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, note, status, created_at)
         VALUES ($1, $2, 'transfer_out', $3, $2, $4, $5, 'completed', NOW())`,
        [crypto.randomUUID(), branchId, transferAmount, targetId, note || `分公司转账给${target.username}`]
      );

      // 记录目标用户转入流水 - energy_transactions
      await client.query(
        `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, note, status, created_at)
         VALUES ($1, $2, 'transfer_in', $3, $4, $2, $5, 'completed', NOW())`,
        [crypto.randomUUID(), targetId, transferAmount, branchId, note || `收到分公司转账`]
      );

      return { newBranchEnergy, newTargetEnergy };
    });

    return NextResponse.json({
      success: true,
      message: `成功转账 ${transferAmount} 能量值给 ${target.username}`,
      data: {
        branchId,
        targetId,
        amount: transferAmount,
        newBranchEnergy: result.newBranchEnergy,
        newTargetEnergy: result.newTargetEnergy,
      },
    });
  } catch (error) {
    console.error('分公司转账失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '转账失败' },
      { status: 500 }
    );
  }
}
