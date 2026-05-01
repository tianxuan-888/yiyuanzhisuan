import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 计算持有期间的收益
function calculateHoldingProfit(
  purchasePrice: number,
  purchaseDate: Date,
  completedDate: Date,
  profitRate: number // 周期总收益率，如 0.05 表示 5%
): number {
  const holdingDays = Math.ceil((completedDate.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24));
  
  // 按持有天数占周期比例计算收益
  // 假设每个周期都是完整收益
  const profit = purchasePrice * profitRate;
  return Math.round(profit * 100) / 100;
}

// 审核流转
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅管理员和服务商可审核
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { transferId, reviewerId, action, reviewNote } = body;

    // 参数验证
    if (!transferId || !reviewerId || !action) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: '无效的审核动作' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 查询流转记录
    const { data: transfer, error: transferError } = await client
      .from('product_transfers')
      .select('*')
      .eq('id', transferId)
      .maybeSingle();

    if (transferError) {
      throw new Error(`查询流转记录失败: ${transferError.message}`);
    }

    if (!transfer) {
      return NextResponse.json({ error: '流转记录不存在' }, { status: 404 });
    }

    if (transfer.status !== 'pending' && transfer.status !== 'awaiting_payment') {
      return NextResponse.json({ error: '该流转已被处理' }, { status: 400 });
    }

    // 查询产品信息
    const { data: product, error: productError } = await client
      .from('products')
      .select('*')
      .eq('id', transfer.product_id)
      .maybeSingle();

    if (productError || !product) {
      throw new Error(`查询产品失败: ${productError?.message || '产品不存在'}`);
    }

    // 验证服务商权限
    const userAny = user as { role: string; provider_id?: string };
    if (userAny.role === 'provider' && product.provider_id !== userAny.provider_id) {
      return NextResponse.json({ error: '无权审核此流转' }, { status: 403 });
    }

    // 白名单过滤更新字段
    const baseUpdates = {
      reviewer_id: reviewerId,
      review_note: reviewNote || null,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (action === 'reject') {
      // 拒绝：更新流转状态为 rejected
      await client
        .from('product_transfers')
        .update({ ...baseUpdates, status: 'rejected' })
        .eq('id', transferId);

      // 恢复产品状态
      await client
        .from('products')
        .update({ status: 'holding', updated_at: new Date().toISOString() })
        .eq('id', transfer.product_id);

      return NextResponse.json({ success: true, message: '流转申请已拒绝' });
    }

    // ==================== 审核通过 ====================
    
    // 查询原持有用户（卖方）的购买信息
    const { data: userProduct, error: upError } = await client
      .from('user_products')
      .select('*, products(*)')
      .eq('product_id', transfer.product_id)
      .eq('status', 'holding')
      .maybeSingle();

    if (upError || !userProduct) {
      throw new Error(`查询用户产品失败: ${upError?.message || '持仓记录不存在'}`);
    }

    // 计算卖方收益（基于产品周期收益率）
    const profitRate = (product.profit_rate || 5) / 100; // 转换为小数
    const purchasePrice = parseFloat(userProduct.purchase_price) || parseFloat(product.price);
    const purchaseDate = new Date(userProduct.purchase_date);
    const completedDate = new Date();
    const holdingProfit = calculateHoldingProfit(purchasePrice, purchaseDate, completedDate, profitRate);
    const sellPrice = parseFloat(transfer.transfer_price) || purchasePrice;

    // 更新流转状态为 completed
    await client
      .from('product_transfers')
      .update({ ...baseUpdates, status: 'completed' })
      .eq('id', transferId);

    // 更新产品归属用户（从卖方转到买方）
    await client
      .from('user_products')
      .update({
        user_id: transfer.to_user_id,
        purchase_price: sellPrice, // 买方以流转价购买
        purchase_date: completedDate.toISOString(),
        updated_at: completedDate.toISOString()
      })
      .eq('product_id', transfer.product_id);

    // 更新产品状态
    await client
      .from('products')
      .update({
        status: 'holding',
        transfer_start_time: null,
        transfer_expires_at: null,
        updated_at: completedDate.toISOString()
      })
      .eq('id', transfer.product_id);

    // 发放收益给卖方（会员A）
    const sellerId = transfer.from_user_id;
    if (holdingProfit > 0) {
      // 增加卖方余额（本金已通过线下交易获得，这里只发放收益）
      await client.rpc('increment_balance', {
        p_user_id: sellerId,
        p_amount: holdingProfit
      });

      // 记录收益交易
      await client
        .from('transactions')
        .insert({
          user_id: sellerId,
          type: 'sell_profit',
          amount: holdingProfit,
          balance_before: 0,
          balance_after: holdingProfit,
          description: `流转卖出 ${product.name} 获得收益 ${holdingProfit}（${(profitRate * 100).toFixed(0)}%）`,
          created_at: completedDate.toISOString()
        });
    }

    // 记录流转完成日志
    await client
      .from('transactions')
      .insert({
        user_id: sellerId,
        type: 'transfer_out',
        amount: 0,
        balance_before: 0,
        balance_after: 0,
        description: `产品 ${product.name} 已流转给用户 ${transfer.to_user_id}`,
        created_at: completedDate.toISOString()
      });

    return NextResponse.json({ 
      success: true, 
      message: '流转审核完成，产品已转移',
      data: {
        transferId,
        fromUser: sellerId,
        toUser: transfer.to_user_id,
        productName: product.name,
        sellPrice: sellPrice,
        holdingProfit: holdingProfit,
        profitRate: profitRate * 100
      }
    });
  } catch (error) {
    console.error('审核流转失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
