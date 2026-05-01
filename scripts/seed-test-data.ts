import { query } from '@/storage/database/pg-client';
import bcrypt from 'bcryptjs';

// 测试数据密码
const TEST_PASSWORD = 'test123456';

async function seedTestData() {
  console.log('开始初始化测试数据...');

  // 1. 创建管理员（总公司）
  const adminHash = bcrypt.hashSync(TEST_PASSWORD, 10);
  await query(`
    INSERT INTO users (id, username, password, phone, role, unique_id, is_active, energy_value, balance, created_at, updated_at)
    VALUES ('00000000-0000-0000-0000-000000000001', 'admin', $1, '13800000001', 'admin', 'HM000001', true, 0, 0, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET password = EXCLUDED.password
  `, [adminHash]);
  console.log('✓ 管理员账号创建完成');

  // 2. 创建分公司
  await query(`
    INSERT INTO users (id, username, password, phone, role, unique_id, is_active, energy_value, balance, created_at, updated_at)
    VALUES ('00000000-0000-0000-0000-000000000011', 'branch1', $1, '13800000011', 'branch', 'HM000011', true, 10000, 0, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET password = EXCLUDED.password
  `, [adminHash]);
  console.log('✓ 分公司账号创建完成');

  // 3. 创建服务商
  await query(`
    INSERT INTO users (id, username, password, phone, role, unique_id, branch_id, is_active, energy_value, balance, created_at, updated_at)
    VALUES ('c1b6dc0f-8a59-4b05-adae-cf48e39993d0', '服务商A', $1, '13800000021', 'provider', 'HM000021', '00000000-0000-0000-0000-000000000011', true, 10000, 0, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET password = EXCLUDED.password
  `, [adminHash]);

  // 创建服务商配置
  await query(`
    INSERT INTO providers (id, user_id, quota, used_quota, total_sales, split_count, is_active, branch_id, created_at, updated_at)
    VALUES ('ab6b1ec6-c373-46bb-8ec0-0b39828fb9d1', 'c1b6dc0f-8a59-4b05-adae-cf48e39993d0', 50000, 0, 0, 0, true, '00000000-0000-0000-0000-000000000011', NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET quota = 50000
  `);
  console.log('✓ 服务商账号创建完成');

  // 4. 创建会员
  await query(`
    INSERT INTO users (id, username, password, phone, role, unique_id, provider_id, branch_id, is_active, energy_value, balance, created_at, updated_at)
    VALUES ('member-001', 'testmember1', $1, '13866666666', 'member', 'HM666666', 'c1b6dc0f-8a59-4b05-adae-cf48e39993d0', '00000000-0000-0000-0000-000000000011', true, 5000, 0, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET password = EXCLUDED.password
  `, [adminHash]);

  // 创建更多会员
  await query(`
    INSERT INTO users (id, username, password, phone, role, unique_id, provider_id, branch_id, is_active, energy_value, balance, created_at, updated_at)
    VALUES 
      ('member-002', 'testmember2', $1, '13866666667', 'member', 'HM666667', 'c1b6dc0f-8a59-4b05-adae-cf48e39993d0', '00000000-0000-0000-0000-000000000011', true, 3000, 0, NOW(), NOW()),
      ('member-003', 'testmember3', $1, '13866666668', 'member', 'HM666668', 'c1b6dc0f-8a59-4b05-adae-cf48e39993d0', '00000000-0000-0000-0000-000000000011', true, 2000, 0, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET password = EXCLUDED.password
  `, [adminHash]);
  console.log('✓ 会员账号创建完成');

  // 5. 创建能量值账户
  await query(`
    INSERT INTO energy_accounts (user_id, balance, total_in, total_out, created_at, updated_at)
    VALUES 
      ('00000000-0000-0000-0000-000000000001', 0, 0, 0, NOW(), NOW()),
      ('00000000-0000-0000-0000-000000000011', 10000, 10000, 0, NOW(), NOW()),
      ('c1b6dc0f-8a59-4b05-adae-cf48e39993d0', 10000, 10000, 0, NOW(), NOW()),
      ('member-001', 5000, 5000, 0, NOW(), NOW()),
      ('member-002', 3000, 3000, 0, NOW(), NOW()),
      ('member-003', 2000, 2000, 0, NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE SET 
      balance = EXCLUDED.balance,
      total_in = EXCLUDED.total_in
  `);
  console.log('✓ 能量值账户创建完成');

  // 6. 创建产品模板（如果没有）
  await query(`
    INSERT INTO product_templates (id, name, code, period, total_rate, market_rate, profit_rate, min_quota, status)
    VALUES
      ('tpl-3d', 'GPU算力3天', 'GPU-3D', 3, 5, 3, 2, 1000, 'active'),
      ('tpl-7d', 'GPU算力7天', 'GPU-7D', 7, 10, 5, 5, 1000, 'active'),
      ('tpl-15d', 'GPU算力15天', 'GPU-15D', 15, 20, 10, 10, 5000, 'active'),
      ('tpl-30d', 'GPU算力30天', 'GPU-30D', 30, 44, 22, 22, 10000, 'active'),
      ('tpl-90d', 'GPU算力90天', 'GPU-90D', 90, 120, 60, 60, 30000, 'active')
    ON CONFLICT (id) DO NOTHING
  `);
  console.log('✓ 产品模板创建完成');

  // 7. 创建产品（如果没有）
  await query(`
    INSERT INTO products (id, name, code, price, period, total_rate, market_rate, profit_rate, market_fee, provider_id, status)
    VALUES
      (gen_random_uuid(), 'GPU算力3天A套餐', 'GPU-3D-A', 1000, 3, 5, 3, 2, 30, 'c1b6dc0f-8a59-4b05-adae-cf48e39993d0', 'available'),
      (gen_random_uuid(), 'GPU算力3天B套餐', 'GPU-3D-B', 2000, 3, 5, 3, 2, 60, 'c1b6dc0f-8a59-4b05-adae-cf48e39993d0', 'available'),
      (gen_random_uuid(), 'GPU算力3天C套餐', 'GPU-3D-C', 3000, 3, 5, 3, 2, 90, 'c1b6dc0f-8a59-4b05-adae-cf48e39993d0', 'available'),
      (gen_random_uuid(), 'GPU算力3天D套餐', 'GPU-3D-D', 5000, 3, 5, 3, 2, 150, 'c1b6dc0f-8a59-4b05-adae-cf48e39993d0', 'available'),
      (gen_random_uuid(), 'GPU算力7天A套餐', 'GPU-7D-A', 1000, 7, 10, 5, 5, 50, 'c1b6dc0f-8a59-4b05-adae-cf48e39993d0', 'available'),
      (gen_random_uuid(), 'GPU算力7天B套餐', 'GPU-7D-B', 3000, 7, 10, 5, 5, 150, 'c1b6dc0f-8a59-4b05-adae-cf48e39993d0', 'available'),
      (gen_random_uuid(), 'GPU算力7天C套餐', 'GPU-7D-C', 5000, 7, 10, 5, 5, 250, 'c1b6dc0f-8a59-4b05-adae-cf48e39993d0', 'available'),
      (gen_random_uuid(), 'GPU算力7天D套餐', 'GPU-7D-D', 10000, 7, 10, 5, 5, 500, 'c1b6dc0f-8a59-4b05-adae-cf48e39993d0', 'available')
    ON CONFLICT DO NOTHING
  `);
  console.log('✓ 产品创建完成');

  // 8. 创建总公司额度记录
  await query(`
    INSERT INTO company_quota (id, total_quota, used_quota, available_quota)
    VALUES (1, 100000000, 50000, 99950000)
    ON CONFLICT (id) DO UPDATE SET total_quota = 100000000
  `);
  console.log('✓ 总公司额度创建完成');

  console.log('\n✅ 测试数据初始化完成！');
  console.log('\n测试账号：');
  console.log('  总公司管理员: 13800000001 / test123456');
  console.log('  分公司: 13800000011 / test123456');
  console.log('  服务商: 13800000021 / test123456');
  console.log('  会员1: 13866666666 / test123456');
  console.log('  会员2: 13866666667 / test123456');
  console.log('  会员3: 13866666668 / test123456');
}

// 执行
seedTestData().catch(console.error);
