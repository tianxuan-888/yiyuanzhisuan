-- 纪元智科 GPU算力平台 - 数据库初始化脚本
-- 在 Supabase SQL Editor 中执行

-- =============================================
-- 1. 启用必要的扩展
-- =============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================
-- 2. 创建枚举类型
-- =============================================
-- 用户角色
CREATE TYPE user_role AS ENUM ('admin', 'branch', 'provider', 'member');

-- 订单类型
CREATE TYPE order_type AS ENUM ('buy', 'sell', 'transfer');

-- 订单状态
CREATE TYPE order_status AS ENUM ('pending', 'paid', 'completed', 'cancelled', 'processing');

-- 产品状态
CREATE TYPE product_status AS ENUM ('available', 'sold', 'pending_sell', 'offline');

-- 额度申请状态
CREATE TYPE quota_status AS ENUM ('pending', 'approved', 'rejected');

-- 能量值交易类型
CREATE TYPE energy_type AS ENUM (
  'create',           -- 创建
  'quota_match',      -- 额度匹配
  'purchase',         -- 购买
  'transfer_in',      -- 转入
  'transfer_out',     -- 转出
  'market_transfer',  -- 市场费
  'market_share',     -- 市场分润
  'recharge',         -- 充值
  'withdraw',         -- 提现
  'burn'              -- 销毁
);

-- =============================================
-- 3. 创建表
-- =============================================

-- 用户表
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(20) UNIQUE,
  role user_role DEFAULT 'member',
  unique_id VARCHAR(20),
  real_name VARCHAR(100),
  alipay_account VARCHAR(100),
  wechat_account VARCHAR(100),
  energy_value NUMERIC(15,2) DEFAULT 0,
  balance NUMERIC(15,2) DEFAULT 0,
  points INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  provider_id UUID,
  branch_id UUID,
  inviter_id UUID,
  invite_code VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 用户索引
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_provider_id ON users(provider_id);
CREATE INDEX idx_users_branch_id ON users(branch_id);

-- 产品模板表
CREATE TABLE product_templates (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  period INTEGER NOT NULL,
  total_rate NUMERIC(10,2) NOT NULL,
  market_rate NUMERIC(10,2) NOT NULL,
  profit_rate NUMERIC(10,2) NOT NULL,
  min_quota INTEGER DEFAULT 1000,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 产品表
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50),
  image_url TEXT,
  price NUMERIC(15,2) NOT NULL,
  period INTEGER NOT NULL,
  total_rate NUMERIC(10,2) NOT NULL,
  market_rate NUMERIC(10,2) NOT NULL,
  profit_rate NUMERIC(10,2) NOT NULL,
  market_fee NUMERIC(15,2) DEFAULT 0,
  provider_id UUID,
  template_id VARCHAR(50),
  status product_status DEFAULT 'available',
  is_listed BOOLEAN DEFAULT false,
  transfer_start_time TIMESTAMPTZ,
  transfer_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 产品索引
CREATE INDEX idx_products_provider_id ON products(provider_id);
CREATE INDEX idx_products_status ON products(status);

-- 用户产品表（持仓）
CREATE TABLE user_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  product_id UUID NOT NULL,
  purchase_price NUMERIC(15,2) NOT NULL,
  purchase_date TIMESTAMPTZ NOT NULL,
  expire_date TIMESTAMPTZ NOT NULL,
  expected_profit NUMERIC(15,2) DEFAULT 0,
  market_fee NUMERIC(15,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'holding',
  sell_price NUMERIC(15,2),
  sell_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 用户产品索引
CREATE INDEX idx_user_products_user_id ON user_products(user_id);
CREATE INDEX idx_user_products_status ON user_products(status);

-- 订单表
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  user_product_id UUID,
  order_type order_type NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  energy_cost NUMERIC(15,2) DEFAULT 0,
  status order_status DEFAULT 'pending',
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  product_id UUID,
  payment_confirmed BOOLEAN DEFAULT false,
  payment_confirmed_at TIMESTAMPTZ,
  payment_confirmed_by UUID,
  reject_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- 订单索引
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_product_id ON orders(product_id);

-- 服务商表
CREATE TABLE providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL,
  quota INTEGER DEFAULT 0,
  used_quota INTEGER DEFAULT 0,
  total_sales INTEGER DEFAULT 0,
  split_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  branch_id UUID,
  parent_provider_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 服务商索引
CREATE INDEX idx_providers_user_id ON providers(user_id);
CREATE INDEX idx_providers_branch_id ON providers(branch_id);

-- 额度分配表
CREATE TABLE quota_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id UUID,
  provider_id UUID,
  template_id VARCHAR(50),
  quota_amount INTEGER NOT NULL,
  used_amount INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 能量值账户表
CREATE TABLE energy_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL,
  balance NUMERIC(15,2) DEFAULT 0,
  total_in NUMERIC(15,2) DEFAULT 0,
  total_out NUMERIC(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 能量值交易记录表
CREATE TABLE energy_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  type energy_type NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  from_user_id UUID,
  to_user_id UUID,
  related_user_id UUID,
  related_order_id UUID,
  note TEXT,
  status VARCHAR(20) DEFAULT 'completed',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 能量值交易索引
CREATE INDEX idx_energy_transactions_user_id ON energy_transactions(user_id);
CREATE INDEX idx_energy_transactions_type ON energy_transactions(type);

-- 通知表
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receiver_id UUID NOT NULL,
  receiver_role VARCHAR(20),
  sender_id UUID,
  sender_name VARCHAR(100),
  type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT,
  is_read BOOLEAN DEFAULT false,
  amount NUMERIC(15,2),
  related_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 通知索引
CREATE INDEX idx_notifications_receiver_id ON notifications(receiver_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);

-- 额度申请表
CREATE TABLE quota_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id UUID NOT NULL,
  requester_type VARCHAR(20) NOT NULL,
  parent_id UUID,
  requested_amount INTEGER NOT NULL,
  approved_amount INTEGER,
  multiplier NUMERIC(5,2) DEFAULT 1.0,
  status quota_status DEFAULT 'pending',
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 总公司额度表
CREATE TABLE company_quota (
  id INTEGER PRIMARY KEY DEFAULT 1,
  total_quota BIGINT DEFAULT 100000000,
  used_quota BIGINT DEFAULT 0,
  available_quota BIGINT DEFAULT 100000000,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 服务商申请表
CREATE TABLE provider_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  applicant_name VARCHAR(100),
  phone VARCHAR(20),
  apply_type VARCHAR(20) DEFAULT 'first',
  parent_provider_id UUID,
  branch_id UUID,
  quota_request INTEGER DEFAULT 0,
  status quota_status DEFAULT 'pending',
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 能量值充值申请表
CREATE TABLE energy_recharge_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  provider_id UUID,
  amount NUMERIC(15,2) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  note TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 能量值提现申请表
CREATE TABLE energy_withdraw_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  actual_amount NUMERIC(15,2),
  fee NUMERIC(15,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  note TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 能量值分润记录表
CREATE TABLE provider_revenue_distribution (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID,
  product_id UUID,
  provider_id UUID NOT NULL,
  member_id UUID,
  market_fee NUMERIC(15,2) DEFAULT 0,
  provider_share NUMERIC(15,2) DEFAULT 0,
  direct_reward NUMERIC(15,2) DEFAULT 0,
  direct_reward_to UUID,
  parent_provider_id UUID,
  parent_provider_share NUMERIC(15,2) DEFAULT 0,
  branch_id UUID,
  branch_share NUMERIC(15,2) DEFAULT 0,
  company_share NUMERIC(15,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 4. 启用 Row Level Security (RLS)
-- =============================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE energy_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE energy_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 5. 初始化测试数据（可选）
-- =============================================

-- 插入产品模板
INSERT INTO product_templates (id, name, code, period, total_rate, market_rate, profit_rate, min_quota) VALUES
  ('tpl-3d', 'GPU算力3天', 'GPU-3D', 3, 5, 3, 2, 1000),
  ('tpl-7d', 'GPU算力7天', 'GPU-7D', 7, 10, 5, 5, 1000),
  ('tpl-15d', 'GPU算力15天', 'GPU-15D', 15, 20, 10, 10, 5000),
  ('tpl-30d', 'GPU算力30天', 'GPU-30D', 30, 44, 22, 22, 10000),
  ('tpl-90d', 'GPU算力90天', 'GPU-90D', 90, 120, 60, 60, 30000);

-- 初始化总公司额度
INSERT INTO company_quota (id, total_quota, used_quota, available_quota) VALUES (1, 100000000, 0, 100000000);

-- =============================================
-- 6. 重要提醒
-- =============================================

-- 执行完此脚本后，运行 seed-test-data.ts 初始化测试用户
