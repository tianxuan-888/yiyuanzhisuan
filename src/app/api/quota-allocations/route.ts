import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute } from '@/storage/database/pg-client';

// 获取额度分配列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    const providerId = searchParams.get('providerId');

    let sql = `SELECT qa.*, pt.name as template_name, pt.code as template_code, 
                      pt.period, pt.total_rate, pt.market_rate, pt.profit_rate,
                      u.username as provider_name, u.real_name as provider_real_name
               FROM quota_allocations qa
               LEFT JOIN product_templates pt ON qa.template_id = pt.id
               LEFT JOIN users u ON qa.provider_id = u.id
               WHERE 1=1`;
    const params: any[] = [];
    let paramIndex = 1;

    if (branchId) {
      sql += ` AND qa.branch_id = $${paramIndex++}`;
      params.push(branchId);
    }
    if (providerId) {
      sql += ` AND qa.provider_id = $${paramIndex++}`;
      params.push(providerId);
    }
    sql += ` ORDER BY qa.created_at DESC`;

    const data = await query(sql, params);

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('获取额度分配失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取额度分配失败' },
      { status: 500 }
    );
  }
}

// 分配额度给服务商（分公司）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { branchId, templateId, providerId, quotaAmount } = body;

    if (!branchId || !templateId || !providerId || !quotaAmount) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const quota = parseFloat(quotaAmount);
    if (quota < 10000) {
      return NextResponse.json(
        { error: '最小分配额度为10000' },
        { status: 400 }
      );
    }

    // 验证服务商存在
    const provider = await queryOne<{
      id: string;
      username: string;
      branch_id: string;
    }>(
      `SELECT id, username, branch_id FROM users WHERE id = $1 AND role = 'provider'`,
      [providerId]
    );

    if (!provider) {
      return NextResponse.json(
        { error: '服务商不存在' },
        { status: 404 }
      );
    }

    // 验证服务商归属
    if (provider.branch_id !== branchId) {
      return NextResponse.json(
        { error: '该服务商不属于您的分公司' },
        { status: 403 }
      );
    }

    // 检查分公司余额是否足够（从 quota_accounts 表）
    const branchQuota = await queryOne<{ balance: number }>(
      `SELECT balance FROM quota_accounts WHERE user_id = $1`,
      [branchId]
    );
    const currentBalance = branchQuota?.balance || 0;
    
    if (currentBalance < quota) {
      return NextResponse.json(
        { error: `分公司余额不足，当前余额 ${currentBalance}，分配额度 ${quota}` },
        { status: 400 }
      );
    }

    // 扣除分公司余额
    await execute(
      `UPDATE quota_accounts SET 
         balance = balance - $2,
         total_out = total_out + $2,
         updated_at = NOW()
       WHERE user_id = $1`,
      [branchId, quota]
    );

    // 创建额度分配记录
    const result = await queryOne<{ id: string }>(
      `INSERT INTO quota_allocations (template_id, branch_id, provider_id, quota_amount, used_amount, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 0, 'active', NOW(), NOW())
       RETURNING id`,
      [templateId, branchId, providerId, quota]
    );

    // 给服务商增加额度（插入或更新 quota_accounts）
    await execute(
      `INSERT INTO quota_accounts (user_id, balance, total_in, total_out, created_at, updated_at)
       VALUES ($1, $2, $2, 0, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         balance = quota_accounts.balance + $2,
         total_in = quota_accounts.total_in + $2,
         updated_at = NOW()`,
      [providerId, quota]
    );

    // 更新 providers 表的额度
    await execute(
      `UPDATE providers SET quota = quota + $2, updated_at = NOW() WHERE user_id = $1`,
      [providerId, quota]
    );

    // 记录额度分配流水
    await execute(
      `INSERT INTO quota_records (from_user_id, to_user_id, amount, type, note, created_at)
       VALUES ($1, $2, $3, 'allocation', $4, NOW())`,
      [branchId, providerId, quota, `分配给服务商 ${provider.username} 的额度`]
    );

    return NextResponse.json({
      success: true,
      data: { id: result?.id },
      message: `成功向服务商 ${provider.username} 分配 ${quota} 元额度`,
    });
  } catch (error) {
    console.error('分配额度失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '分配额度失败' },
      { status: 500 }
    );
  }
}
