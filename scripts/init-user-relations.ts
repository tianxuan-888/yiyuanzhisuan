import { query } from '@/storage/database/pg-client';

// 初始化用户关系数据
async function initUserRelations() {
  console.log('开始初始化用户关系...');

  // 1. 更新服务商member1，关联到分公司branch1
  const updateProvider = await query(`
    UPDATE users 
    SET branch_id = '00000000-0000-0000-0000-000000000011',
        inviter_id = NULL,
        provider_id = NULL
    WHERE phone = '13800000021'
    RETURNING id, username, role, branch_id
  `);
  console.log('服务商更新:', updateProvider);

  // 2. 更新服务商配置，确保有providers记录
  const updateProviders = await query(`
    INSERT INTO providers (id, user_id, quota, used_quota, branch_id, total_sales, created_at)
    VALUES ('prov-member1', 'member1-id', 50000, 0, '00000000-0000-0000-0000-000000000011', 0, NOW())
    ON CONFLICT (id) DO UPDATE SET
      quota = 50000,
      branch_id = '00000000-0000-0000-0000-000000000011'
    RETURNING *
  `);
  console.log('服务商配置:', updateProviders);

  // 3. 获取服务商ID
  const providerResult = await query(`
    SELECT id, user_id FROM providers WHERE user_id = 'member1-id' OR phone = '13800000021'
  `);
  
  let providerId = providerResult.length > 0 ? providerResult[0].user_id : null;
  console.log('服务商ID:', providerId);

  // 如果没找到服务商，创建一个
  if (!providerId) {
    const newProvider = await query(`
      INSERT INTO users (id, username, password, phone, role, energy_value, balance, branch_id, is_active, created_at)
      VALUES ('member1-id', 'member1', 'hashed_password', '13800000021', 'provider', 1000, 0, '00000000-0000-0000-0000-000000000011', true, NOW())
      ON CONFLICT (id) DO UPDATE SET branch_id = '00000000-0000-0000-0000-000000000011'
      RETURNING id
    `);
    providerId = newProvider[0]?.id;
    
    await query(`
      INSERT INTO providers (id, user_id, quota, used_quota, branch_id, total_sales, created_at)
      VALUES ('prov-member1', $1, 50000, 0, '00000000-0000-0000-0000-000000000011', 0, NOW())
      ON CONFLICT (id) DO UPDATE SET quota = 50000
    `, [providerId]);
  }

  // 4. 更新或创建会员member1，关联到服务商
  const updateMember = await query(`
    INSERT INTO users (id, username, password, phone, role, provider_id, inviter_id, branch_id, energy_value, balance, is_active, created_at)
    VALUES ('member1-member', 'member1', 'hashed_password', '13866666666', 'member', $1, $1, '00000000-0000-0000-0000-000000000011', 500, 0, true, NOW())
    ON CONFLICT (id) DO UPDATE SET
      provider_id = $1,
      inviter_id = $1,
      branch_id = '00000000-0000-0000-0000-000000000011'
    RETURNING id, username, role, provider_id, inviter_id
  `, [providerId]);
  console.log('会员更新:', updateMember);

  console.log('初始化完成!');
  console.log('会员关联: provider_id =', providerId);
}

// 执行
initUserRelations().catch(console.error);
