import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseServiceRoleKey } from '@/lib/env';

const supabaseUrl = getSupabaseUrl() || '';
const supabaseKey = getSupabaseServiceRoleKey() || '';
const client = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// 字节数组转UUID字符串
function bytesToUuid(bytes: any): string {
  if (!bytes) return '';
  if (typeof bytes === 'string') return bytes;
  if (Buffer.isBuffer(bytes)) {
    return bytes.toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  }
  return '';
}

// 获取分公司能量值账户信息
async function getBranchEnergyAccount(branchId: string) {
  if (!client) return null;

  const { data, error } = await client
    .from('energy_accounts')
    .select('*');

  if (error) {
    console.error('查询能量值账户失败:', error);
    return null;
  }

  const account = (data || []).find((record: any) => {
    return bytesToUuid(record.user_id) === branchId;
  });

  return account || null;
}

// 获取分公司相关的能量值流水记录
async function getBranchEnergyRecords(branchId: string, type: string = 'all') {
  if (!client) return [];

  // 只查询分公司的记录
  const { data, error } = await client
    .from('energy_transactions')
    .select('*')
    .eq('user_id', branchId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('查询能量值记录失败:', error);
    return [];
  }

  return (data || [])
    .filter((record: any) => {
      if (type === 'all') return true;
      if (type === 'transfer_in') {
        // 转入：充值、转入、额度匹配、收益转能量值
        return ['recharge', 'transfer_in', 'quota_match', 'convert_from_balance', 'purchase', 'create'].includes(record.type);
      }
      if (type === 'transfer_out') {
        // 转出：转出、提现冻结、提现、销毁
        return ['transfer_out', 'withdraw_freeze', 'withdraw', 'burn'].includes(record.type);
      }
      return true;
    })
    .map((record: any) => {
      // 确定记录类型和方向
      const isOutType = ['transfer_out', 'withdraw_freeze', 'withdraw', 'burn'].includes(record.type);
      const isIncome = !isOutType;
      const amount = Math.abs(Number(record.amount) || 0);

      // 生成描述文字
      let description = '';
      try {
        if (record.description) {
          const desc = typeof record.description === 'string'
            ? JSON.parse(record.description)
            : record.description;
          description = desc?.note || desc?.source || '';
        }
      } catch {
        description = record.description || '';
      }

      // 如果没有description，根据type生成默认描述
      if (!description) {
        const toUser = bytesToUuid(record.to_user_id);
        const fromUser = bytesToUuid(record.from_user_id);
        switch (record.type) {
          case 'quota_match':
            description = '总公司下发算力额度，同步配套能量值';
            break;
          case 'transfer_in':
            description = '总公司分配额度，获得赠送能量值';
            break;
          case 'transfer_out':
            description = toUser ? '审核通过服务商能量值申请，发放能量值' : '能量值转出';
            break;
          case 'withdraw_freeze':
            description = '提现冻结能量值';
            break;
          case 'withdraw':
            description = '提现发放能量值';
            break;
          case 'burn':
            description = '能量值销毁';
            break;
          case 'purchase':
            description = '购买能量值';
            break;
          case 'create':
            description = '系统创建能量值';
            break;
          case 'convert_from_balance':
            description = '余额转能量值';
            break;
          default:
            description = '能量值变动';
        }
      }

      // 确定前端展示的recordType
      let recordType = 'transfer';
      if (isIncome) {
        recordType = 'transfer_in';
      } else {
        recordType = 'transfer_out';
      }

      return {
        id: record.id,
        type: record.type,
        recordType,
        amount,
        isIncome,
        description,
        note: description,
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

    const account = await getBranchEnergyAccount(branchId);
    const records = await getBranchEnergyRecords(branchId, type);

    // 统计
    const incomeRecords = records.filter(r => r.isIncome);
    const outcomeRecords = records.filter(r => !r.isIncome);

    const stats = {
      totalIn: Number(account?.total_in || 0),
      totalOut: Number(account?.total_out || 0),
      transferInCount: incomeRecords.length,
      transferOutCount: outcomeRecords.length,
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
