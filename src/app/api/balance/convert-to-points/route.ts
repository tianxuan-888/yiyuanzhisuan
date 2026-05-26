import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/lib/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 收益（智算金/balance）转积分（points）
// 规则：balance可转为points，1:1转换，积分不可转回智算金
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, amount } = body;

    if (!userId || !amount) {
      return NextResponse.json({ success: false, error: '缺少必要参数' }, { status: 400 });
    }

    // 验证身份
    if (userId !== authUser.userId) {
      return NextResponse.json({ success: false, error: '只能转换自己的收益' }, { status: 403 });
    }

    const convertAmount = parseFloat(amount);
    if (isNaN(convertAmount) || convertAmount <= 0) {
      return NextResponse.json({ success: false, error: '转换金额必须大于0' }, { status: 400 });
    }

    // 最低转换金额
    if (convertAmount < 10) {
      return NextResponse.json({ success: false, error: '最低转换金额为10' }, { status: 400 });
    }

    // 查询用户余额
    const user: any = await queryOne(
      'SELECT id, username, energy_value, points, role FROM users WHERE id::text = $1',
      [userId]
    );

    if (!user) {
      return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
    }

    const currentBalance = parseFloat(String(user.energy_value)) || 0;
    if (currentBalance < convertAmount) {
      return NextResponse.json({ success: false, error: `智算金余额不足，当前余额: ${currentBalance}` }, { status: 400 });
    }

    // 执行转换：1:1，energy_value → points
    // 1. 扣除智算金
    const deductResult = await execute(
      'UPDATE users SET energy_value = energy_value - $1 WHERE id::text = $2 AND energy_value >= $1',
      [convertAmount, userId]
    );
    console.log('[convert-to-points] deduct energy result:', JSON.stringify(deductResult));

    // 验证扣除是否成功
    const afterDeduct = await query('SELECT energy_value FROM users WHERE id::text = $1', [userId]);
    console.log('[convert-to-points] after deduct energy_value:', afterDeduct?.[0]?.energy_value);

    // 2. 增加积分
    const addPointsResult = await execute(
      'UPDATE users SET points = (COALESCE(points::float, 0) + $1)::numeric WHERE id::text = $2',
      [convertAmount, userId]
    );
    console.log('[convert-to-points] add points result:', JSON.stringify(addPointsResult));

    // 验证积分是否增加
    const afterPoints = await query('SELECT points FROM users WHERE id::text = $1', [userId]);
    console.log('[convert-to-points] after add points:', afterPoints?.[0]?.points);

    // 3. 记录 transactions 明细 - 扣减智算金
    await execute(
      `INSERT INTO transactions (id, user_id, order_id, type, amount, status, description, created_at)
       VALUES (gen_random_uuid(), $1, NULL, 'balance_to_points', $2, 'completed', $3, NOW())`,
      [userId, convertAmount, JSON.stringify({ 
        type: '智算金转积分',
        convertAmount,
        note: `将${convertAmount}智算金转换为积分` 
      })]
    );

    // 4. 记录 energy_transactions 明细 - 智算金扣减
    await execute(
      `INSERT INTO energy_transactions (id, user_id, type, amount, from_user_id, to_user_id, note, created_at)
       VALUES (gen_random_uuid(), $1, 'burn', $2, $1, NULL, $3, NOW())`,
      [userId, convertAmount, `将${convertAmount}智算金转换为积分`]
    );

    // 5. 写入资金流水记录
    await execute(
      `INSERT INTO capital_flow_records (user_id, flow_type, amount, fee_amount, actual_amount, note, status, created_at)
       VALUES ($1, 'energy_to_points', $2, 0, $2, $3, 'completed', NOW())`,
      [userId, convertAmount, `将${convertAmount}智算金转换为积分`]
    );

    // 查询更新后的数据
    const updatedUser: any = await queryOne(
      'SELECT energy_value, points FROM users WHERE id::text = $1',
      [userId]
    );

    return NextResponse.json({
      success: true,
      message: `成功将 ${convertAmount} 智算金转换为积分`,
      data: {
        energyValue: parseFloat(String(updatedUser?.energy_value)) || 0,
        points: parseFloat(String(updatedUser?.points)) || 0,
        convertedAmount: convertAmount,
      },
    });
  } catch (error) {
    console.error('收益转积分失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '转换失败' },
      { status: 500 }
    );
  }
}
