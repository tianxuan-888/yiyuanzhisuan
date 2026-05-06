import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');

        if (!userId) {
            return NextResponse.json({ success: false, error: '缺少userId' }, { status: 400 });
        }

        const supabase = getSupabaseClient();

        // 查询直推人员：inviter_id = 当前用户
        const { data: directRefs, error: refError } = await supabase
            .from('users')
            .select('id, username, phone, unique_id, role, energy_value, balance, created_at')
            .eq('inviter_id', userId)
            .order('created_at', { ascending: false });

        if (refError) {
            console.error('查询直推人员失败:', refError);
            return NextResponse.json({ success: false, error: '查询失败' }, { status: 500 });
        }

        // 统计直推人数
        const directCount = directRefs?.length || 0;

        // 查询直推人员的投资总额（从 user_products 表）
        let totalInvest = 0;
        if (directRefs && directRefs.length > 0) {
            const refIds = directRefs.map((u: { id: string }) => u.id);
            const { data: investments } = await supabase
                .from('user_products')
                .select('purchase_price')
                .in('user_id', refIds);

            if (investments) {
                totalInvest = investments.reduce((sum: number, item: { purchase_price: number }) => sum + (item.purchase_price || 0), 0);
            }
        }

        // 查询直推奖励总额（从 energy_transactions 表，type='direct_reward'）
        const { data: rewards } = await supabase
            .from('energy_transactions')
            .select('amount')
            .eq('user_id', userId)
            .eq('type', 'direct_reward');

        const totalReward = rewards?.reduce((sum: number, item: { amount: number }) => sum + (item.amount || 0), 0) || 0;

        // 格式化直推人员信息
        const members = (directRefs || []).map((u: { id: string; username: string; phone: string; unique_id: string; role: string; energy_value: number; balance: number; created_at: string }) => ({
            id: u.id,
            username: u.username,
            phone: u.phone ? u.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') : '',
            uniqueId: u.unique_id,
            role: u.role,
            energyValue: u.energy_value || 0,
            balance: u.balance || 0,
            createdAt: u.created_at,
        }));

        return NextResponse.json({
            success: true,
            data: {
                directCount,
                totalInvest,
                totalReward,
                members,
            },
        });
    } catch (error) {
        console.error('referral-stats error:', error);
        return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
    }
}
