-- ============================================
-- 纪元智科 GPU算力基建投资平台 - 完整数据库建表脚本
-- 执行位置：Supabase Dashboard → SQL Editor
-- ============================================

-- 1. 用户表
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  phone TEXT,
  real_name TEXT,
  alipay_account TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'branch', 'provider', 'member')),
  provider_id UUID,
  branch_id UUID,
  inviter_id UUID,
  inviter_code TEXT,
  energy_value INTEGER DEFAULT 0,
  balance INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. 分公司表
CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  region TEXT,
  manager_name TEXT,
  manager_phone TEXT,
  total_quota INTEGER DEFAULT 0,
  used_quota INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. 服务商表
CREATE TABLE IF NOT EXISTS providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  parent_provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  quota INTEGER DEFAULT 0,
  used_quota INTEGER DEFAULT 0,
  total_sales INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. 产品模板表
CREATE TABLE IF NOT EXISTS product_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  period INTEGER NOT NULL,
  total_rate INTEGER NOT NULL,
  market_rate INTEGER NOT NULL,
  profit_rate INTEGER NOT NULL,
  min_quota INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. 额度分配表
CREATE TABLE IF NOT EXISTS quota_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES providers(id) ON DELETE CASCADE,
  template_id UUID REFERENCES product_templates(id) ON DELETE SET NULL,
  quota_amount INTEGER NOT NULL DEFAULT 0,
  used_amount INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. 产品表
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  price INTEGER NOT NULL,
  period INTEGER NOT NULL,
  total_rate INTEGER NOT NULL,
  market_rate INTEGER NOT NULL,
  profit_rate INTEGER NOT NULL,
  provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
  template_id UUID REFERENCES product_templates(id) ON DELETE SET NULL,
  image_url TEXT,
  status TEXT DEFAULT 'unlisted' CHECK (status IN ('unlisted', 'available', 'sold', 'pending_sell')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. 用户产品表（持仓）
CREATE TABLE IF NOT EXISTS user_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  purchase_price INTEGER NOT NULL,
  purchase_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expire_date TIMESTAMP WITH TIME ZONE NOT NULL,
  expected_profit INTEGER DEFAULT 0,
  market_fee INTEGER DEFAULT 0,
  status TEXT DEFAULT 'holding' CHECK (status IN ('holding', 'sold', 'expired')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. 订单表
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  user_product_id UUID REFERENCES user_products(id) ON DELETE SET NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('buy', 'sell', 'recharge', 'withdraw', 'transfer')),
  amount INTEGER NOT NULL DEFAULT 0,
  energy_value INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'completed', 'cancelled', 'rejected')),
  note TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. 交易记录表
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('buy', 'sell', 'recharge', 'withdraw', 'transfer_in', 'transfer_out', 'profit', 'energy_recharge', 'energy_spend')),
  amount INTEGER NOT NULL DEFAULT 0,
  balance_before INTEGER DEFAULT 0,
  balance_after INTEGER DEFAULT 0,
  energy_before INTEGER DEFAULT 0,
  energy_after INTEGER DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. 能量值记录表
CREATE TABLE IF NOT EXISTS energy_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('recharge', 'spend', 'transfer_in', 'transfer_out', 'profit_share', 'provider_income')),
  amount INTEGER NOT NULL,
  energy_before INTEGER DEFAULT 0,
  energy_after INTEGER DEFAULT 0,
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'cancelled')),
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. 提现记录表
CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  fee INTEGER DEFAULT 0,
  actual_amount INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
  bank_name TEXT,
  bank_account TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 12. 服务商申请表
CREATE TABLE IF NOT EXISTS provider_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  applicant_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  apply_type TEXT NOT NULL CHECK (apply_type IN ('first_gen', 'second_gen')),
  parent_provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  quota_request INTEGER DEFAULT 0,
  quota_approved INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 13. 额度申请表
CREATE TABLE IF NOT EXISTS quota_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID REFERENCES users(id) ON DELETE CASCADE,
  requester_type TEXT NOT NULL CHECK (requester_type IN ('branch', 'provider')),
  parent_id UUID,
  requested_amount INTEGER NOT NULL,
  approved_amount INTEGER DEFAULT 0,
  multiplier NUMERIC DEFAULT 1.0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 14. 通知表
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('system', 'order', 'product', 'account', 'promotion')),
  title TEXT NOT NULL,
  content TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 15. 系统配置表
CREATE TABLE IF NOT EXISTS system_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value TEXT,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 注意：会员等级已简化，所有用户统一为普通会员，无需 member_levels 表

-- ============================================
-- 创建索引
-- ============================================
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_provider_id ON users(provider_id);
CREATE INDEX IF NOT EXISTS idx_users_branch_id ON users(branch_id);
CREATE INDEX IF NOT EXISTS idx_users_inviter_id ON users(inviter_id);

CREATE INDEX IF NOT EXISTS idx_products_provider_id ON products(provider_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_order_type ON orders(order_type);

CREATE INDEX IF NOT EXISTS idx_user_products_user_id ON user_products(user_id);
CREATE INDEX IF NOT EXISTS idx_user_products_status ON user_products(status);
CREATE INDEX IF NOT EXISTS idx_user_products_expire_date ON user_products(expire_date);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);

CREATE INDEX IF NOT EXISTS idx_energy_transactions_user_id ON energy_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_energy_transactions_type ON energy_transactions(type);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

CREATE INDEX IF NOT EXISTS idx_provider_applications_user_id ON provider_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_provider_applications_status ON provider_applications(status);

CREATE INDEX IF NOT EXISTS idx_quota_requests_requester_id ON quota_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_quota_requests_status ON quota_requests(status);

-- ============================================
-- 创建更新时间的触发器函数
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- 为所有表添加更新时间触发器
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_branches_updated_at ON branches;
CREATE TRIGGER update_branches_updated_at BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_providers_updated_at ON providers;
CREATE TRIGGER update_providers_updated_at BEFORE UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_products_updated_at ON user_products;
CREATE TRIGGER update_user_products_updated_at BEFORE UPDATE ON user_products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_withdrawals_updated_at ON withdrawals;
CREATE TRIGGER update_withdrawals_updated_at BEFORE UPDATE ON withdrawals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_provider_applications_updated_at ON provider_applications;
CREATE TRIGGER update_provider_applications_updated_at BEFORE UPDATE ON provider_applications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_quota_requests_updated_at ON quota_requests;
CREATE TRIGGER update_quota_requests_updated_at BEFORE UPDATE ON quota_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_system_config_updated_at ON system_config;
CREATE TRIGGER update_system_config_updated_at BEFORE UPDATE ON system_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 插入初始测试数据
-- ============================================

-- 插入总公司管理员
INSERT INTO users (id, username, password, phone, role) VALUES 
('00000000-0000-0000-0000-000000000001', 'admin', '$2b$10$ly3FJ6rkBIRiyzx2UcelceSWX7jyLwy3wkBXOIP//A3OGEqIshfdG', '13800000001', 'admin')
ON CONFLICT (username) DO NOTHING;

-- 插入分公司（如果有）
INSERT INTO branches (id, name, code, region, manager_name, manager_phone) VALUES
('00000000-0000-0000-0000-000000000010', '纪元智科华东分公司', 'BRANCH-EAST', '华东地区', '张经理', '13800000010')
ON CONFLICT (code) DO NOTHING;

-- 插入分公司管理员
INSERT INTO users (id, username, password, phone, role, branch_id) VALUES
('00000000-0000-0000-0000-000000000011', 'branch1', '$2b$10$/hbAfrmetTOIajP1O3aPcuVS3R2OUrioy56iPy52T/50gcaCL.q0G', '13800000011', 'branch', '00000000-0000-0000-0000-000000000010')
ON CONFLICT (username) DO NOTHING;

-- 插入产品模板
INSERT INTO product_templates (id, name, code, period, total_rate, market_rate, profit_rate, min_quota, status) VALUES
('00000000-0000-0000-0000-000000000100', '3天算力套餐', 'TPL-3D', 3, 5, 3, 2, 10000, 'active'),
('00000000-0000-0000-0000-000000000101', '7天算力套餐', 'TPL-7D', 7, 10, 5, 5, 10000, 'active'),
('00000000-0000-0000-0000-000000000102', '15天算力套餐', 'TPL-15D', 15, 20, 10, 10, 50000, 'active'),
('00000000-0000-0000-0000-000000000103', '30天算力套餐', 'TPL-30D', 30, 44, 22, 22, 100000, 'active'),
('00000000-0000-0000-0000-000000000104', '90天算力套餐', 'TPL-90D', 90, 120, 60, 60, 300000, 'active')
ON CONFLICT (code) DO NOTHING;

-- 更新现有用户密码（如果密码仍是明文）
UPDATE users SET password = '$2b$10$ly3FJ6rkBIRiyzx2UcelceSWX7jyLwy3wkBXOIP//A3OGEqIshfdG' WHERE phone = '13800000001';
UPDATE users SET password = '$2b$10$/hbAfrmetTOIajP1O3aPcuVS3R2OUrioy56iPy52T/50gcaCL.q0G' WHERE phone = '13800000011';
UPDATE users SET password = '$2b$10$sJ5TVyv4qgpLXkFByXig3OlGey7GmtFuZBMhVGu0NDvjQX9LcvCf6' WHERE phone IN ('13800000021', '13800000022', '13866666666');

-- 插入服务商（使用member1作为服务商）
UPDATE users SET role = 'provider' WHERE username = 'member1';

INSERT INTO providers (id, user_id, branch_id, name, code, quota, used_quota, status) VALUES
(
  (SELECT id FROM users WHERE username = 'member1'),
  (SELECT id FROM users WHERE username = 'member1'),
  '00000000-0000-0000-0000-000000000010',
  '纪元智科服务商A',
  'PROV-001',
  50000,
  50000,
  'active'
)
ON CONFLICT (code) DO NOTHING;

-- 更新member1的服务商ID
UPDATE users SET provider_id = (SELECT id FROM providers WHERE code = 'PROV-001') WHERE username = 'member1';

-- 插入系统配置
INSERT INTO system_config (key, value, description) VALUES
('energy_allocation_provider', '70', '服务商能量值分配比例(%)'),
('energy_allocation_company', '5', '公司能量值分配比例(%)'),
('energy_allocation_direct', '10', '直推奖励分配比例(%)'),
('energy_allocation_parent_provider', '10', '上级服务商分配比例(%)'),
('energy_allocation_branch', '5', '分公司分配比例(%)'),
('min_withdrawal_amount', '50', '最低提现金额'),
('min_transfer_amount', '50', '最低能量值互转金额'),
('provider_bond', '16800', '服务商保证金')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- 验证查询
-- ============================================
-- SELECT 'Users:' as table_name, COUNT(*) as count FROM users
-- UNION ALL SELECT 'Branches:', COUNT(*) FROM branches
-- UNION ALL SELECT 'Providers:', COUNT(*) FROM providers
-- UNION ALL SELECT 'Products:', COUNT(*) FROM products
-- UNION ALL SELECT 'Product Templates:', COUNT(*) FROM product_templates
-- UNION ALL SELECT 'Orders:', COUNT(*) FROM orders
-- UNION ALL SELECT 'Transactions:', COUNT(*) FROM transactions
-- UNION ALL SELECT 'Notifications:', COUNT(*) FROM notifications;
