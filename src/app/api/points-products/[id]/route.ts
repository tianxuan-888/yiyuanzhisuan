import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg-client';

// DELETE - 删除积分商品
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    await query('DELETE FROM points_products WHERE id = $1', [id]);

    return NextResponse.json({ success: true, message: '商品已删除' });
  } catch (error: any) {
    console.error('删除积分商品失败:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
