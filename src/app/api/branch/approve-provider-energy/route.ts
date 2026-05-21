import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { authenticateRequest, authorizeRole } from '@/lib/auth';
import { execute, queryOne } from '@/lib/pg-client';

// 审批服务商向服务网点申请的收益
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

      // 2. 扣除服务网点收益
      const branchId = userId; // 当前服务网点ID
      const amount = desc.requestedAmount || Number((transaction as any).amount) || 0;
      const providerId = (transaction as any).user_id;
      
      // 查询服务网点收益账户
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
        
        // 记录服务网点转出流水
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
              note: `审核通过服务商收益申请，发放 ${amount} 收益`
            }),
            from_user_id: branchId,
            to_user_id: providerId,
            energy_before: branchEa.balance,
            energy_after: Math.max(0, newBranchBalance)
          });
      }
      
      // 3. 给服务商增加收益 - 使用 SQL 直接更新
      if (providerId && amount > 0) {
        const ea = await queryOne('SELECT balance, total_in FROM energy_accounts WHERE user_id = $1', [providerId]);
        
        const newBalance = (parseFloat(String(ea?.balance)) || 0) + amount;
        const newTotalIn = (parseFloat(String(ea?.total_in)) || 0) + amount;
        
        if (ea) {
          await execute('UPDATE energy_accounts SET balance = $1, total_in = $2, updated_at = NOW() WHERE user_id = $3', [newBalance, newTotalIn, providerId]);
        } else {
          await execute('INSERT INTO energy_accounts (id, user_id, balance, total_in, total_out, created_at, updated_at) VALUES ($1, $2, $3, $4, 0, NOW(), NOW())', [crypto.randomUUID(), providerId, amount, amount]);
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
              note: '服务网点审核通过，获得收益'
            }),
            from_user_id: userId,
            to_user_id: providerId,
            energy_before: ea?.balance || 0,
            energy_after: newBalance
          });
      }

      return NextResponse.json({
        success: true,
        message: '已批准收益申请，收益已发放给服务商'
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
        message: '已拒绝收益申请'
      });
    } else {
      return NextResponse.json(
        { success: false, error: '无效的操作' },
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error('审批收益申请失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
