import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

// 分公司直接转账能量值给服务商或会员
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { branchId, targetId, targetType, amount, note } = body;

    // 参数验证
    if (!branchId || !targetId || !targetType || !amount) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    if (targetType !== 'provider' && targetType !== 'member') {
      return NextResponse.json(
        { success: false, error: '目标类型无效' },
        { status: 400 }
      );
    }

    if (amount <= 0) {
      return NextResponse.json(
        { success: false, error: '转账金额必须大于0' },
        { status: 400 }
      );
    }

    // 查询分公司能量值
    const branch = await queryOne<any>(
      `SELECT id, username, energy_value FROM users WHERE id = $1 AND role = 'branch'`,
      [branchId]
    );

    if (!branch) {
      return NextResponse.json(
        { success: false, error: '分公司不存在' },
        { status: 404 }
      );
    }

    const branchEnergy = parseFloat(branch.energy_value || '0');

    if (branchEnergy < amount) {
      return NextResponse.json(
        { success: false, error: `能量值余额不足，当前余额: ${branchEnergy}` },
        { status: 400 }
      );
    }

    // 查询目标用户
    const targetRole = targetType === 'provider' ? 'provider' : 'member';
    const target = await queryOne<any>(
      `SELECT id, username, energy_value, phone FROM users WHERE id = $1 AND role = $2`,
      [targetId, targetRole]
    );

    if (!target) {
      return NextResponse.json(
        { success: false, error: `${targetType === 'provider' ? '服务商' : '会员'}不存在` },
        { status: 404 }
      );
    }

    // 如果是服务商，验证是否属于该分公司（从 providers 表获取）
    if (targetType === 'provider') {
      const providerInfo = await queryOne<any>(
        `SELECT branch_id FROM providers WHERE user_id = $1`,
        [targetId]
      );
      
      if (!providerInfo || providerInfo.branch_id !== branchId) {
        return NextResponse.json(
          { success: false, error: '该服务商不属于您的分公司' },
          { status: 403 }
        );
      }
    }

    // 执行转账
    await query(
      `UPDATE users SET energy_value = energy_value - $1, updated_at = NOW() WHERE id = $2`,
      [amount, branchId]
    );

    await query(
      `UPDATE users SET energy_value = energy_value + $1, updated_at = NOW() WHERE id = $2`,
      [amount, targetId]
    );

    // 记录分公司的支出记录
    await query(
      `INSERT INTO transactions (id, user_id, type, amount, description, created_at)
       VALUES (gen_random_uuid(), $1, 'transfer_out', $2, $3, NOW())`,
      [
        branchId,
        -amount,
        JSON.stringify({
          targetId,
          targetType,
          targetName: target.username,
          direction: 'transfer_to',
          note: note || '分公司转账',
        })
      ]
    );

    // 记录目标用户的收入记录
    await query(
      `INSERT INTO transactions (id, user_id, type, amount, description, created_at)
       VALUES (gen_random_uuid(), $1, 'transfer_in', $2, $3, NOW())`,
      [
        targetId,
        amount,
        JSON.stringify({
          sourceId: branchId,
          sourceType: 'branch',
          sourceName: branch.username,
          direction: 'receive_from',
          note: note || '收到分公司转账',
        })
      ]
    );

    // 查询更新后的余额
    const updatedBranch = await queryOne<any>(
      `SELECT energy_value FROM users WHERE id = $1`,
      [branchId]
    );

    return NextResponse.json({
      success: true,
      message: `成功转账 ${amount} 能量值给 ${target.username}`,
      data: {
        branchId,
        targetId,
        amount,
        newBalance: parseFloat(updatedBranch?.energy_value || '0'),
      },
    });
  } catch (error) {
    console.error('转账失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '转账失败' },
      { status: 500 }
    );
  }
}
