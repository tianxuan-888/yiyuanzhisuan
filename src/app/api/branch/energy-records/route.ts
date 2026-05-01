import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseServiceRoleKey } from '@/lib/env';

const supabaseUrl = getSupabaseUrl() || '';
const supabaseKey = getSupabaseServiceRoleKey() || '';
const client = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// 获取分公司能量值账户信息
async function getBranchEnergyAccount(branchId: string) {
  if (!client) {
    console.log('[energy-records] Supabase client not initialized');
    return null;
  }
  
  // 查询所有记录，然后手动匹配
  const { data, error } = await client
    .from('energy_accounts')
    .select('*');
  
  if (error) {
    console.error('查询能量值账户失败:', error);
    return null;
  }
  
  console.log('[energy-records] energy_accounts records count:', data?.length);
  console.log('[energy-records] looking for branchId:', branchId);
  
  // 手动匹配 UUID
  const account = (data || []).find((record: any) => {
    const recordUserId = record.user_id;
    if (Buffer.isBuffer(recordUserId)) {
      const hexId = recordUserId.toString('hex');
      const formattedId = hexId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
      console.log('[energy-records] comparing with:', formattedId);
      return formattedId === branchId;
    }
    return recordUserId === branchId;
  });
  
  if (account) {
    console.log('[energy-records] found account:', account.balance, account.total_in, account.total_out);
  }
  
  return account || null;
}

// 获取分公司相关的能量值流水记录
async function getBranchEnergyRecords(branchId: string, type: string = 'all') {
  if (!client) return [];
  
  // 查询所有记录
  const { data, error } = await client
    .from('energy_transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  
  if (error) {
    console.error('查询能量值记录失败:', error);
    return [];
  }
  
  // 字节数组转UUID字符串
  const bytesToUuid = (bytes: any): string => {
    if (!bytes) return '';
    if (typeof bytes === 'string') return bytes;
    if (Buffer.isBuffer(bytes)) {
      return bytes.toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
    }
    return '';
  };
  
  // 过滤分公司的记录
  return (data || [])
    .filter((record: any) => {
      const recordUserId = bytesToUuid(record.user_id);
      const recordFromUserId = bytesToUuid(record.from_user_id);
      const recordToUserId = bytesToUuid(record.to_user_id);
      
      // 匹配分公司ID
      return recordUserId === branchId || 
             recordFromUserId === branchId || 
             recordToUserId === branchId;
    })
    .filter((record: any) => {
      if (type === 'all') return true;
      if (type === 'recharge') return record.type === 'recharge';
      if (type === 'transfer_in') return record.type === 'transfer_in';
      if (type === 'transfer_out') return record.type === 'transfer_out';
      return true;
    })
    .map((record: any) => {
      // 确定记录类型
      let recordType = 'transfer';
      if (record.type === 'recharge') recordType = 'recharge';
      else if (record.type === 'transfer_in') recordType = 'transfer_in';
      else if (record.type === 'transfer_out') recordType = 'transfer_out';
      
      // 获取金额
      let amount = Math.abs(Number(record.amount) || 0);
      let isIncome = false;
      
      if (record.type === 'recharge') {
        isIncome = true;
      } else if (record.type === 'transfer_in') {
        isIncome = true;
      } else if (record.type === 'transfer_out') {
        isIncome = false;
      }
      
      // 获取备注
      let note = '';
      try {
        const desc = typeof record.description === 'string' 
          ? JSON.parse(record.description) 
          : record.description;
        note = desc?.note || desc?.source || '';
      } catch (e) {
        note = record.description || '';
      }
      
      return {
        id: record.id,
        type: record.type,
        recordType: recordType,
        amount: amount,
        isIncome: isIncome,
        counterparty: note || '系统',
        note: note,
        status: record.status || 'completed',
        created_at: record.created_at,
      };
    });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    const type = searchParams.get('type') || 'all';

    if (!branchId) {
      return NextResponse.json({ success: false, error: '缺少 branchId' }, { status: 400 });
    }

    // 获取分公司的能量值账户信息（包括累计收支）
    const account = await getBranchEnergyAccount(branchId);
    
    // 获取流水记录
    const records = await getBranchEnergyRecords(branchId, type);
    
    // 如果没有账户数据，返回默认统计
    if (!account) {
      return NextResponse.json({
        success: true,
        data: {
          records: records.length > 0 ? records : [],
          stats: {
            totalIn: 0,
            totalOut: 0,
            rechargeCount: 0,
            transferInCount: 0,
            transferOutCount: 0,
          },
        },
      });
    }
    
    // 使用账户表的累计数据
    const stats = {
      totalIn: Number(account.total_in || 0),
      totalOut: Number(account.total_out || 0),
      rechargeCount: records.filter(r => r.type === 'recharge').length,
      transferInCount: records.filter(r => r.type === 'transfer_in').length,
      transferOutCount: records.filter(r => r.type === 'transfer_out').length,
    };

    return NextResponse.json({
      success: true,
      data: {
        records,
        stats,
      },
    });
  } catch (error) {
    console.error('获取能量值记录失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    );
  }
}
