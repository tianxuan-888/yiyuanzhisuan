import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest } from '@/lib/auth';

// 购买流转产品
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
    const { transferId, paymentProof } = body;

    // 参数验证
    if (!transferId) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
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
      return NextResponse.json(
        { error: '流转记录不存在' },
        { status: 404 }
      );
    }

    // 验证流转状态
    if (transfer.status !== 'pending') {
      return NextResponse.json(
        { error: '该流转已结束' },
        { status: 400 }
      );
    }

    // 验证是否过期
    if (new Date(transfer.expires_at) < new Date()) {
      return NextResponse.json(
        { error: '该流转已过期' },
        { status: 400 }
      );
    }

    // 验证不能购买自己的流转
    if (transfer.from_user_id === userId) {
      return NextResponse.json(
        { error: '不能购买自己发布的流转' },
        { status: 400 }
      );
    }

    // 查询服务商信息（用于显示收款账号）
    const { data: provider } = await client
      .from('users')
      .select('id, username, wechat_account, alipay_account')
      .eq('role', 'provider')
      .maybeSingle();

    // 更新流转记录
    const { error: updateError } = await client
      .from('product_transfers')
      .update({
        to_user_id: userId,
        payment_proof: paymentProof || null,
        status: 'pending',
      })
      .eq('id', transferId);

    if (updateError) {
      throw new Error(`更新流转记录失败: ${updateError.message}`);
    }

    // 查询产品信息
    const { data: product } = await client
      .from('products')
      .select('*')
      .eq('id', transfer.product_id)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      message: '购买申请已提交，等待服务商审核',
      data: {
        transfer: {
          id: transfer.id,
          transferPrice: transfer.transfer_price,
          status: 'pending',
        },
        product: product ? {
          id: product.id,
          name: product.name,
        } : null,
        provider: provider ? {
          wechatAccount: provider.wechat_account,
          alipayAccount: provider.alipay_account,
        } : null,
      },
    });
  } catch (error) {
    console.error('购买流转产品失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '购买失败' },
      { status: 500 }
    );
  }
}
