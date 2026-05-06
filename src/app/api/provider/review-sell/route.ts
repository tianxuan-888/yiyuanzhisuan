import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { getSupabaseUrl, getSupabaseServiceRoleKey } from '@/lib/env';
import { execute } from '@/lib/pg-client';

// 获取管理员 Supabase 客户端（绕过 RLS）
function getAdminSupabase() {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    throw new Error('Missing Supabase configuration');
  }
  return createClient(url, key);
}

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

    const client = getAdminSupabase();

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

      // 查询产品信息（用于收益记录描述）
      const { data: productInfo } = await client
        .from('products')
        .select('id, name, code, period, total_rate, profit_rate')
        .eq('id', userProduct.product_id)
        .maybeSingle();

      const productName = productInfo?.name || '未知产品';
      const productPeriod = productInfo?.period || 0;
      const profitRate = productInfo?.profit_rate || 0;

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

      // 增加用户余额 - 使用 SQL 直接执行
      const currentBalance = parseFloat(productUser.balance);
      const newBalance = currentBalance + totalReturn;

      await execute('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2', [newBalance, userProduct.user_id]);

      // ========== 记录会员收益到 member_revenue 表 ==========
      const revenueId = crypto.randomUUID();
      await client
        .from('member_revenue')
        .insert({
          id: revenueId,
          user_id: userProduct.user_id,
          order_id: userProduct.order_id || null,
          user_product_id: userProductId,
          principal: purchasePrice,
          profit: expectedProfit,
          total_amount: totalReturn,
          converted_to_energy: 0,
          status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      // ========== 写入收益明细流水 revenue_details ==========
      // 1. 本金入账
      await client
        .from('revenue_details')
        .insert({
          id: crypto.randomUUID(),
          user_id: userProduct.user_id,
          revenue_id: revenueId,
          type: 'principal_in',
          amount: purchasePrice,
          balance_before: currentBalance,
          balance_after: currentBalance + purchasePrice,
          description: `卖出${productPeriod}天产品「${productName}」本金返还`,
          related_id: userProduct.product_id,
          created_at: new Date().toISOString(),
        });

      // 2. 收益入账
      await client
        .from('revenue_details')
        .insert({
          id: crypto.randomUUID(),
          user_id: userProduct.user_id,
          revenue_id: revenueId,
          type: 'profit_in',
          amount: expectedProfit,
          balance_before: currentBalance + purchasePrice,
          balance_after: newBalance,
          description: `持有${productPeriod}天产品「${productName}」到期收益（收益率${profitRate}%）`,
          related_id: userProduct.product_id,
          created_at: new Date().toISOString(),
        });

      // 记录交易流水
      await client
        .from('transactions')
        .insert({
          id: crypto.randomUUID(),
          user_id: userProduct.user_id,
          type: 'profit',
          amount: totalReturn,
          balance_before: currentBalance,
          balance_after: newBalance,
          description: `卖出${productPeriod}天产品「${productName}」，本金¥${purchasePrice}+收益¥${expectedProfit}`,
          created_at: new Date().toISOString(),
        });

      return NextResponse.json({
        success: true,
        message: '审核通过，产品已卖出',
        data: {
          status: 'sold',
          total_return: totalReturn,
          principal: purchasePrice,
          profit: expectedProfit,
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
