import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    
    if (!userId) {
      return NextResponse.json({ success: false, message: '缺少userId' }, { status: 400 });
    }

    // Get user protection info
    const userRows = await query(
      `SELECT id, username, protection_expires_at, valid_referrals_count, created_at 
       FROM users WHERE id = $1`,
      [userId]
    ) as any[];

    if (!userRows || userRows.length === 0) {
      return NextResponse.json({ success: false, message: '用户不存在' }, { status: 404 });
    }

    const user = userRows[0];

    // Calculate protection status
    const now = new Date();
    const expiresAt = user.protection_expires_at ? new Date(user.protection_expires_at) : null;
    const isActive = expiresAt ? expiresAt > now : false;
    
    let remainingDays = 0;
    let remainingHours = 0;
    if (isActive && expiresAt) {
      const diff = expiresAt.getTime() - now.getTime();
      remainingDays = Math.floor(diff / (1000 * 60 * 60 * 24));
      remainingHours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    }

    // Get total referrals count
    const referralCountRows = await query(
      `SELECT COUNT(*) as total_count FROM users WHERE inviter_id = $1`,
      [userId]
    ) as any[];
    const totalReferrals = parseInt(referralCountRows?.[0]?.total_count || '0');

    // Get valid referrals list (referred users with total purchase >= 3000)
    const validReferrals = await query(
      `SELECT 
        referred.id,
        referred.username,
        referred.unique_id,
        referred.phone,
        COALESCE(SUM(up.purchase_price), 0) as total_purchase,
        COUNT(up.id) as purchase_count
       FROM users referred
       LEFT JOIN user_products up ON up.user_id = referred.id AND up.status IN ('holding', 'sold')
       WHERE referred.inviter_id = $1
       GROUP BY referred.id, referred.username, referred.unique_id, referred.phone
       HAVING COALESCE(SUM(up.purchase_price), 0) >= 3000
       ORDER BY total_purchase DESC`,
      [userId]
    ) as any[];

    // Get all referrals with purchase info (for showing which are valid/pending)
    const allReferrals = await query(
      `SELECT 
        referred.id,
        referred.username,
        referred.unique_id,
        referred.phone,
        referred.created_at,
        COALESCE(SUM(up.purchase_price), 0) as total_purchase,
        COUNT(up.id) as purchase_count,
        CASE WHEN COALESCE(SUM(up.purchase_price), 0) >= 3000 THEN true ELSE false END as is_valid
       FROM users referred
       LEFT JOIN user_products up ON up.user_id = referred.id AND up.status IN ('holding', 'sold')
       WHERE referred.inviter_id = $1
       GROUP BY referred.id, referred.username, referred.unique_id, referred.phone, referred.created_at
       ORDER BY referred.created_at DESC`,
      [userId]
    ) as any[];

    // Calculate next milestone: how many more referrals needed for next extension
    const currentValidCount = user.valid_referrals_count || 0;

    return NextResponse.json({
      success: true,
      data: {
        protection: {
          isActive,
          expiresAt: user.protection_expires_at,
          remainingDays,
          remainingHours,
          initialDays: 18,
          extendedDays: currentValidCount * 18,
          totalDays: 18 + currentValidCount * 18,
        },
        referrals: {
          totalReferrals,
          validReferralsCount: currentValidCount,
          validReferrals: validReferrals || [],
          allReferrals: allReferrals || [],
          nextReferralReward: '+18天保护期',
          validThreshold: 3000,
        }
      }
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    console.error('[protection] Error:', message);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
