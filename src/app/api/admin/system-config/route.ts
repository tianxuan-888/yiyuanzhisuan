import { NextRequest, NextResponse } from 'next/server';
import { query, execute } from '@/storage/database/pg-client';
import { requireAuth } from '@/lib/auth';

// 获取所有系统配置
export async function GET(request: NextRequest) {
  try {
    const configs = await query<{ key: string; value: string }>(
      'SELECT key, value FROM system_config ORDER BY key'
    );

    // 转换为 key-value 格式
    const config: Record<string, string> = {};
    configs.forEach(item => {
      config[item.key] = item.value;
    });

    return NextResponse.json({ success: true, data: config });
  } catch (error: any) {
    console.error('获取系统配置失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// 更新系统配置
export async function PUT(request: NextRequest) {
  try {
    // 验证管理员权限
    const user = requireAuth(request, ['admin']);

    const body = await request.json();
    const updates = body.config; // { key: value, key2: value2 }

    if (!updates || typeof updates !== 'object') {
      return NextResponse.json({ error: '无效的配置数据' }, { status: 400 });
    }

    // 批量更新或插入
    const results = [];
    for (const [key, value] of Object.entries(updates)) {
      try {
        await execute(
          `INSERT INTO system_config (key, value, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [key, String(value)]
        );
        results.push({ key, success: true });
      } catch (e: any) {
        results.push({ key, success: false, error: e.message });
      }
    }

    const allSuccess = results.every(r => r.success);

    return NextResponse.json({ 
      success: allSuccess, 
      message: allSuccess ? '配置保存成功' : '部分配置保存失败',
      data: results 
    });
  } catch (error: any) {
    console.error('更新系统配置失败:', error);
    const statusCode = (error as any).statusCode || 500;
    return NextResponse.json({ success: false, error: error.message }, { status: statusCode });
  }
}
