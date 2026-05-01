import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 服务商回购流转产品（48小时无人购买时执行）
export async function POST(request: NextRequest) {
  try {
    // 鉴权：仅管理员和服务商可操作
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['admin', 'provider'])) {
      return NextResponse.json({ error: '无权操作' }, { status: 403 });
    }

    const body = await request.json();
    const { transferId, providerId } = body;

    // 参数验证
    if (!transferId || !providerId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
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

    // 验证流转是否已过期
    if (new Date(transfer.expires_at) > new Date()) {
      return NextResponse.json({ error: '流转尚未过期，不能回购' }, { status: 400 });
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

    // 验证服务商是否拥有该产品
    if (user.role === 'provider' && product.provider_id !== providerId) {
      return NextResponse.json({ error: '无权回购此产品' }, { status: 403 });
    }

    // 获取流转原价（本金）
    const repurchasePrice = parseFloat(transfer.transfer_price) || parseFloat(product.price);
    const sellerId = transfer.from_user_id; // 卖方（会员A）

    // 更新流转状态为已回购
    await client
      .from('product_transfers')
      .update({
        status: 'repurchased',
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', transferId);

    // 更新产品状态为服务商库存（可再次上架销售）
    await client
      .from('products')
      .update({
        status: 'available',
        transfer_start_time: null,
        transfer_expires_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', transfer.product_id);

    // 将产品归属改回服务商
    const { data: provider } = await client
      .from('providers')
      .select('user_id')
      .eq('id', providerId)
      .maybeSingle();

    if (provider) {
      await client
        .from('user_products')
        .update({
          user_id: provider.user_id,
          status: 'available', // 回到服务商待售状态
          updated_at: new Date().toISOString()
        })
        .eq('product_id', transfer.product_id);
    }

    // 【关键】服务商线下把本金返还给卖方（会员A）
    // 注意：本金是线下返还，这里只记录流水日志
    await client
      .from('transactions')
      .insert({
        user_id: sellerId,
        type: 'repurchase_refund',
        amount: repurchasePrice,
        balance_before: 0,
        balance_after: 0,
        description: `服务商回购产品 ${product.name}，本金 ${repurchasePrice} 元需线下返还`,
        created_at: new Date().toISOString()
      });

    return NextResponse.json({
      success: true,
      message: '回购成功，产品已退回服务商代售列表，请线下返还本金给卖方',
      data: { 
        repurchaseAmount: repurchasePrice,
        sellerId: sellerId,
        productName: product.name,
        note: '服务商需线下向卖方返还本金'
      }
    });
  } catch (error) {
    console.error('回购流转失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
