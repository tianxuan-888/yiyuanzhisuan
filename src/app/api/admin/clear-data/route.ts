import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, execute } from '@/storage/database/pg-client';

// 清除业务数据（仅限管理员）
export async function POST(request: NextRequest) {
  try {
    // 验证管理员权限
    const auth = await requireAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: '无权限操作' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { type: clearType } = body;

    // 要清除的表
    const businessTables = [
      'notifications',
      'energy_transactions',
      'transactions',
      'withdrawals',
      'orders',
      'user_products',
      'products',
      'quota_requests',
      'provider_applications',
      'quota_allocations',
      'product_templates',
      'providers',
      'branches'
    ];

    const results: Record<string, any> = {};

    // 根据类型清除数据
    switch (clearType) {
      case 'energy':
        // 只清除能量值相关数据
        await query('DELETE FROM energy_transactions');
        await query('DELETE FROM energy_withdraw_requests');
        await query('DELETE FROM energy_accounts');
        await query(`UPDATE users SET energy_value = 0, updated_at = NOW()`);
        results.energy = { success: true, note: '能量值数据已清除' };
        break;
        
      case 'quota':
        // 只清除算力额度相关数据
        await query('DELETE FROM quota_requests');
        await query('DELETE FROM quota_allocations');
        await query('DELETE FROM quota_accounts');
        await query(`UPDATE users SET balance = 0, updated_at = NOW()`);
        // 重置管理员额度
        await query(`
          INSERT INTO quota_accounts (user_id, balance, total_in, total_out)
          SELECT id, 100000000, 100000000, 0 FROM users WHERE role = 'admin'
          ON CONFLICT (user_id) DO UPDATE SET balance = 100000000, total_in = 100000000, total_out = 0
        `);
        results.quota = { success: true, note: '算力额度已重置为1亿' };
        break;
        
      case 'all':
        // 清除全部数据
        for (const table of businessTables) {
          try {
            await execute(`DELETE FROM ${table}`);
            results[table] = { success: true };
          } catch (error: any) {
            results[table] = { success: false, error: error.message };
          }
        }
        await execute('DELETE FROM energy_accounts');
        await execute('DELETE FROM quota_accounts');
        await execute(`UPDATE users SET energy_value = 0, balance = 0, updated_at = NOW()`);
        // 初始化管理员额度
        await query(`
          INSERT INTO quota_accounts (user_id, balance, total_in, total_out)
          SELECT id, 100000000, 100000000, 0 FROM users WHERE role = 'admin'
          ON CONFLICT (user_id) DO UPDATE SET balance = 100000000, total_in = 100000000, total_out = 0
        `);
        break;
        
      case 'business':
      default:
        // 清除业务数据（不包括账户余额）
        for (const table of businessTables) {
          try {
            await execute(`DELETE FROM ${table}`);
            results[table] = { success: true };
          } catch (error: any) {
            results[table] = { success: false, error: error.message };
          }
        }
        break;
    }

    const successCount = Object.values(results).filter(r => r.success).length;
    const totalCount = Object.values(results).length;

    return NextResponse.json({
      success: true,
      message: `已清除 ${successCount}/${totalCount} 个数据表`,
      results
    });

  } catch (error: any) {
    console.error('清除数据失败:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// 获取清除前的数据统计
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
    }

    const tables = [
      'notifications', 'energy_transactions', 'transactions', 'withdrawals',
      'orders', 'user_products', 'products', 'quota_requests',
      'provider_applications', 'quota_allocations', 'product_templates',
      'providers', 'branches', 'quota_accounts', 'energy_accounts'
    ];

    const stats: Record<string, number> = {};
    for (const table of tables) {
      try {
        const result = await query(`SELECT COUNT(*) as count FROM ${table}`);
        stats[table] = parseInt(result[0]?.count || 0);
      } catch {
        stats[table] = -1;
      }
    }

    return NextResponse.json({ success: true, data: stats });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
