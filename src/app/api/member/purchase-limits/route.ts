import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/storage/database/pg-client';

// 辅助函数：将PostgreSQL numeric格式转换为数字
function parseNumeric(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const match = val.match(/\{(\d+)\s+(-?\d+)/);
    if (match) {
      return parseFloat(match[1]) * Math.pow(10, parseInt(match[2]));
    }
    return parseFloat(val) || 0;
  }
  return 0;
}

// 获取会员购买限制信息
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: '用户ID不能为空' }, { status: 400 });
    }

    // 查询用户信息
    const user: any = await queryOne(
      `SELECT id, username, inviter_id, created_at FROM users WHERE id = $1`,
      [userId]
    );

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    // 检查是否有有效推荐人（推荐人也要购买过产品才算）
    let hasValidInviter = false;
    let inviterInfo: any = null;
    
    if (user.inviter_id) {
      // 查询推荐人信息
      const inviter: any = await queryOne(
        `SELECT id, username FROM users WHERE id = $1`,
        [user.inviter_id]
      );
      
      if (inviter) {
        // 检查推荐人是否购买过产品
        const inviterPurchase: any = await queryOne(
          `SELECT COUNT(*) as count FROM user_products WHERE user_id = $1 AND status = 'holding'`,
          [inviter.id]
        );
        
        const inviterHasPurchase = parseInt(inviterPurchase?.count || '0') > 0;
        
        if (inviterHasPurchase) {
          hasValidInviter = true;
          inviterInfo = {
            id: inviter.id,
            username: inviter.username,
          };
        }
      }
    }

    // 查询当前持仓金额
    const holdingsResult: any = await queryOne(
      `SELECT COALESCE(SUM(purchase_price), 0) as total_holding
       FROM user_products 
       WHERE user_id = $1 AND status = 'holding'`,
      [userId]
    );
    const totalHolding = parseNumeric(holdingsResult?.total_holding);

    // 查询持仓中的产品，获取第一次购买日期
    const firstPurchaseResult: any = await queryOne(
      `SELECT MIN(up.purchase_date) as first_date
       FROM user_products up
       WHERE up.user_id = $1 AND up.status = 'holding'`,
      [userId]
    );
    const firstPurchaseDate = firstPurchaseResult?.first_date;

    // 计算限制期信息
    const lockDays = 20;
    const lockEndDate = firstPurchaseDate ? 
      new Date(new Date(firstPurchaseDate).getTime() + lockDays * 24 * 60 * 60 * 1000) : null;
    
    const now = new Date();
    // 时间锁：超过20天且无有效推荐人
    const withinGracePeriod = lockEndDate ? now < lockEndDate : false;
    const isTimeLocked = !hasValidInviter && lockEndDate && now >= lockEndDate;

    // 持仓限制配置
    const maxHolding = 20000;
    const remainingHolding = maxHolding - totalHolding;

    // 购买限制状态
    const purchaseLimits = {
      // 持仓限制
      maxHolding,
      currentHolding: totalHolding,
      remainingHolding,
      holdingLimitReached: totalHolding >= maxHolding,
      
      // 时间锁（无有效推荐人）
      hasValidInviter,
      inviterInfo,
      lockDays,
      firstPurchaseDate,
      lockEndDate: lockEndDate?.toISOString() || null,
      graceRemainingDays: withinGracePeriod && lockEndDate ? Math.max(0, Math.ceil((lockEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : 0,
      isTimeLocked,
      
      // 综合购买状态
      canBuy: totalHolding < maxHolding && !isTimeLocked,
      
      // 限制提示
      limitMessage: 
        totalHolding >= maxHolding ?
        `持仓已达上限（${totalHolding.toLocaleString()}/${maxHolding.toLocaleString()}元）` :
        isTimeLocked ?
        `超过${lockDays}天保护期，需绑定有效推荐人才能继续购买` :
        null,
    };

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          hasValidInviter,
          inviterInfo,
        },
        limits: purchaseLimits,
      }
    });
  } catch (error) {
    console.error('获取购买限制信息失败:', error);
    return NextResponse.json({
      success: false,
      error: '获取购买限制信息失败'
    }, { status: 500 });
  }
}
