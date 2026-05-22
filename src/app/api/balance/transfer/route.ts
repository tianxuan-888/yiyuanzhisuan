import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';
import { authenticateRequest } from '@/lib/auth';

// 智算金（balance）互转 - 所有用户都可以互相转账
export async function POST(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { fromUserId, toUserId, amount, note } = body;

    if (!fromUserId || !toUserId || !amount) {
      return NextResponse.json({ success: false, error: '缺少必要参数' }, { status: 400 });
    }

    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      return NextResponse.json({ success: false, error: '转账金额必须大于0' }, { status: 400 });
    }

    // 最低转账金额
    if (transferAmount < 50) {
      return NextResponse.json({ success: false, error: '最低转账金额为50' }, { status: 400 });
    }

    // 不能转给自己
    if (fromUserId === toUserId) {
      return NextResponse.json({ success: false, error: '不能转给自己' }, { status: 400 });
    }

    // 验证转出方身份
    if (fromUserId !== authUser.userId) {
      return NextResponse.json({ success: false, error: '只能从自己的账户转出' }, { status: 403 });
    }

    // 查询转出方余额
    const fromUser: any = await queryOne(
      'SELECT id, username, balance, role FROM users WHERE id::text = $1',
      [fromUserId]
    );

    if (!fromUser) {
      return NextResponse.json({ success: false, error: '转出方用户不存在' }, { status: 404 });
    }

    const fromBalance = parseFloat(String(fromUser.balance)) || 0;
    if (fromBalance < transferAmount) {
      return NextResponse.json({ success: false, error: `余额不足，当前余额: ${fromBalance}` }, { status: 400 });
    }

    // 查询转入方
    const toUser: any = await queryOne(
      'SELECT id, username, balance, role FROM users WHERE id::text = $1',
      [toUserId]
    );

    if (!toUser) {
      return NextResponse.json({ success: false, error: '转入方用户不存在' }, { status: 404 });
    }

    // 执行转账（使用SQL直接执行，避免REST API静默失败）
    // 1. 扣除转出方余额
    await query(
      'UPDATE users SET balance = (balance::float - $1)::numeric WHERE id::text = $2',
      [transferAmount, fromUserId]
    );

    // 2. 增加转入方余额
    await query(
      'UPDATE users SET balance = (balance::float + $1)::numeric WHERE id::text = $2',
      [transferAmount, toUserId]
    );

    // 3. 记录交易 - 转出方
    await query(
      `INSERT INTO transactions (id, user_id, order_id, type, amount, status, description, created_at)
       VALUES (gen_random_uuid(), $1, NULL, 'balance_transfer_out', $2, 'completed', $3, NOW())`,
      [fromUserId, transferAmount, JSON.stringify({ toUser: toUser.username, toUserId, note: note || '智算金转出' })]
    );

    // 4. 记录交易 - 转入方
    await query(
      `INSERT INTO transactions (id, user_id, order_id, type, amount, status, description, created_at)
       VALUES (gen_random_uuid(), $1, NULL, 'balance_transfer_in', $2, 'completed', $3, NOW())`,
      [toUserId, transferAmount, JSON.stringify({ fromUser: fromUser.username, fromUserId, note: note || '智算金转入' })]
    );

    // 查询更新后的余额
    const updatedFromUser: any = await queryOne(
      'SELECT balance FROM users WHERE id::text = $1',
      [fromUserId]
    );
    const updatedToUser: any = await queryOne(
      'SELECT balance FROM users WHERE id::text = $1',
      [toUserId]
    );

    return NextResponse.json({
      success: true,
      message: `成功转账 ${transferAmount} 智算金给 ${toUser.username}`,
      data: {
        fromBalance: parseFloat(String(updatedFromUser?.balance)) || 0,
        toBalance: parseFloat(String(updatedToUser?.balance)) || 0,
        amount: transferAmount,
      },
    });
  } catch (error) {
    console.error('智算金转账失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '转账失败' },
      { status: 500 }
    );
  }
}

// 获取可转账对象列表
export async function GET(request: NextRequest) {
  try {
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || authUser.userId;
    const role = searchParams.get('role') || authUser.role;

    const targets: any[] = [];

    // 根据角色获取可转账对象
    if (role === 'admin') {
      // 总公司可以转给所有服务网点和服务商
      const branches: any = await query(
        'SELECT id, username, role, balance, unique_id, phone FROM users WHERE role = $1 AND is_active = true ORDER BY username',
        ['branch']
      );
      const providers: any = await query(
        'SELECT id, username, role, balance, unique_id, phone FROM users WHERE role = $1 AND is_active = true ORDER BY username',
        ['provider']
      );
      targets.push(...(branches || []), ...(providers || []));
    } else if (role === 'branch') {
      // 服务网点可以转给下属服务商和会员
      const branchUser: any = await queryOne(
        'SELECT id FROM users WHERE id::text = $1 AND role = $2',
        [userId, 'branch']
      );
      if (branchUser) {
        const providers: any = await query(
          'SELECT id, username, role, balance, unique_id, phone FROM users WHERE role = $1 AND branch_id::text = $2 AND is_active = true ORDER BY username',
          ['provider', userId]
        );
        const members: any = await query(
          'SELECT id, username, role, balance, unique_id, phone FROM users WHERE role = $1 AND branch_id::text = $2 AND is_active = true ORDER BY username',
          ['member', userId]
        );
        targets.push(...(providers || []), ...(members || []));
      }
    } else if (role === 'provider') {
      // 服务商可以转给下属会员
      const members: any = await query(
        'SELECT id, username, role, balance, unique_id, phone FROM users WHERE role = $1 AND provider_id::text = $2 AND is_active = true ORDER BY username',
        ['member', userId]
      );
      targets.push(...(members || []));
      // 也可以转给上级服务商
      const providerUser: any = await queryOne(
        'SELECT inviter_id FROM users WHERE id::text = $1 AND role = $2',
        [userId, 'provider']
      );
      if (providerUser?.inviter_id) {
        const parentProvider: any = await queryOne(
          'SELECT id, username, role, balance, unique_id, phone FROM users WHERE id::text = $1',
          [providerUser.inviter_id]
        );
        if (parentProvider) targets.unshift(parentProvider);
      }
    } else if (role === 'member') {
      // 会员可以转给服务商和其他会员
      const memberUser: any = await queryOne(
        'SELECT provider_id FROM users WHERE id::text = $1',
        [userId]
      );
      if (memberUser?.provider_id) {
        const provider: any = await queryOne(
          'SELECT id, username, role, balance, unique_id, phone FROM users WHERE id::text = $1',
          [memberUser.provider_id]
        );
        if (provider) targets.push(provider);
      }
    }

    // 去重
    const seen = new Set<string>();
    const uniqueTargets = targets.filter((t: any) => {
      if (seen.has(t.id) || t.id === userId) return false;
      seen.add(t.id);
      return true;
    });

    return NextResponse.json({
      success: true,
      data: uniqueTargets.map((t: any) => ({
        id: t.id,
        username: t.username,
        role: t.role,
        balance: parseFloat(String(t.balance)) || 0,
        uniqueId: t.unique_id,
        phone: t.phone,
      })),
    });
  } catch (error) {
    console.error('获取转账对象失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    );
  }
}
