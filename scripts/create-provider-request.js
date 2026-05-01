// 创建正确的服务商能量值申请记录
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.COZE_SUPABASE_URL;
const supabaseKey = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function createProviderEnergyRequest() {
  const providerId = '22222222-2222-2222-2222-222222222222';
  const branchId = '00000000-0000-0000-0000-000000000011';
  
  // 创建两条申请记录，每条2000能量值
  for (let i = 0; i < 2; i++) {
    const requestId = crypto.randomUUID();
    const description = JSON.stringify({
      request_type: 'energy_request',
      requestedAmount: 2000,
      note: '服务商申请能量值',
      providerName: 'provider1',
      providerPhone: '13800000021',
      branchId: branchId,
      branchName: 'branch1',
      status: 'pending',
    });

    const { data, error } = await supabase
      .from('energy_transactions')
      .insert({
        id: requestId,
        user_id: providerId,
        type: 'recharge',
        amount: 2000,
        status: 'completed',
        description: description,
      })
      .select()
      .single();

    if (error) {
      console.error(`创建申请记录 ${i + 1} 失败:`, error);
    } else {
      console.log(`创建申请记录 ${i + 1} 成功:`, data.id);
    }
  }

  // 验证结果
  const { data: records, error: queryError } = await supabase
    .from('energy_transactions')
    .select('id, user_id, type, amount, description')
    .eq('type', 'recharge')
    .eq('user_id', providerId);

  if (queryError) {
    console.error('查询失败:', queryError);
  } else {
    console.log('\n当前服务商申请记录:');
    records.forEach(r => {
      const desc = JSON.parse(r.description || '{}');
      console.log(`  ID: ${r.id}`);
      console.log(`  UserID: ${r.user_id}`);
      console.log(`  Amount: ${r.amount}`);
      console.log(`  Status: ${desc.status}`);
      console.log('---');
    });
  }
}

createProviderEnergyRequest().catch(console.error);
