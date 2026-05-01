import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 审核会员卖出申请
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅服务商可操作
    const authUser = authenticateRequest(request);
    if (!authUser || !authorizeRole(authUser, ['provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    // 从 JWT 获取服务商 ID
    const providerId = authUser.userId;

    const body = await request.json();
    const { userProductId, action } = body; // action: 'approve' | 'reject'

    if (!userProductId || !action) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: '无效的操作类型' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient();

    // 查询用户产品
    const { data: userProduct, error: productError } = await client
      .from('user_products')
      .select('*')
      .eq('id', userProductId)
      .eq('status', 'pending_sell')
      .maybeSingle();

    if (productError) {
      throw new Error(`查询产品失败: ${productError.message}`);
    }

    if (!userProduct) {
      return NextResponse.json(
        { error: '产品不存在或不在待审核状态' },
        { status: 404 }
      );
    }

    // 查询用户信息验证权限
    const { data: productUser, error: userError } = await client
      .from('users')
      .select('id, provider_id, username, balance')
      .eq('id', userProduct.user_id)
      .maybeSingle();

    if (userError || !productUser) {
      throw new Error('查询用户失败');
    }

    // 验证服务商权限
    if (productUser.provider_id !== providerId) {
      return NextResponse.json(
        { error: '无权审核此产品' },
        { status: 403 }
      );
    }

    if (action === 'approve') {
      // 审核通过，计算收益
      const purchasePrice = parseFloat(userProduct.purchase_price);
      const expectedProfit = parseFloat(userProduct.expected_profit);
      const totalReturn = purchasePrice + expectedProfit;

      // 更新产品状态为已卖出
      const { error: updateError } = await client
        .from('user_products')
        .update({
          status: 'sold',
          sell_price: totalReturn,
          sell_date: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', userProductId);

      if (updateError) {
        throw new Error(`更新产品状态失败: ${updateError.message}`);
      }

      // 增加用户余额
      const currentBalance = parseFloat(productUser.balance);
      const newBalance = currentBalance + totalReturn;

      await client
        .from('users')
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq('id', userProduct.user_id);

      // 记录交易
      await client
        .from('transactions')
        .insert({
          id: crypto.randomUUID(),
          user_id: userProduct.user_id,
          type: 'profit',
          amount: totalReturn,
          balance_before: currentBalance,
          balance_after: newBalance,
          description: `卖出产品收益`,
          created_at: new Date().toISOString(),
        });

      return NextResponse.json({
        success: true,
        message: '审核通过，产品已卖出',
        data: {
          status: 'sold',
          total_return: totalReturn,
        },
      });
    } else {
      // 审核拒绝，恢复持有状态
      const { error: updateError } = await client
        .from('user_products')
        .update({
          status: 'holding',
          updated_at: new Date().toISOString(),
        })
        .eq('id', userProductId);

      if (updateError) {
        throw new Error(`更新产品状态失败: ${updateError.message}`);
      }

      return NextResponse.json({
        success: true,
        message: '已拒绝卖出申请',
        data: { status: 'holding' },
      });
    }
  } catch (error) {
    console.error('审核卖出失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '审核卖出失败' },
      { status: 500 }
    );
  }
}
