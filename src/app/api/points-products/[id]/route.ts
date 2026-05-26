import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/client';

// DELETE - 删除积分商品
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    
    const client = createClient();
    const sql = `DELETE FROM points_products WHERE id = '${id}' RETURNING *`;
    
    const { data, error } = await client.rpc('rpc_execute', { sql_query: sql });
    
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ success: true, message: '商品已删除' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
