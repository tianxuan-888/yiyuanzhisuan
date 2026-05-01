import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 能量值互转接口（支持多角色）
export async function POST(request: NextRequest) {
  try {
    // 鉴权：所有登录用户可操作
    const user = authenticateRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { from_user_id, to_user_id, amount, note } = body;

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

    // 查询转出方用户信息
    const fromUsers = await query(
      'SELECT id, username, role, energy_value, provider_id, branch_id FROM users WHERE id = $1',
      [from_user_id]
    );

    if (fromUsers.length === 0) {
      return NextResponse.json({ error: '转出方用户不存在' }, { status: 404 });
    }

    const fromUser = fromUsers[0];

    // 从 energy_accounts 表获取转出方能量值
    const fromEaResult = await query(
      'SELECT balance FROM energy_accounts WHERE user_id = $1',
      [from_user_id]
    );
    const fromEnergyValue = fromEaResult.length > 0 ? parseFloat(fromEaResult[0].balance || '0') : 0;

    if (fromEnergyValue < transferAmount) {
      return NextResponse.json({ error: `能量值不足，当前只有 ${fromEnergyValue}` }, { status: 400 });
    }

    // 查询接收方用户信息
    const toUsers = await query(
      'SELECT id, username, role, energy_value, provider_id, branch_id FROM users WHERE id = $1',
      [to_user_id]
    );

    if (toUsers.length === 0) {
      return NextResponse.json({ error: '接收方用户不存在' }, { status: 404 });
    }

    const toUser = toUsers[0];

    // 角色关系验证
    if (fromUser.role === 'provider' && toUser.role === 'branch') {
      const providerResult = await query(
        'SELECT branch_id FROM providers WHERE user_id = $1',
        [from_user_id]
      );
      if (providerResult.length === 0 || providerResult[0].branch_id !== to_user_id) {
        return NextResponse.json({ error: '只能向所属分公司转账' }, { status: 403 });
      }
    }

    if (fromUser.role === 'branch' && toUser.role === 'provider') {
      const providerResult = await query(
        'SELECT branch_id FROM providers WHERE user_id = $1',
        [to_user_id]
      );
      if (providerResult.length === 0 || providerResult[0].branch_id !== from_user_id) {
        return NextResponse.json({ error: '只能向旗下服务商转账' }, { status: 403 });
      }
    }

    // 会员 → 服务商：验证服务关系
    if (fromUser.role === 'member' && toUser.role === 'provider') {
      if (fromUser.provider_id !== to_user_id) {
        return NextResponse.json({ error: '只能向所属服务商转账' }, { status: 403 });
      }
    }

    // 服务商 → 会员：验证服务关系
    if (fromUser.role === 'provider' && toUser.role === 'member') {
      const memberResult = await query(
        'SELECT provider_id FROM users WHERE id = $1',
        [to_user_id]
      );
      if (memberResult.length === 0 || memberResult[0].provider_id !== from_user_id) {
        return NextResponse.json({ error: '只能向所属会员转账' }, { status: 403 });
      }
    }

    // 执行转账
    const newFromEnergy = fromEnergyValue - transferAmount;
    const toEnergyValue = parseFloat(toUser.energy_value || '0');
    const newToEnergy = toEnergyValue + transferAmount;

    // 更新转出方 - users表
    await query(
      'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
      [newFromEnergy, from_user_id]
    );

    // 更新接收方 - users表
    await query(
      'UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2',
      [newToEnergy, to_user_id]
    );

    // 同步更新 energy_accounts 表（保证统计API数据一致）
    // 转出方
    const fromAccExists = await query(
      'SELECT id FROM energy_accounts WHERE user_id = $1',
      [from_user_id]
    );
    if (fromAccExists.length > 0) {
      await query(
        'UPDATE energy_accounts SET balance = $1, total_out = total_out + $2, updated_at = NOW() WHERE user_id = $3',
        [newFromEnergy, transferAmount, from_user_id]
      );
    } else {
      await query(
        'INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at) VALUES ($1, $2, $3, 0, $4, NOW(), NOW())',
        [crypto.randomUUID(), from_user_id, newFromEnergy, transferAmount]
      );
    }

    // 接收方
    const toAccExists = await query(
      'SELECT id FROM energy_accounts WHERE user_id = $1',
      [to_user_id]
    );
    if (toAccExists.length > 0) {
      await query(
        'UPDATE energy_accounts SET balance = $1, total_in = total_in + $2, updated_at = NOW() WHERE user_id = $3',
        [newToEnergy, transferAmount, to_user_id]
      );
    } else {
      await query(
        'INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at) VALUES ($1, $2, $3, $4, 0, NOW(), NOW())',
        [crypto.randomUUID(), to_user_id, newToEnergy, transferAmount]
      );
    }

    // 记录流水 - 转出方
    await query(
      `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, note, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [crypto.randomUUID(), from_user_id, 'transfer_out', transferAmount, from_user_id, to_user_id, note || '能量值转出', 'completed']
    );

    // 记录流水 - 接收方
    await query(
      `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, note, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [crypto.randomUUID(), to_user_id, 'transfer_in', transferAmount, from_user_id, to_user_id, note || '能量值转入', 'completed']
    );

    return NextResponse.json({
      success: true,
      message: '转账成功',
      data: {
        fromEnergy: newFromEnergy,
        toEnergy: newToEnergy,
        amount: transferAmount
      }
    });
  } catch (error) {
    console.error('能量值转账失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
