import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest } from '@/lib/auth';
import { execute, queryOne } from '@/lib/pg-client';

// 确认卖出收益（会员确认收款后执行收益分配）
export async function POST(request: NextRequest) {
  try {
    // 鉴权
    const authUser = authenticateRequest(request);
    if (!authUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    // 从 JWT 获取用户 ID
    const userId = authUser.userId;

    const body = await request.json();
    const { orderId } = body;

    if (!orderId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 查询订单信息
    const { data: order, error: orderError } = await client
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) {
      throw new Error(`查询订单失败: ${orderError.message}`);
    }

    if (!order) {
      return NextResponse.json({ error: '订单不存在' }, { status: 404 });
    }

    if (order.order_type !== 'sell') {
      return NextResponse.json({ error: '非卖出订单' }, { status: 400 });
    }

    if (order.status !== 'awaiting_payment') {
      return NextResponse.json({ error: '订单状态不允许确认' }, { status: 400 });
    }

    // 查询用户产品信息
    const { data: userProduct, error: userProductError } = await client
      .from('user_products')
      .select('*, products(*)')
      .eq('id', order.user_product_id)
      .maybeSingle();

    if (userProductError) {
      throw new Error(`查询用户产品失败: ${userProductError.message}`);
    }

    // 查询系统配置
    const { data: configs } = await client
      .from('system_config')
      .select('key, value')
      .in('key', [
        'profit_cash_ratio',
        'profit_points_ratio',
        'energy_allocation_provider',
        'energy_allocation_company',
        'energy_allocation_direct',
        'energy_allocation_parent_provider',
        'energy_allocation_branch',
      ]);

    const configMap: Record<string, string> = {};
    configs?.forEach((c: any) => {
      configMap[c.key] = c.value;
    });

    // 计算收益
    const purchasePrice = parseFloat(userProduct?.purchase_price || '0');
    const expectedProfit = parseFloat(userProduct?.expected_profit || '0');
    const marketFee = parseFloat(userProduct?.market_fee || '0');
    
    const totalAmount = purchasePrice + expectedProfit; // 总金额 = 本金 + 收益
    const cashRatio = parseInt(configMap['profit_cash_ratio'] || '95') / 100;
    const pointsRatio = parseInt(configMap['profit_points_ratio'] || '5') / 100;

    const cashAmount = Math.floor(expectedProfit * cashRatio); // 95% 现金
    const pointsAmount = Math.floor(expectedProfit * pointsRatio); // 5% 积分

    // 查询用户信息
    const { data: user, error: userError } = await client
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (userError || !user) {
      throw new Error(`查询用户失败: ${userError?.message || '用户不存在'}`);
    }

    // 使用 SQL 直接更新用户余额和积分，确保写入成功
    const currentBalance = parseFloat(user.balance || '0');
    const currentPoints = parseFloat(user.points || '0');
    const newBalance = currentBalance + cashAmount;
    const newPoints = currentPoints + pointsAmount;

    await execute('UPDATE users SET balance = $1, points = $2, updated_at = NOW() WHERE id = $3', [newBalance, newPoints, userId]);

    // 更新订单状态
    await client
      .from('orders')
      .update({
        status: 'completed',
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    // 更新用户产品状态为已卖出
    await client
      .from('user_products')
      .update({
        status: 'sold',
        sell_price: totalAmount,
        sell_date: new Date().toISOString(),
      })
      .eq('id', order.user_product_id);

    // 能量值分配
    const providerRatio = parseInt(configMap['energy_allocation_provider'] || '70') / 100;
    const companyRatio = parseInt(configMap['energy_allocation_company'] || '10') / 100;
    const directRatio = parseInt(configMap['energy_allocation_direct'] || '10') / 100;
    const parentProviderRatio = parseInt(configMap['energy_allocation_parent_provider'] || '5') / 100;
    const branchRatio = parseInt(configMap['energy_allocation_branch'] || '5') / 100;

    const providerEnergy = Math.floor(marketFee * providerRatio);
    const companyEnergy = Math.floor(marketFee * companyRatio);
    const directEnergy = Math.floor(marketFee * directRatio);
    const parentProviderEnergy = Math.floor(marketFee * parentProviderRatio);
    const branchEnergy = Math.floor(marketFee * branchRatio);

    // 分配能量值给服务商 - 使用 SQL 直接更新
    if (user.provider_id) {
      const providerRow = await queryOne('SELECT energy_value FROM users WHERE id = $1', [user.provider_id]);
      if (providerRow) {
        const providerCurrentEnergy = parseFloat(String(providerRow.energy_value)) || 0;
        const newProvEnergy = providerCurrentEnergy + providerEnergy;
        await execute('UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2', [newProvEnergy, user.provider_id]);

        await client.from('energy_transactions').insert({
          user_id: user.provider_id,
          type: 'sell_product',
          amount: providerEnergy,
          balance: newProvEnergy,
          related_user_id: userId,
          description: `会员 ${user.username} 卖出产品，获得能量值分成 ${providerEnergy}`,
        });
      }
    }

    // 分配能量值给直推 - 使用 SQL 直接更新
    if (user.inviter_id) {
      const inviterRow = await queryOne('SELECT energy_value FROM users WHERE id = $1', [user.inviter_id]);
      if (inviterRow) {
        const inviterCurrentEnergy = parseFloat(String(inviterRow.energy_value)) || 0;
        const newInviterEnergy = inviterCurrentEnergy + directEnergy;
        await execute('UPDATE users SET energy_value = $1, updated_at = NOW() WHERE id = $2', [newInviterEnergy, user.inviter_id]);

        await client.from('energy_transactions').insert({
          user_id: user.inviter_id,
          type: 'sell_product',
          amount: directEnergy,
          balance: newInviterEnergy,
          related_user_id: userId,
          description: `直推奖励：会员 ${user.username} 卖出产品，获得能量值 ${directEnergy}`,
        });
      }
    }

    // 记录用户的收益交易
    await client.from('transactions').insert({
      user_id: userId,
      order_id: orderId,
      type: 'sell_profit',
      amount: expectedProfit,
      balance: newBalance,
      description: `卖出产品获得收益 ${expectedProfit}（现金 ${cashAmount} + 积分 ${pointsAmount}）`,
    });

    return NextResponse.json({
      success: true,
      message: '收益已到账',
      data: {
        user: {
          id: userId,
          username: user.username,
          beforeBalance: currentBalance,
          afterBalance: newBalance,
          beforePoints: currentPoints,
          afterPoints: newPoints,
        },
        profit: {
          totalProfit: expectedProfit,
          cashAmount,
          pointsAmount,
        },
        energyDistribution: {
          provider: providerEnergy,
          company: companyEnergy,
          direct: directEnergy,
          parentProvider: parentProviderEnergy,
          branch: branchEnergy,
          total: marketFee,
        },
      },
    });
  } catch (error) {
    console.error('确认卖出收益失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '确认失败' },
      { status: 500 }
    );
  }
}
