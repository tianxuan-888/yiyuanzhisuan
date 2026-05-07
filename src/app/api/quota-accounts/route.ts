import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/storage/database/pg-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const role = searchParams.get('role');

    let sql = `
      SELECT qa.*, u.username, u.role, u.phone, u.unique_id
      FROM quota_accounts qa
      LEFT JOIN users u ON u.id = qa.user_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (userId) {
      sql += ` AND qa.user_id = $${params.length + 1}`;
      params.push(userId);
    }

    if (role) {
      sql += ` AND u.role = $${params.length + 1}`;
      params.push(role);
    }

    sql += ` ORDER BY qa.created_at DESC`;

    let accounts = await query(sql, params);

    // 补充 admin 的额度信息（从 company_quota 表获取）
    // admin 不一定在 quota_accounts 表中有记录，但 company_quota 表记录了总公司总额度
    const adminInList = accounts.find((a: any) => a.role === 'admin');
    if (!adminInList) {
      // 查询 company_quota 获取总公司额度
      const companyQuota = await query(
        'SELECT total_quota, used_quota, available_quota FROM company_quota LIMIT 1'
      );
      // 查询 admin 用户信息
      const adminUser = await query(
        'SELECT id, username, role, phone, unique_id FROM users WHERE role = $1 LIMIT 1',
        ['admin']
      );
      if (companyQuota.length > 0 && adminUser.length > 0) {
        accounts.unshift({
          id: 'company-quota',
          user_id: adminUser[0].id,
          balance: Number(companyQuota[0].available_quota),
          total_in: Number(companyQuota[0].total_quota),
          total_out: Number(companyQuota[0].used_quota),
          created_at: companyQuota[0].created_at || new Date().toISOString(),
          updated_at: companyQuota[0].updated_at || new Date().toISOString(),
          username: adminUser[0].username,
          role: adminUser[0].role,
          phone: adminUser[0].phone,
          unique_id: adminUser[0].unique_id,
        });
      }
    }

    // 补充尚未在 quota_accounts 表中有记录的 branch 用户
    // 新注册的分公司可能只有 users 表记录，没有 quota_accounts 记录
    const existingUserIds = accounts
      .filter((a: any) => a.user_id)
      .map((a: any) => String(a.user_id));

    const missingBranchSql = existingUserIds.length > 0
      ? `SELECT id, username, role, phone, unique_id FROM users WHERE role = 'branch' AND id NOT IN (${existingUserIds.map((_, i) => `$${i + 1}`).join(',')})`
      : `SELECT id, username, role, phone, unique_id FROM users WHERE role = 'branch'`;

    const missingBranches = await query(missingBranchSql, existingUserIds);

    for (const branch of missingBranches) {
      accounts.push({
        id: `pending-qa-${branch.id}`,
        user_id: branch.id,
        balance: 0,
        total_in: 0,
        total_out: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        username: branch.username,
        role: branch.role,
        phone: branch.phone,
        unique_id: branch.unique_id,
      });
    }

    return NextResponse.json({
      success: true,
      data: accounts,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, amount, note } = body;

    if (!userId || !amount) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 插入额度账户
    await query(
      `INSERT INTO quota_accounts (user_id, balance, total_in, total_out)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, 0, 0, 0]
    );

    return NextResponse.json({
      success: true,
      message: '额度账户创建成功',
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
