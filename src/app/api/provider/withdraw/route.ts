import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/lib/supabase-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId') || searchParams.get('userId');
    
    if (!providerId) {
      return NextResponse.json({ success: false, error: '缺少userId参数' }, { status: 400 });
    }
    
    // 获取服务商提现记录
    const data = await query(
      'SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC',
      [providerId]
    );
    
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, amount, alipayAccount, realName, note } = body;
    
    if (!userId || !amount || Number(amount) < 100) {
      return NextResponse.json({ 
        success: false, 
        error: '请填写完整信息，最低提现金额为100元' 
      }, { status: 400 });
    }
    
    const withdrawAmount = Number(amount);
    
    // 查询用户余额
    const user = await queryOne(
      'SELECT id, username, balance, role FROM users WHERE id = $1',
      [userId]
    );
    
    if (!user) {
      return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
    }
    
    const currentBalance = parseFloat(String(user.balance || '0'));
    if (currentBalance < withdrawAmount) {
      return NextResponse.json({ 
        success: false, 
        error: `智算金余额不足，当前余额：${currentBalance.toFixed(2)}` 
      }, { status: 400 });
    }
    
    // 计算手续费5%
    const fee = Math.round(withdrawAmount * 0.05 * 100) / 100;
    const actualAmount = withdrawAmount - fee;
    
    // 冻结余额（申请时即扣除，避免审核时余额变化）
    await execute(
      'UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE id = $2',
      [withdrawAmount.toFixed(2), userId]
    );

    // 创建提现申请（已冻结余额，等服务网点审核）
    await execute(
      `INSERT INTO withdrawals (user_id, user_role, amount, fee, actual_amount, alipay_account, real_name, status, note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, NOW())`,
      [userId, user.role, withdrawAmount.toFixed(2), fee.toFixed(2), actualAmount.toFixed(2), alipayAccount || '', realName || '', note || `${user.role}提现申请`]
    );
    
    return NextResponse.json({ 
      success: true, 
      message: '提现申请已提交，等待服务网点审核',
      data: {
        amount: withdrawAmount.toFixed(2),
        fee: fee.toFixed(2),
        actualAmount: actualAmount.toFixed(2),
        currentBalance: currentBalance.toFixed(2),
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
