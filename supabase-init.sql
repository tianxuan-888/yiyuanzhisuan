-- ============================================
-- 纪元智科 - 数据库建表脚本
-- 目标: Supabase PostgreSQL (swowspzwukyayyyhzmrj)
-- ============================================

-- 1. 自定义枚举类型
CREATE TYPE user_role AS ENUM ('admin', 'branch', 'provider', 'member');
CREATE TYPE order_status AS ENUM ('pending', 'paid', 'completed', 'cancelled');
CREATE TYPE product_status AS ENUM ('available', 'sold', 'pending_sell', 'unlisted');
CREATE TYPE user_product_status AS ENUM ('holding', 'sold', 'pending_sell');
CREATE TYPE transaction_type AS ENUM ('recharge', 'withdraw', 'buy_product', 'sell_product', 'transfer_in', 'transfer_out', 'market_fee', 'profit', 'deposit', 'energy_request');

-- 2. 用户表
CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) NOT NULL,
  password VARCHAR(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'member',
  phone VARCHAR(20),
  real_name VARCHAR(50),
  alipay_account VARCHAR(100),
  provider_id VARCHAR(36),
  inviter_id VARCHAR(36),
  energy_value NUMERIC NOT NULL DEFAULT 0,
  balance NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  points NUMERIC DEFAULT 0,
  branch_id VARCHAR,
  wechat_account TEXT,
  invite_code TEXT,
  unique_id TEXT,
  birth_date DATE,
  avatar_url TEXT,
  gender VARCHAR(20),
  address TEXT,
  payment_qr_code TEXT
);

-- 3. 分公司表
CREATE TABLE branches (
  id VARCHAR PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  quota NUMERIC NOT NULL DEFAULT 0,
  used_quota NUMERIC NOT NULL DEFAULT 0,
  total_sales NUMERIC NOT NULL DEFAULT 0,
  split_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

-- 4. 总公司额度表
CREATE TABLE company_quota (
  id VARCHAR(50) PRIMARY KEY DEFAULT '1',
  total_quota BIGINT NOT NULL DEFAULT 0,
  used_quota BIGINT NOT NULL DEFAULT 0,
  available_quota BIGINT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. 能量值账户表
CREATE TABLE energy_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  balance DOUBLE PRECISION DEFAULT 0,
  total_in DOUBLE PRECISION DEFAULT 0,
  total_out DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. 能量值流水表
CREATE TABLE energy_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type VARCHAR(20) NOT NULL,
  amount NUMERIC NOT NULL,
  related_user_id UUID,
  related_order_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  from_user_id UUID,
  to_user_id UUID,
  energy_before NUMERIC DEFAULT 0,
  energy_after NUMERIC DEFAULT 0,
  status VARCHAR(20) DEFAULT 'completed',
  description TEXT
);

-- 7. 能量值变现申请表
CREATE TABLE energy_withdraw_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  amount NUMERIC NOT NULL,
  actual_amount NUMERIC NOT NULL,
  fee_amount NUMERIC NOT NULL,
  approver_id UUID,
  approver_role VARCHAR(20),
  status VARCHAR(20) DEFAULT 'pending',
  note TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 8. 通知表
CREATE TABLE notifications (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  receiver_id VARCHAR NOT NULL,
  receiver_role VARCHAR NOT NULL,
  sender_id VARCHAR,
  sender_name VARCHAR,
  type VARCHAR NOT NULL,
  title VARCHAR NOT NULL,
  content VARCHAR,
  amount NUMERIC,
  status VARCHAR DEFAULT 'unread',
  related_id VARCHAR,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 9. 订单表
CREATE TABLE orders (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(36) NOT NULL,
  user_product_id VARCHAR(36),
  order_type VARCHAR(20) NOT NULL,
  amount NUMERIC NOT NULL,
  status order_status NOT NULL DEFAULT 'pending',
  reviewed_by VARCHAR(36),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  product_id VARCHAR,
  payment_confirmed BOOLEAN DEFAULT false,
  payment_confirmed_at TIMESTAMPTZ,
  payment_confirmed_by VARCHAR,
  reject_reason TEXT,
  energy_cost NUMERIC DEFAULT 0
);

-- 10. 产品模板表
CREATE TABLE product_templates (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  name VARCHAR NOT NULL,
  code VARCHAR NOT NULL,
  period INTEGER NOT NULL,
  total_rate NUMERIC NOT NULL,
  market_rate NUMERIC NOT NULL,
  profit_rate NUMERIC NOT NULL,
  min_quota NUMERIC DEFAULT 10000,
  status VARCHAR DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ
);

-- 11. 产品表
CREATE TABLE products (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50) NOT NULL,
  image_url VARCHAR(500),
  price INTEGER NOT NULL,
  period INTEGER NOT NULL,
  total_rate NUMERIC NOT NULL,
  market_rate NUMERIC NOT NULL,
  profit_rate NUMERIC NOT NULL,
  provider_id VARCHAR(36),
  status product_status NOT NULL DEFAULT 'available',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  template_id VARCHAR,
  is_listed BOOLEAN DEFAULT false,
  transfer_start_time TIMESTAMPTZ,
  transfer_expires_at TIMESTAMPTZ
);

-- 12. 服务商申请表
CREATE TABLE provider_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  applicant_name VARCHAR(100),
  phone VARCHAR(20),
  apply_type VARCHAR(20) NOT NULL,
  parent_provider_id UUID,
  branch_id UUID NOT NULL,
  quota_request NUMERIC DEFAULT 0,
  quota_approved NUMERIC DEFAULT 0,
  deposit_amount NUMERIC DEFAULT 0,
  deposit_paid BOOLEAN DEFAULT false,
  status VARCHAR(20) DEFAULT 'pending',
  reject_reason TEXT,
  note TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 13. 服务商配置表
CREATE TABLE providers (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(36) NOT NULL,
  quota INTEGER NOT NULL DEFAULT 0,
  used_quota INTEGER NOT NULL DEFAULT 0,
  total_sales INTEGER NOT NULL DEFAULT 0,
  split_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  branch_id VARCHAR
);

-- 14. 额度分配表
CREATE TABLE quota_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id VARCHAR NOT NULL,
  provider_id VARCHAR,
  template_id VARCHAR,
  quota_amount NUMERIC NOT NULL DEFAULT 0,
  used_amount NUMERIC NOT NULL DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 15. 额度申请表
CREATE TABLE quota_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id VARCHAR NOT NULL,
  requester_type VARCHAR(20) NOT NULL,
  parent_id VARCHAR NOT NULL,
  requested_amount NUMERIC NOT NULL,
  approved_amount NUMERIC,
  multiplier NUMERIC DEFAULT 1.0,
  status VARCHAR(20) DEFAULT 'pending',
  note TEXT,
  reviewed_by VARCHAR,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 16. 充值申请表
CREATE TABLE recharge_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL,
  member_id VARCHAR NOT NULL,
  amount NUMERIC NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 17. 系统配置表
CREATE TABLE system_config (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  key VARCHAR NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 18. 交易记录表
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL,
  order_id VARCHAR,
  type transaction_type NOT NULL,
  amount NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 19. 用户产品表
CREATE TABLE user_products (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(36) NOT NULL,
  product_id VARCHAR(36) NOT NULL,
  purchase_price NUMERIC NOT NULL,
  purchase_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  expire_date TIMESTAMPTZ,
  expected_profit NUMERIC DEFAULT 0,
  market_fee NUMERIC DEFAULT 0,
  status user_product_status NOT NULL DEFAULT 'holding',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ,
  energy_cost NUMERIC DEFAULT 0
);

-- 20. 提现记录表
CREATE TABLE withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL,
  amount NUMERIC NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 21. 额度账户表
CREATE TABLE quota_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  balance NUMERIC DEFAULT 0,
  total_in NUMERIC DEFAULT 0,
  total_out NUMERIC DEFAULT 0,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- 22. 额度申请记录表
CREATE TABLE quota_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id VARCHAR(255) NOT NULL,
  amount NUMERIC NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  note TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- 23. 额度流转记录表
CREATE TABLE quota_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id VARCHAR(255),
  to_user_id VARCHAR(255) NOT NULL,
  amount NUMERIC NOT NULL,
  type VARCHAR(50) DEFAULT 'transfer',
  note TEXT,
  created_at TIMESTAMP DEFAULT now()
);

-- 24. 收益明细表
CREATE TABLE revenue_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  revenue_id UUID,
  type VARCHAR(50) NOT NULL,
  amount NUMERIC NOT NULL,
  balance_before NUMERIC DEFAULT 0,
  balance_after NUMERIC DEFAULT 0,
  description TEXT,
  related_id UUID,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 25. 会员收益表
CREATE TABLE member_revenue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  order_id VARCHAR(255),
  user_product_id VARCHAR(255),
  principal NUMERIC NOT NULL,
  profit NUMERIC NOT NULL,
  total_amount NUMERIC NOT NULL,
  converted_to_energy NUMERIC DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- 26. 服务商收益分配表
CREATE TABLE provider_revenue_distribution (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  order_id VARCHAR(255),
  product_id VARCHAR(255),
  provider_id VARCHAR(255) NOT NULL,
  member_id VARCHAR(255),
  member_inviter_id VARCHAR(255),
  product_price NUMERIC NOT NULL,
  market_fee NUMERIC NOT NULL,
  provider_share NUMERIC NOT NULL,
  direct_reward NUMERIC DEFAULT 0,
  direct_reward_to VARCHAR(255),
  parent_provider_share NUMERIC DEFAULT 0,
  parent_provider_id VARCHAR(255),
  branch_share NUMERIC DEFAULT 0,
  branch_id VARCHAR(255),
  company_share NUMERIC DEFAULT 0,
  status VARCHAR(50) DEFAULT 'completed',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 27. 服务商下级分成表
CREATE TABLE provider_subordinate_split (
  id VARCHAR(255) PRIMARY KEY,
  order_id VARCHAR(255) NOT NULL,
  provider_id VARCHAR(255) NOT NULL,
  upper_provider_id VARCHAR(255) NOT NULL,
  product_name VARCHAR(255),
  order_amount NUMERIC NOT NULL,
  split_ratio NUMERIC NOT NULL,
  split_amount NUMERIC NOT NULL,
  subordinate_count INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- ============================================
-- 索引
-- ============================================
CREATE UNIQUE INDEX users_username_unique ON users(username);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_provider_id ON users(provider_id);
CREATE INDEX idx_users_branch_id ON users(branch_id);
CREATE INDEX idx_users_is_active ON users(is_active);

CREATE UNIQUE INDEX providers_user_id_unique ON providers(user_id);

CREATE UNIQUE INDEX product_templates_code_key ON product_templates(code);
CREATE UNIQUE INDEX products_code_unique ON products(code);

CREATE UNIQUE INDEX energy_accounts_user_id_key ON energy_accounts(user_id);
CREATE INDEX idx_energy_accounts_user_id ON energy_accounts(user_id);
CREATE INDEX idx_energy_transactions_type ON energy_transactions(type);
CREATE INDEX idx_energy_transactions_from_user_id ON energy_transactions(from_user_id);
CREATE INDEX idx_energy_transactions_to_user_id ON energy_transactions(to_user_id);

CREATE INDEX idx_notifications_receiver ON notifications(receiver_id);
CREATE INDEX idx_notifications_status ON notifications(status);

CREATE UNIQUE INDEX system_config_key_unique ON system_config(key);

CREATE INDEX idx_quota_allocations_branch ON quota_allocations(branch_id);
CREATE INDEX idx_quota_allocations_provider ON quota_allocations(provider_id);
CREATE INDEX idx_quota_requests_requester ON quota_requests(requester_id, requester_type);
CREATE INDEX idx_quota_requests_status ON quota_requests(status);

CREATE UNIQUE INDEX quota_accounts_user_id_key ON quota_accounts(user_id);
CREATE INDEX idx_quota_accounts_user ON quota_accounts(user_id);
CREATE INDEX idx_quota_applications_applicant ON quota_applications(applicant_id);
CREATE INDEX idx_quota_applications_status ON quota_applications(status);
CREATE INDEX idx_quota_records_from_user ON quota_records(from_user_id);
CREATE INDEX idx_quota_records_to_user ON quota_records(to_user_id);

CREATE INDEX idx_revenue_details_user ON revenue_details(user_id);
CREATE INDEX idx_revenue_details_type ON revenue_details(type);
CREATE INDEX idx_revenue_details_created ON revenue_details(created_at DESC);
CREATE INDEX idx_member_revenue_user ON member_revenue(user_id);
CREATE INDEX idx_member_revenue_status ON member_revenue(status);

CREATE INDEX idx_prd_provider ON provider_revenue_distribution(provider_id);
CREATE INDEX idx_prd_parent ON provider_revenue_distribution(parent_provider_id);
CREATE INDEX idx_prd_direct_reward_to ON provider_revenue_distribution(direct_reward_to);

-- ============================================
-- 测试数据
-- ============================================

-- 总公司额度
INSERT INTO company_quota (id, total_quota, used_quota, available_quota) VALUES ('1', 100000000, 0, 100000000);

-- 系统配置
INSERT INTO system_config (key, value) VALUES ('repurchase_hours', '48');
INSERT INTO system_config (key, value) VALUES ('energy_withdraw_fee_rate', '0.05');
INSERT INTO system_config (key, value) VALUES ('energy_withdraw_min', '50');
INSERT INTO system_config (key, value) VALUES ('provider_deposit', '16800');
INSERT INTO system_config (key, value) VALUES ('quota_multiplier', '1.2');

-- 产品模板
INSERT INTO product_templates (id, name, code, period, total_rate, market_rate, profit_rate, min_quota, status) VALUES ('tpl-3d', '3天算力套餐', 'GPU-3D', 3, 5, 3, 2, 10000, 'active');
INSERT INTO product_templates (id, name, code, period, total_rate, market_rate, profit_rate, min_quota, status) VALUES ('tpl-7d', '7天算力套餐', 'GPU-7D', 7, 10, 5, 5, 10000, 'active');
INSERT INTO product_templates (id, name, code, period, total_rate, market_rate, profit_rate, min_quota, status) VALUES ('tpl-15d', '15天算力套餐', 'GPU-15D', 15, 20, 10, 10, 50000, 'active');
INSERT INTO product_templates (id, name, code, period, total_rate, market_rate, profit_rate, min_quota, status) VALUES ('tpl-30d', '30天算力套餐', 'GPU-30D', 30, 44, 22, 22, 100000, 'active');
INSERT INTO product_templates (id, name, code, period, total_rate, market_rate, profit_rate, min_quota, status) VALUES ('tpl-90d', '90天算力套餐', 'GPU-90D', 90, 120, 60, 60, 300000, 'active');

-- 测试账号 (密码使用 bcrypt 哈希)
-- admin (密码: admin123)
INSERT INTO users (id, username, password, role, phone, unique_id, invite_code, energy_value, balance, is_active) VALUES
('00000000-0000-0000-0000-000000000001', 'admin', '$2b$10$fQc2aJNCDvBqqUD1VNDysuWlZZNHyJPziBfEQtJKmXsz9mGU4pZiu', 'admin', '13800000001', 'HM000001', 'ADMIN001', 0, 0, true);

-- branch1 (密码: branch123)
INSERT INTO users (id, username, password, role, phone, unique_id, invite_code, energy_value, balance, is_active) VALUES
('00000000-0000-0000-0000-000000000011', 'branch1', '$2b$10$92olwGWVwTrS9tJNk96fvuYnyi1TcXQncK5T.MbqEb.9bnn0p1w5G', 'branch', '13800000011', 'HM000011', 'BRANCH001', 0, 0, true);

-- 服务商A (密码: provider123)
INSERT INTO users (id, username, password, role, phone, unique_id, invite_code, energy_value, balance, provider_id, branch_id, is_active) VALUES
('c1b6dc0f-8a59-4b05-adae-cf48e39993d0', '服务商A', '$2b$10$3U.1En6yzgOMRg92ux5Q1.DtZbp8agr89Iw0aqKyBGMc27tZkI/Ue', 'provider', '13800000021', 'HM000021', 'PROV001', 0, 0, NULL, '00000000-0000-0000-0000-000000000011', true);

-- testmember1 (密码: member123)
INSERT INTO users (id, username, password, role, phone, unique_id, invite_code, energy_value, balance, provider_id, branch_id, is_active) VALUES
('00000000-0000-0000-0000-000000000101', 'testmember1', '$2b$10$Y7bhfJw/.toDFySXu8rCzedeoJ3vWNq5tpusJlvJbWU8KpiBlM4h2', 'member', '13866666666', 'HM666666', 'MEMB001', 0, 0, 'c1b6dc0f-8a59-4b05-adae-cf48e39993d0', '00000000-0000-0000-0000-000000000011', true);

-- 分公司记录
INSERT INTO branches (id, user_id, quota, used_quota, total_sales) VALUES
('branch-001', '00000000-0000-0000-0000-000000000011', 0, 0, 0);

-- 服务商记录
INSERT INTO providers (id, user_id, quota, used_quota, total_sales, branch_id) VALUES
('provider-001', 'c1b6dc0f-8a59-4b05-adae-cf48e39993d0', 50000, 0, 0, '00000000-0000-0000-0000-000000000011');

-- 能量值账户
INSERT INTO energy_accounts (user_id, balance, total_in, total_out) VALUES
('00000000-0000-0000-0000-000000000101', 0, 0, 0);
