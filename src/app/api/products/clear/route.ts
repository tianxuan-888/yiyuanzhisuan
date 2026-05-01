import { NextRequest, NextResponse } from 'next/server';

// DELETE - 清空服务商的所有产品
export async function DELETE(request: NextRequest) {
  try {
    // 在函数内部创建Supabase客户端，避免构建时需要环境变量
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({
        success: false,
        error: '数据库配置未完成'
      }, { status: 500 });
    }

    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');

    if (!providerId) {
      return NextResponse.json({
        success: false,
        error: '缺少服务商ID'
      }, { status: 400 });
    }

    // 获取该服务商的所有产品ID
    const { data: products, error: fetchError } = await supabase
      .from('products')
      .select('id')
      .eq('provider_id', providerId);

    if (fetchError) {
      console.error('获取产品列表失败:', fetchError);
      return NextResponse.json({
        success: false,
        error: '获取产品列表失败'
      }, { status: 500 });
    }

    if (!products || products.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          count: 0,
          message: '没有需要清空的产品'
        }
      });
    }

    const productIds = products.map(p => p.id);

    // 删除所有产品
    const { error: deleteError } = await supabase
      .from('products')
      .delete()
      .in('id', productIds);

    if (deleteError) {
      console.error('删除产品失败:', deleteError);
      return NextResponse.json({
        success: false,
        error: '删除产品失败'
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        count: productIds.length,
        message: `成功清空 ${productIds.length} 个产品`
      }
    });
  } catch (error) {
    console.error('清空产品失败:', error);
    return NextResponse.json({
      success: false,
      error: '清空产品失败'
    }, { status: 500 });
  }
}
