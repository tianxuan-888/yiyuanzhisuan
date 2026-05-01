import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';

// 审批服务商向分公司申请的能量值
export async function POST(request: NextRequest) {
  try {
    // 验证用户身份
    const user = authenticateRequest(request);
    if (!user || !authorizeRole(user, ['branch', 'admin'])) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const userId = user.userId as string;
    const role = user.role as string;
    const client = getSupabaseClient();

    // 解析请求体
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: '无效的请求数据' },
        { status: 400 }
      );
    }

    const { requestId, action, note } = body;

    if (!requestId || !action) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 获取申请记录 - 从 energy_transactions 表查询（与列表API一致）
    const { data: transaction, error: txError } = await client
      .from('energy_transactions')
      .select('*')
      .eq('id', requestId)
      .eq('type', 'recharge')
      .single();

    if (txError || !transaction) {
      return NextResponse.json(
        { success: false, error: '申请记录不存在' },
        { status: 404 }
      );
    }

    // 解析 description 字段获取申请信息
    let desc: Record<string, any> = { status: 'pending' };
    const rawDesc = (transaction as any).description;
    
    if (rawDesc) {
      try {
        if (typeof rawDesc === 'object') {
          desc = rawDesc;
        } else if (typeof rawDesc === 'string') {
          const parsed = JSON.parse(rawDesc);
          desc = typeof parsed === 'object' ? parsed : { status: rawDesc };
        }
      } catch (e) {
        if (rawDesc === 'pending') {
          desc = { status: 'pending' };
        } else if (rawDesc === 'approved') {
          desc = { status: 'approved' };
        } else if (rawDesc === 'rejected') {
          desc = { status: 'rejected' };
        } else {
          desc = { status: 'pending' };
        }
      }
    }
    
    if (desc.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: '该申请已被处理' },
        { status: 400 }
      );
    }

    // 执行审核
    if (action === 'approve') {
      // 1. 更新申请记录状态为approved（保留记录，状态变更）
      await client
        .from('energy_transactions')
        .update({ 
          description: JSON.stringify({ ...desc, status: 'approved', reviewed_at: new Date().toISOString(), reviewer_id: userId }),
          status: 'approved'
        })
        .eq('id', requestId);

      // 2. 扣除分公司能量值
      const branchId = userId; // 当前分公司ID
      const amount = desc.requestedAmount || Number((transaction as any).amount) || 0;
      const providerId = (transaction as any).user_id;
      
      // 查询分公司能量值账户
      const { data: branchEa } = await client
        .from('energy_accounts')
        .select('balance, total_out')
        .eq('user_id', branchId)
        .single();
      
      if (branchEa && amount > 0) {
        const newBranchBalance = Number(branchEa.balance || 0) - amount;
        const newBranchTotalOut = Number(branchEa.total_out || 0) + amount;
        
        await client
          .from('energy_accounts')
          .update({ 
            balance: Math.max(0, newBranchBalance), 
            total_out: newBranchTotalOut 
          })
          .eq('user_id', branchId);
        
        // 记录分公司转出流水
        await client
          .from('energy_transactions')
          .insert({
            user_id: branchId,
            type: 'transfer_out',
            amount: amount,
            status: 'completed',
            description: JSON.stringify({
              status: 'completed',
              source: 'approve_provider_request',
              to_user_id: providerId,
              note: `审核通过服务商能量值申请，发放 ${amount} 能量值`
            }),
            from_user_id: branchId,
            to_user_id: providerId,
            energy_before: branchEa.balance,
            energy_after: Math.max(0, newBranchBalance)
          });
      }
      
      // 3. 给服务商增加能量值
      if (providerId && amount > 0) {
        // 查询服务商能量值账户
        const { data: ea } = await client
          .from('energy_accounts')
          .select('balance, total_in')
          .eq('user_id', providerId)
          .single();
        
        const newBalance = (ea?.balance || 0) + amount;
        const newTotalIn = (ea?.total_in || 0) + amount;
        
        if (ea) {
          await client
            .from('energy_accounts')
            .update({ balance: newBalance, total_in: newTotalIn })
            .eq('user_id', providerId);
        } else {
          await client
            .from('energy_accounts')
            .insert({ user_id: providerId, balance: amount, total_in: amount });
        }

        // 4. 记录服务商收入流水
        await client
          .from('energy_transactions')
          .insert({
            user_id: providerId,
            type: 'transfer_in',
            amount: amount,
            status: 'completed',
            description: JSON.stringify({
              status: 'completed',
              source: 'branch_approved',
              parent_id: userId,
              note: '分公司审核通过，获得能量值'
            }),
            from_user_id: userId,
            to_user_id: providerId,
            energy_before: ea?.balance || 0,
            energy_after: newBalance
          });
      }

      return NextResponse.json({
        success: true,
        message: '已批准能量值申请，能量值已发放给服务商'
      });
    } else if (action === 'reject') {
      // 更新申请状态为rejected（保留记录，状态变更）
      await client
        .from('energy_transactions')
        .update({ 
          description: JSON.stringify({ ...desc, status: 'rejected', reviewed_at: new Date().toISOString(), reviewer_id: userId, reject_note: note }),
          status: 'rejected'
        })
        .eq('id', requestId);

      return NextResponse.json({
        success: true,
        message: '已拒绝能量值申请'
      });
    } else {
      return NextResponse.json(
        { success: false, error: '无效的操作' },
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error('审批能量值申请失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
