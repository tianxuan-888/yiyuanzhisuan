# 艺元智算 - GPU算力基建平台

## 项目概览
本项目是一个完整的多角色后台管理系统，包含**四端独立界面**（总公司、分公司、服务商、会员），实现完整的产品流转体系和数据关系网。

**产品流转体系**：总公司创建产品模板 → 分公司分配额度给服务商 → 服务商生成产品并上架 → 会员购买产品

**运营模式**：艺元智算建设机房运营GPU算力设施，会员投资购买GPU芯片产品，到期返还本金并支付收益，机房设备归艺元智算所有。

## 技术栈
- **框架**: Next.js 16 (App Router)
- **语言**: TypeScript 5
- **UI组件**: shadcn/ui (基于 Radix UI)
- **样式**: Tailwind CSS 4
- **图表**: Recharts 2.15
- **图标**: Lucide React
- **数据库**: Supabase (PostgreSQL)
- **ORM**: Drizzle ORM
- **服务端口**: 5000

## 数据库设计

### 核心数据表

| 表名 | 说明 | 主要字段 |
|------|------|----------|
| users | 用户表 | id, username, password, phone, unique_id, role, provider_id, branch_id, inviter_id, energy_value, balance |
| product_templates | 产品模板表 | id, name, code, period, total_rate, market_rate, profit_rate, min_quota, status |
| quota_allocations | 额度分配表 | id, branch_id, provider_id, template_id, quota_amount, used_amount, status |
| products | 产品表 | id, name, code, price, period, total_rate, market_rate, profit_rate, provider_id, status |
| user_products | 用户产品表 | id, user_id, product_id, purchase_price, purchase_date, expire_date, status |
| orders | 订单表 | id, user_id, user_product_id, order_type, amount, status |
| providers | 服务商配置表 | id, user_id, quota, used_quota, total_sales |
| transactions | 交易记录表 | id, user_id, order_id, type, amount |
| withdrawals | 提现记录表 | id, user_id, amount, status |
| notifications | 通知表 | id, user_id, type, title, content, is_read |
| provider_applications | 服务商申请表 | id, user_id, applicant_name, phone, apply_type, parent_provider_id, branch_id, quota_request, status |
| quota_requests | 额度申请表 | id, requester_id, requester_type, parent_id, requested_amount, approved_amount, multiplier, status |
| company_quota | 总公司额度表 | id, total_quota, used_quota, available_quota |
| energy_accounts | 能量值账户表 | id, user_id, balance, total_in, total_out |
| energy_transactions | 能量值流水表 | id, type, amount, from_user_id, to_user_id |
| energy_withdraw_requests | 变现申请表 | id, user_id, amount, actual_amount, fee, status |
| system_config | 系统配置表 | id, key, value |

## 三类核心数据

### 第一类：用户账号体系
- **核心表**: `users`
- **绑定关系**: `provider_id`（服务商）、`branch_id`（分公司）、`inviter_id`（推荐人）
- **关系树**: 总公司 → 分公司 → 服务商 → 会员

### 第二类：算力额度流转
- **核心表**: `company_quota`, `quota_allocations`, `providers`, `products`
- **流转路径**:
  1. 总公司生成额度 → 分配给分公司
  2. 分公司分配给服务商
  3. 服务商用额度生成产品
  4. 会员购买产品

### 第三类：能量值流转
- **核心表**: `energy_accounts`, `energy_transactions`, `energy_withdraw_requests`
- **能量值类型**:
  | 类型 | 说明 | 流转方向 |
  |------|------|----------|
  | `create` | 总公司创建能量值 | 系统 → 总公司 |
  | `quota_match` | 额度匹配下发 | 总公司 → 分公司 |
  | `purchase` | 分公司购买能量值 | 分公司 → 总公司 |
  | `transfer_in` | 转入 | 服务商 → 会员 |
  | `transfer_out` | 转出 | 会员 → 服务商 |
  | `withdraw_freeze` | 变现冻结 | 账户 → 冻结池 |
  | `withdraw` | 变现发放 | 冻结池 → 用户（扣除5%手续费） |
  | `burn` | 能量值销毁 | 账户 → 系统 |
- **能量值来源**:
  - 购买产品时预扣（market_fee）
  - 总公司下发（quota_match）
  - 分公司购买（purchase）
  - 服务商给会员充值
- **能量值消耗**:
  - 购买产品支付市场费（预扣）
  - 会员变现（withdraw）
  - 能量值销毁（burn）
  - 手续费沉淀（5%）

### 第四类：产品流转（核心机制）

产品流转是本平台的核心商业模式，实现会员间的产品交易。

#### 流转五阶段

```
┌─────────────────────────────────────────────────────────────────────┐
│                    产品流转完整流程                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  【阶段1】服务商上架产品                                             │
│                                                                     │
│  服务商生成产品 → 设置原价上架 → 等待会员购买                         │
│                        ↓                                            │
│  【阶段2】会员A首次购买（从服务商）                                 │
│                                                                     │
│  会员A支付本金给服务商（线下）                                      │
│  服务商审核确认收款                                                  │
│  产品从服务商 → 会员A                                                │
│  会员A获得持仓，持有期间获得收益                                     │
│                        ↓                                            │
│  【阶段3】会员A持有并获得收益                                        │
│                                                                     │
│  持有期间按周期收益率每日/周期结算收益                                │
│  收益到账：可变现 或 转能量值 继续购买其他产品                        │
│                        ↓                                            │
│  【阶段4】会员A卖出（流转给会员B）                                   │
│                                                                     │
│  会员A发布流转 → 会员B线下付款给会员A                                 │
│  付款完成 → 服务商审核通过 → 产品流转给会员B                          │
│  流转价格：不变（仍为原价）                                          │
│  会员A获得：收益（5%或10%）                                         │
│                        ↓                                            │
│  【阶段5】48小时无人购买 → 服务商回购                                │
│                                                                     │
│  48小时内无会员购买 → 服务商必须回购                                 │
│  服务商线下把本金返还给会员A                                          │
│  产品回到服务商代售列表                                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 流转状态机

| 状态 | 说明 | 触发条件 |
|------|------|----------|
| `pending` | 待购买 | 会员发布流转，等待其他会员购买 |
| `awaiting_payment` | 等待付款 | 有会员申请购买，等待线下付款 |
| `completed` | 已完成 | 服务商审核通过，产品已流转 |
| `rejected` | 已拒绝 | 服务商审核拒绝，产品退回持有状态 |
| `repurchased` | 已回购 | 48小时无人购买，服务商回购 |

#### 收益计算规则

| 产品周期 | 收益率 | 收益归属 |
|----------|--------|----------|
| 3天 | 5% | 会员A |
| 7天 | 10% | 会员A |

**示例**：会员A以¥10,000购买7天产品，持有30天后流转给会员B
- 会员A获得收益：¥10,000 × 10% = ¥1,000
- 本金：会员A通过线下交易从会员B处获得
- 会员B持有产品，继续获得后续收益

#### 回购规则

| 配置项 | 值 |
|--------|-----|
| 回购期限 | 48小时 |
| 回购本金返还 | 线下返还给卖方 |
| 回购后产品状态 | 返回服务商代售列表 |

#### 核心API

| API | 功能 |
|-----|------|
| POST /api/products/transfer/publish | 发布流转 |
| GET /api/products/transfer/list | 获取流转列表 |
| POST /api/products/transfer/buy | 申请购买流转 |
| POST /api/products/transfer/review | 服务商审核流转 |
| GET /api/products/transfer/pending-repurchase | 待回购列表 |
| POST /api/products/transfer/repurchase | 服务商回购 |

### 用户角色（四端体系）

| 角色 | 说明 | 主要功能 | 登录账号 | 用户ID |
|------|------|----------|----------|--------|
| admin | 总公司管理员 | 创建产品模板、管理分公司、查看全局数据 | admin / admin123 | admin-id-001 |
| branch | 分公司管理员 | 分配额度给服务商、审核第一代服务商申请、查看区域数据 | branch1 / branch123 | branch-id-001 |
| provider | 服务商 | 生成产品、一键上架、审核第二代服务商申请 | member1 / member123 | member-id-001 |
| member | 会员 | 购买产品、查看持仓、申请成为服务商 | member1 / member123 | member-id-001 |

### 专属ID说明

每个手机注册的账号都会生成一个专属ID，用于身份确认：

| 字段 | 格式 | 示例 | 用途 |
|------|------|------|------|
| unique_id | HM + 手机号后6位 | HM345678 | 转账确认、身份识别 |

**显示格式**：用户名 [专属ID] (手机号)
- 例如：`服务商A [HM123456] (138****5678)`

### 测试数据（Supabase）

**数据库连接**: `COZE_SUPABASE_URL` 环境变量

**用户表数据**:
- admin: 用户ID `00000000-0000-0000-0000-000000000001`, 角色 `admin`
- branch1: 用户ID `00000000-0000-0000-0000-000000000011`, 角色 `branch`  
- member1: 用户ID `c1b6dc0f-8a59-4b05-adae-cf48e39993d0`, 角色 `provider`

**服务商表数据**:
- member1 服务商: user_id=`c1b6dc0f-8a59-4b05-adae-cf48e39993d0`, quota=50000, used_quota=50000, branch_id=`00000000-0000-0000-0000-000000000011`

**组织架构**:
- 总公司 (admin) → 分公司 (branch1) → 服务商 (member1) → 会员 (member2, member3, provider1)

**产品表数据**:
- 20个产品（3天×10 + 7天×10），总价 ¥50,000

### 服务商申请流程

**第一代服务商（分公司审核）**：
1. 会员在会员端点击"申请服务商"
2. 选择"第一代申请"，填写信息和所属分公司ID
3. 分公司在"审核申请"页面审核
4. 通过后自动升级为服务商，获得额度分配

**第二代服务商（上级服务商审核）**：
1. 会员在会员端点击"申请服务商"
2. 选择"第二代申请"，填写信息和上级服务商ID
3. 上级服务商在"审核申请"页面审核
4. 通过后从上级服务商额度中拆分，自动升级为服务商

### 额度流转体系

**总额度**：总公司1亿元

**额度流转流程**：
1. **分公司向总公司申请额度**
   - 分公司在"额度管理"页面申请
   - 申请额度按 **120%** 给予（申请100万 → 获得100万算力额度 + 20万能量值）
   - 总公司在"额度审批"页面审核

2. **服务商向分公司申请额度**
   - 服务商在"额度管理"页面申请
   - 申请额度按100%给予
   - 分公司在"额度审批"页面审核

3. **产品生成（5万额度）**
   - 支持3天+7天混合模板
   - 产品价格分配（整额200-10000）：
     - 小额产品(200-1000元) × 4个：200, 300, 400, 500, 600, 700, 800, 900, 1000
     - 中小产品(1000-3000元) × 5个：1000, 1500, 2000, 2500, 3000
     - 中大产品(3000-6000元) × 3个：3000, 4000, 5000, 6000
     - 大额产品(6000-10000元) × 3个：6000, 7000, 8000, 9000, 10000

### 产品状态

| 状态 | 说明 |
|------|------|
| available | 可购买 |
| sold | 已售出 |
| pending_sell | 待审核卖出 |

### 订单状态

| 状态 | 说明 |
|------|------|
| pending | 待支付/待审核 |
| paid | 已支付 |
| completed | 已完成 |
| cancelled | 已取消 |

## API 接口

### 用户认证接口

#### POST /api/auth/register
用户注册接口

**请求参数：**
```json
{
  "username": "用户名（3-50字符）",
  "password": "密码（至少6字符）",
  "phone": "手机号（可选）",
  "realName": "真实姓名（可选）",
  "alipayAccount": "支付宝账号（可选）",
  "inviterCode": "推荐人邀请码（可选）",
  "providerId": "服务商ID（可选）"
}
```

**返回示例：**
```json
{
  "success": true,
  "data": {
    "id": "用户ID",
    "username": "用户名",
    "role": "member"
  }
}
```

#### POST /api/auth/login
用户登录接口

**请求参数：**
```json
{
  "username": "用户名",
  "password": "密码"
}
```

**返回示例：**
```json
{
  "success": true,
  "data": {
    "id": "用户ID",
    "username": "用户名",
    "role": "member",
    "phone": "手机号",
    "real_name": "真实姓名",
    "alipay_account": "支付宝账号",
    "provider_id": "服务商ID",
    "inviter_id": "推荐人ID",
    "energy_value": 0,
    "balance": 0,
    "is_active": true,
    "created_at": "创建时间",
    "updated_at": "更新时间"
  }
}
```

### 找回密码接口

#### POST /api/auth/forgot-password/send-code
找回密码 - 发送验证码（要求手机号已注册）

**请求参数：**
```json
{
  "phone": "手机号"
}
```

**返回示例：**
```json
{
  "success": true,
  "message": "验证码已发送",
  "devCode": "123456"
}
```

#### POST /api/auth/forgot-password/reset
找回密码 - 重置密码

**请求参数：**
```json
{
  "phone": "手机号",
  "verifyCode": "验证码",
  "newPassword": "新密码",
  "confirmPassword": "确认新密码"
}
```

**返回示例：**
```json
{
  "success": true,
  "message": "密码重置成功，请使用新密码登录"
}
```

### 产品管理接口

#### GET /api/products
获取产品列表

**查询参数：**
- `providerId`: 服务商ID（可选）
- `status`: 产品状态（可选）

**返回示例：**
```json
{
  "success": true,
  "data": [
    {
      "id": "产品ID",
      "name": "产品名称",
      "code": "产品编号",
      "image_url": "图片URL",
      "price": 10000,
      "period": 7,
      "total_rate": 10,
      "market_rate": 5,
      "profit_rate": 5,
      "provider_id": "服务商ID",
      "status": "available",
      "created_at": "创建时间",
      "updated_at": "更新时间"
    }
  ]
}
```

#### POST /api/products
创建产品

**请求参数：**
```json
{
  "name": "产品名称",
  "code": "产品编号",
  "imageUrl": "图片URL（可选）",
  "price": "价格",
  "period": 7,
  "totalRate": "10",
  "marketRate": "5",
  "profitRate": "5",
  "providerId": "服务商ID（可选）"
}
```

#### GET /api/products/[id]
获取单个产品

#### PUT /api/products/[id]
更新产品

#### DELETE /api/products/[id]
删除产品

### 订单管理接口

#### POST /api/orders/buy
购买产品

**请求参数：**
```json
{
  "userId": "用户ID",
  "productId": "产品ID"
}
```

**返回示例：**
```json
{
  "success": true,
  "data": {
    "order": {
      "id": "订单ID",
      "user_id": "用户ID",
      "user_product_id": "用户产品ID",
      "order_type": "buy",
      "amount": 10000,
      "status": "completed"
    },
    "userProduct": {
      "id": "用户产品ID",
      "user_id": "用户ID",
      "product_id": "产品ID",
      "purchase_price": 10000,
      "purchase_date": "购买日期",
      "expire_date": "到期日期",
      "expected_profit": 1000,
      "market_fee": 500,
      "status": "holding"
    }
  }
}
```

#### POST /api/orders/sell
卖出产品

**请求参数：**
```json
{
  "userId": "用户ID",
  "userProductId": "用户产品ID"
}
```

**返回示例：**
```json
{
  "success": true,
  "data": {
    "order": {
      "id": "订单ID",
      "order_type": "sell",
      "amount": 11000,
      "status": "pending"
    },
    "message": "卖出申请已提交，等待服务商审核"
  }
}
```

#### GET /api/orders
获取订单列表

**查询参数：**
- `userId`: 用户ID（可选）
- `orderType`: 订单类型 buy/sell（可选）
- `status`: 订单状态（可选）
- `page`: 页码（默认1）
- `pageSize`: 每页数量（默认20）

#### POST /api/orders/review
审核卖出订单

**请求参数：**
```json
{
  "orderId": "订单ID",
  "reviewerId": "审核人ID",
  "action": "approve/reject",
  "note": "审核备注（可选）"
}
```

**返回示例：**
```json
{
  "success": true,
  "message": "审核通过，用户收益已发放"
}
```

### 产品流转接口（新增）

#### GET /api/product-templates
获取产品模板列表

**返回示例：**
```json
{
  "success": true,
  "data": [
    {
      "id": "tpl-7d",
      "name": "周算力套餐",
      "code": "GPU-7D",
      "period": 7,
      "total_rate": 10,
      "market_rate": 5,
      "profit_rate": 5,
      "min_quota": 10000,
      "status": "active"
    }
  ]
}
```

#### POST /api/quota-allocations
分配额度给服务商

**请求参数：**
```json
{
  "branchId": "分公司ID",
  "providerId": "服务商ID",
  "templateId": "产品模板ID",
  "quotaAmount": 50000
}
```

#### POST /api/provider/generate-products
服务商生成产品

**请求参数：**
```json
{
  "providerId": "服务商ID",
  "templateId": "产品模板ID",
  "quotaAmount": 50000
}
```

**返回示例：**
```json
{
  "success": true,
  "data": {
    "products": [...],  // 生成的15个产品
    "stats": {
      "total": 15,
      "totalValue": 50000
    }
  }
}
```

#### POST /api/provider/products/batch-status
批量修改产品状态（一键上架）

**请求参数：**
```json
{
  "providerId": "服务商ID",
  "productIds": ["产品ID1", "产品ID2"],
  "status": "available"
}
```

#### GET /api/notifications
获取用户通知

**查询参数：**
- `userId`: 用户ID
- `isRead`: 是否已读（可选）

#### GET /api/member/energy-records
获取会员能量值记录

**查询参数：**
- `userId`: 用户ID

#### GET /api/admin/overview
获取总公司数据总览统计

**查询参数：**
- `type`: 数据类型（可选，默认为 all）
  - `product`: 产品数据
  - `user`: 用户数据
  - `energy`: 能力值数据
  - `all`: 全部数据

**返回示例：**
```json
{
  "success": true,
  "data": {
    "product": {
      "totalSold": 15,
      "idleCount": 25,
      "totalSalesAmount": 750000,
      "todaySold": 2,
      "todaySalesAmount": 10000,
      "productsByPeriod": [
        { "period": 3, "count": 5, "amount": 25000 },
        { "period": 7, "count": 10, "amount": 725000 }
      ],
      "salesTrend": [
        { "date": "2024-01-01", "count": 2, "amount": 10000 }
      ]
    },
    "user": {
      "totalUsers": 100,
      "totalMembers": 80,
      "todayNewUsers": 5,
      "todayNewMembers": 3,
      "todayPurchaseAmount": 50000,
      "newUsersTrend": [...],
      "purchaseTrend": [...]
    },
    "energy": {
      "totalEnergy": 50000,
      "todayEnergyChange": 1000,
      "energyTrend": [...],
      "topEnergyUsers": [
        { "userId": "...", "username": "user1", "energyValue": 5000 }
      ]
    }
  }
}

**返回示例：**
```json
{
  "success": true,
  "data": {
    "records": [
      {
        "id": "记录ID",
        "type": "recharge/transfer_in/transfer_out",
        "amount": 1000,
        "status": "completed/pending",
        "note": "备注",
        "created_at": "2024-01-01T00:00:00Z",
        "recordType": "recharge"
      }
    ],
    "stats": {
      "totalRecharge": 5000,
      "totalTransferOut": 2000,
      "totalTransferIn": 1000,
      "rechargeCount": 5,
      "transferOutCount": 2,
      "transferInCount": 1
    }
  }
}
```

#### POST /api/notifications/mark-read
标记通知为已读

**请求参数：**
```json
{
  "notificationId": "通知ID"
}
```

### 额度管理接口

#### POST /api/provider/request-quota
服务商申请额度

**请求参数：**
```json
{
  "providerId": "服务商ID",
  "requestedAmount": 10000,
  "note": "申请说明（可选）"
}
```

**返回示例：**
```json
{
  "success": true,
  "message": "额度申请已提交，等待分公司审核"
}
```

#### POST /api/branch/approve-quota
分公司审批额度申请

**请求参数：**
```json
{
  "requestId": "申请ID",
  "action": "approve/reject",
  "approvedAmount": 10000,
  "note": "审批备注（可选）"
}
```

**返回示例：**
```json
{
  "success": true,
  "message": "额度申请已通过，已分配10000额度给服务商"
}
```

#### GET /api/provider/quota-requests
获取服务商额度申请列表

**查询参数：**
- `providerId`: 服务商ID（可选，用于服务商查看自己的申请）

**返回示例：**
```json
{
  "success": true,
  "data": [
    {
      "id": "req-id",
      "requester_id": "服务商ID",
      "requester_name": "服务商名称",
      "requested_amount": 10000,
      "approved_amount": 10000,
      "status": "pending/approved/rejected",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### 能量值管理接口

#### POST /api/energy/transfer
能量值互转

**请求参数：**
```json
{
  "fromUserId": "转出方用户ID",
  "toUserId": "转入方用户ID",
  "amount": 100,
  "note": "备注（可选）"
}
```

**返回示例：**
```json
{
  "success": true,
  "message": "转账成功，能量值已转入对方账户"
}
```

#### GET /api/energy/transfer-targets
获取可转账对象列表

**查询参数：**
- `role`: 当前用户角色（branch/provider/member）
- `userId`: 当前用户ID

**返回示例：**
```json
{
  "success": true,
  "data": [
    {
      "id": "用户ID",
      "username": "用户名",
      "role": "provider",
      "energy_value": 5000
    }
  ]
}
```

### 能量值充值接口

#### POST /api/member/energy-recharge
会员提交充值申请

**请求参数：**
```json
{
  "userId": "用户ID",
  "amount": 100,
  "note": "备注（可选）"
}
```

**返回示例：**
```json
{
  "success": true,
  "message": "充值申请已提交，请联系服务商线下付款后等待确认",
  "data": {
    "requestId": "申请ID",
    "providerName": "服务商名称",
    "providerPhone": "服务商电话",
    "amount": 100
  }
}
```

#### GET /api/member/energy-recharge
获取会员的充值申请记录

**查询参数：**
- `userId`: 用户ID

**返回示例：**
```json
{
  "success": true,
  "data": [
    {
      "id": "申请ID",
      "amount": 100,
      "note": "备注",
      "status": "pending/approved/rejected",
      "created_at": "创建时间"
    }
  ]
}
```

#### GET /api/provider/recharge-request
服务商获取充值申请列表

**查询参数：**
- `providerId`: 服务商ID

**返回示例：**
```json
{
  "success": true,
  "data": [
    {
      "id": "申请ID",
      "memberId": "会员ID",
      "memberName": "会员名称",
      "memberPhone": "会员电话",
      "amount": 100,
      "note": "备注",
      "status": "pending/approved/rejected",
      "createdAt": "创建时间"
    }
  ]
}
```

#### POST /api/provider/recharge-request
服务商审批充值申请

**请求参数：**
```json
{
  "requestId": "申请ID",
  "providerId": "服务商ID",
  "action": "approve/reject",
  "note": "拒绝备注（可选）"
}
```

**返回示例：**
```json
{
  "success": true,
  "message": "已成功充值 100 能量值给 会员名称",
  "data": {
    "amount": 100,
    "memberEnergy": 500,
    "providerEnergy": 9500
  }
}
```

### 三类数据统计接口

#### GET /api/admin/three-types-stats
获取三类核心数据统一统计

**查询参数：**
- `type`: 统计类型（可选）
  - `all`: 全部统计（默认）
  - `users`: 仅用户统计
  - `quota`: 仅额度统计
  - `energy`: 仅能量值统计

**返回示例：**
```json
{
  "success": true,
  "data": {
    // 第一类：用户账号体系统计
    "users": {
      "totalUsers": 6,
      "byRole": {
        "admin": 1,
        "branch": 1,
        "provider": 1,
        "member": 3
      },
      "bindingRelations": {
        "totalProviders": 1,
        "totalMembers": 3,
        "avgMembersPerProvider": 3
      }
    },
    // 第二类：算力额度流转统计
    "quota": {
      "companyQuota": {
        "totalQuota": 100000000,
        "usedQuota": 0,
        "availableQuota": 100000000
      },
      "allocations": {
        "toBranches": 25000,
        "toProviders": 0,
        "totalAllocated": 25000
      },
      "providerQuota": {
        "total": 50000,
        "used": 0,
        "available": 50000
      },
      "products": {
        "total": 0,
        "available": 0,
        "sold": 0,
        "totalSalesAmount": 0
      },
      "userHoldings": {
        "totalHoldings": 0,
        "totalMembers": 0,
        "avgHoldingsPerMember": 0
      }
    },
    // 第三类：能量值流转统计
    "energy": {
      "holdings": {
        "admin": 33750,
        "branch": 13940,
        "provider": 1000,
        "member": 0,
        "total": 48690
      },
      "sources": {
        "create": 15500,
        "quotaMatch": 16000,
        "purchase": 0,
        "transferIn": 10850,
        "total": 42350
      },
      "consumption": {
        "transferOut": 1250,
        "withdraw": 255,
        "burn": 3054,
        "total": 4559
      },
      "withdraw": {
        "totalRequests": 15,
        "pendingCount": 0,
        "pendingAmount": 0,
        "approvedAmount": 3239.5,
        "totalBurn": 3410,
        "totalFee": 170.5
      }
    },
    // 汇总
    "summary": {
      "totalUsers": 6,
      "totalQuota": 100000000,
      "totalEnergy": 48690,
      "totalProductsSold": 0,
      "totalSalesAmount": 0
    }
  }
}
```

## 项目结构
```
.
├── src/
│   ├── app/
│   │   ├── page.tsx                    # 登录页面（四端入口）
│   │   ├── layout.tsx                  # 根布局
│   │   ├── admin/
│   │   │   └── page.tsx                # 总公司管控后台
│   │   ├── branch/
│   │   │   └── page.tsx                # 分公司管控后台
│   │   ├── provider/
│   │   │   └── page.tsx                # 服务商管控后台
│   │   └── member/
│   │       └── page.tsx                # 会员端
│   ├── hooks/
│   │   └── useAuth.ts                  # 登录验证 Hook（含会员等级）
│   ├── config/
│   │   └── powerPackages.ts            # GPU产品配置与规则
│   └── components/
│       └── ui/                         # shadcn/ui 组件库
├── .coze                               # 项目配置
├── package.json
└── AGENTS.md
```

## GPU产品配置 (`src/config/powerPackages.ts`)

### 商业模式

**资金流转**：
```
会员投资本金 → 公司（用于购买GPU设备、建设机房）
购买产品时 → 需用能量值支付市场费（预先储备）
到期卖出时 → 获得本金 + 实际到手收益
服务商收益 → 从能量值（市场费）中分成70%
机房设备 → 归公司所有（持续运营）
```

**收益模型**：
- **购买时**：会员支付本金 + 能量值（市场费）
- **到期时**：获得本金 + 实际收益（能量值已预先扣除）
- **能量值来源**：找服务商充值（服务商线下收款，线上给会员充值能量值）

### GPU产品周期（5个周期）

| 周期 | 总收益 | 会员实际到手 | 能量值支付 | 金额范围 |
|------|--------|-------------|-----------|----------|
| 3天  | 5%     | 2%          | 3%        | ¥1,000-5,000 |
| 7天  | 10%    | 5%          | 5%        | ¥1,000-10,000 |
| 15天 | 20%    | 10%         | 10%       | ¥5,000-30,000 |
| 30天 | 44%    | 22%         | 22%       | ¥10,000-100,000 |
| 90天 | 120%   | 60%         | 60%       | ¥30,000-500,000 |

**举例说明**：
- 投资 ¥10,000 购买 7天产品
- 总收益：¥1,000（10%）
- 会员实际到手：¥500（5%）
- 需支付能量值：500（5%）
- 到期卖出时：本金 ¥10,000 + 实际到手 ¥500 = ¥10,500

### 能量值分配比例

| 角色 | 分配比例 |
|------|---------|
| 服务商 | 70% |
| 公司运营 | 5% |
| 直推奖励 | 10% |
| 上级服务商 | 10% |
| 分公司 | 5% |

**举例**：会员卖出产品支付 500 能量值
- 服务商获得：500 × 70% = 350
- 公司运营获得：500 × 5% = 25
- 直推获得：500 × 10% = 50
- 上级服务商获得：500 × 10% = 50
- 分公司获得：500 × 5% = 25

### 服务商配置

| 项目 | 配置 |
|------|------|
| 身份保证金 | ¥16,800 |
| 服务商收益提现手续费 | 5% |
| 最低提现金额 | ¥100 |
| 培养1个服务商分成 | 下级交易额的0.3% |
| 培养≥3个服务商分成 | 所有下级交易额的0.5% |

### 服务商收益来源

| 收益类型 | 来源 | 说明 |
|----------|------|------|
| 服务商收益 | 会员投资 | 从总收益中分成（不影响会员收益） |
| 下级分成 | 培养服务商 | 1个0.3%，≥3个0.5% |

## 页面路由

### 1. 登录页面 - `/`
手机号登录页面，功能包括：
- 账号/手机号/专属ID + 密码登录
- 新用户注册（手机号 + 验证码 + 邀请码）
- 找回密码（手机号验证码验证 → 重置密码）
- 根据角色自动跳转到对应后台

**测试账号：**
| 角色 | 手机号 | 验证码 |
|------|--------|--------|
| 总公司 | 13800000001 | 123456 |
| 服务商 | 13800000011 | 123456 |
| 会员 | 13866666666 | 123456 |

### 2. 总公司管控后台 - `/admin`
**需要登录验证（角色：admin）**

**左侧导航菜单：**
1. **数据总览**
   - **产品数据**：
     - 产品售卖总数预览
     - 闲置产品数量预览
     - 售卖总额度预览
     - 近7天销售趋势图表
     - 产品周期分布表格
   - **用户数据**：
     - 每日新增注册用户
     - 每日新增购买金额
     - 近7天用户增长趋势图表
     - 近7天购买金额趋势图表
   - **能力值统计**：
     - 每日递增能力值总额
     - 能量值 Top 10 用户排行榜
     - 近7天能量值变化趋势图表
     - 服务商/会员能量值分布

2. **分公司管理**
   - 全局视图：分公司列表（可搜索、创建、分配额度、查看详情）
   - **已实现功能**：
     - 统计卡片：分公司数量、服务商总数、能量值持有、产品总收益
     - 数据表格：分公司名称、联系方式、算力额度申请、能量值持有、拥有服务商、体系用户、产品额度、创造收益
     - 详情钻取：点击进入分公司详情页，支持额度管理、所属服务商、体系会员Tab切换
     - API: `GET /api/admin/branch-management`
     - **增强功能**：新增详细分公司明细页面，包含：
       - 分公司算力额度统计（总额度、已分配、剩余）
       - 服务商列表（服务商额度、已售产品、销售金额、会员数量）
       - 会员购买情况（会员列表、购买金额、订单数量）
       - 算力统计Tab（分公司算力、服务商算力、产品销售、会员统计）
       - 额度使用进度条可视化
     - **修复记录**：服务商数量从 `providers` 表获取（而非 `users` 表），正确显示服务商数量
3. **服务商管理**
   - 全局视图：所有服务商列表（可按分公司筛选）
   - **已实现功能**：
     - 列表展示：服务商名称、手机号、所属分公司、能量值、额度使用、产品收益
     - 详情钻取：点击进入服务商详情页，支持总览、账户信息、业绩统计、会员列表Tab切换
     - API: `GET /api/admin/provider-management`
     - **修复记录**：所属分公司名称从 `providers` 表关联 `users` 表获取
4. **会员管理**
   - 全局视图：所有会员列表（可按分公司/服务商筛选）
   - 分公司视图：仅显示该分公司下的会员
5. **订单管理**
   - 产品订单、流转订单、回购订单
   - 根据视图过滤显示
6. **能量值管理**
   - 全局能量值统计、分公司能量值分布（饼图）
   - 分公司视图：该分公司能量值详情
7. **收益管理**
   - 全局收益统计、各分公司收益占比
   - 收益明细列表
8. **额度管理**
   - 系统总额度、已分配、剩余
   - 分公司额度分配（自动赠送20%能量值）
9. **系统设置**
   - 收益配置、额度配置

### 3. 服务商管控后台 - `/admin/provider`
**需要登录验证（角色：provider）**
**功能模块（Tab切换）：**
- **总览**：会员数量、能量值余额、累计收益、下级服务商、收益规则说明
- **额度管理**：初始额度、当前额度、累计销售、补货申请
- **会员管理**：会员列表、等级状态、累计投资
- **购买审核**：会员购买申请审核、产品编号、费用明细、通过/拒绝操作
- **回购管理**：待回购产品（超时未售）、市场在售产品、回购操作、回购记录
- **担保审核**：会员间产品流转审核、确认线下转账
- **收益管理**：能量值充值（核心功能）、能量值分配比例、收益记录
- **升级分公司**：升级条件、质押金、权益说明

**关键规则**：
- 能量值充值：服务商线下收款后，在系统里给会员充值能量值
- 能量值分配：会员购买产品支付的能量值，服务商获得70%
- 产品回购：会员申请回购后上架市场，**48小时**无人购买则服务商回购
- 回购金额：仅返还本金

### 服务商收益来源

| 收益类型 | 来源 | 说明 |
|----------|------|------|
| 能量值收益 | 会员购买产品时支付的能量值 | 服务商获得能量值的70% |
| 能量值充值 | 给会员充值能量值 | 线下收款，线上充值 |
| 下级分成 | 培养服务商 | 1个0.3%，≥3个0.5% |

**能量值流转规则**：
- 购买产品时：会员支付本金 + **必须预扣能量值**（没有足够能量值无法购买）
- 产品到期卖出时：直接获得本金 + 实际收益（能量值已预先扣除）
- 能量值来源：找服务商充值（服务商线下收款，线上给会员充值）
- 能量值互转/提现门槛：50

### 4. 会员端 - `/member`
**需要登录验证（角色：member）**
**功能模块（Tab切换）：**
- **购买产品**：产品列表、产品周期选择、购买申请（支付本金 + 能量值市场费）
- **我的持仓**：持有中的产品、收益进度、到期预警、卖出变现
- **能量值记录**：充值记录、转入记录、转出记录、明细筛选、统计汇总
- **能量值记录**：充值记录、转入记录、转出记录、明细筛选、统计汇总
- **消息通知**：系统消息、交易通知
- **邀请新用户**：邀请码展示、复制邀请码、复制邀请链接、分享邀请、直推统计、邀请奖励规则
- **申请服务商**：准入条件、技术服务费、权益说明

**能量值记录功能详情**：
- 统计卡片：累计充值、累计转入、累计转出
- 筛选功能：全部/充值/转入/转出
- 明细列表：类型图标、金额、状态、时间
- 记录类型：recharge(充值)、transfer_in(转入)、transfer_out(转出)

**邀请新用户功能详情**：
- 展示会员专属邀请码（MEMB格式）
- 一键复制邀请码到剪贴板
- 生成并复制邀请链接
- 支持分享到微信
- 直推统计：直推人数、直推投资额、累计奖励
- 邀请奖励规则说明

**关键规则**：
- 购买产品：只付本金，不需要能量值
- 产品到期卖出：必须有足够能量值才能卖出
- 能量值来源：找服务商充值（线下转账给服务商，服务商线上充值）
- 能量值互转/提现门槛：50
- 产品到期预警：3天内到期显示预警
- 回购流程：申请回购 → 市场流通7天 → 无人购买 → 服务商回购 → 返还本金
- 邀请码格式：会员 `MEMB + 6位数字`

## 组件库说明
项目使用 shadcn/ui 组件库，已安装组件包括：
- Card, Button, Badge, Tabs
- Input, Table, Dialog
- Chart (基于 Recharts)
- 等 60+ 组件

## 开发指南

### 本地开发
```bash
# 开发模式（已自动启动）
pnpm run dev

# 构建生产版本
pnpm run build

# 启动生产服务
pnpm run start
```

### 代码规范
- 使用 TypeScript 严格模式
- 组件使用 'use client' 标记客户端组件
- 使用 shadcn/ui 组件保持UI一致性
- 图表使用 Recharts 组件

### 样式规范
- 使用 Tailwind CSS 类名
- 深色主题（slate-900 背景）
- 渐变色彩系统：
  - 蓝青渐变：总公司
  - 紫粉渐变：服务商
  - 绿色渐变：会员端

## 数据模拟
当前所有页面使用模拟数据，包括：
- 收入趋势数据
- 服务商分布数据
- 会员列表数据
- 算力包数据
- 交易记录数据

## 未来扩展建议

### 后端API对接
1. 创建 `/src/app/api/` 目录
2. 实现数据接口：
   - `/api/admin/platform/stats` - 平台统计数据
   - `/api/admin/provider/members` - 会员列表
   - `/api/member/packages` - 我的算力包
   - `/api/member/transactions` - 交易记录

### 功能增强
1. **实时数据推送**
   - WebSocket 连接
   - 算力使用实时监控
   - 交易状态实时更新

2. **用户认证**
   - 登录/注册系统
   - 权限管理
   - Token 验证

3. **数据导出**
   - Excel 导出
   - PDF 报表
   - 数据可视化下载

4. **高级筛选**
   - 日期范围选择
   - 多条件组合筛选
   - 数据排序

## 浏览器兼容性
- Chrome 60+
- Firefox 55+
- Safari 11+
- Edge 79+

## 分公司数据接口

### GET /api/branch/providers
获取分公司下的服务商列表

**查询参数：**
- `branchId`: 分公司ID（必填）

**返回示例：**
```json
{
  "success": true,
  "data": {
    "providers": [
      {
        "id": "服务商ID",
        "username": "用户名",
        "realName": "真实姓名",
        "phone": "手机号",
        "energyValue": 5000,
        "balance": 0,
        "quotaAmount": 50000,
        "usedAmount": 30000,
        "availableAmount": 20000
      }
    ],
    "stats": {
      "totalProviders": 5,
      "pendingApplications": 2,
      "totalSales": 500000
    }
  }
}
```

### GET /api/branch/members
获取分公司下的会员列表

**查询参数：**
- `branchId`: 分公司ID（必填）
- `providerId`: 服务商ID（可选，用于筛选）
- `page`: 页码（默认1）
- `pageSize`: 每页数量（默认20）

**返回示例：**
```json
{
  "success": true,
  "data": {
    "members": [
      {
        "id": "会员ID",
        "username": "用户名",
        "realName": "真实姓名",
        "phone": "手机号",
        "energyValue": 1000,
        "balance": 0,
        "providerName": "服务商名称",
        "totalInvestment": 50000,
        "holdingProducts": 2
      }
    ],
    "stats": {
      "totalMembers": 50,
      "activeMembers": 35
    },
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 50,
      "totalPages": 3
    }
  }
}
```

## 维护说明
1. 定期更新依赖包
2. 检查 TypeScript 类型
3. 优化图表性能
4. 监控页面加载速度

## 相关文档
- 产品需求文档（PRD）
- UI/UX 设计稿
- API 接口文档
- 数据库设计文档

---

## 关键规则（必须遵守）

### 1. 数据库连接 - 绝对禁止使用 Coze 内置数据库

**只使用用户自己的 Supabase 数据库**：`swowspzwukyayyyhzmrj.supabase.co`

- 代码中所有数据库连接只读 `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`
- **绝对禁止**回退到 `COZE_SUPABASE_URL`（那是 Coze 平台内置数据库，不是用户的）
- `exec_sql` 工具连接的是 Coze 内置数据库，**禁止用于数据操作**
- 数据查询和修改只能通过 REST API（`createClient` + 用户 Supabase URL/KEY）

### 2. 市场费分配是收益（balance），不是能量值（energy_value）

会员购买产品时用**能量值**支付市场费，但分配给各角色后变为**收益**：
- 服务商 70% → `balance`（不是 energy_value）
- 直推人 10% → `balance`
- 上级服务商 10% → `balance`
- 分公司 5% → `balance`
- 总公司 5% → `balance`
- 市场费分配**不写入 energy_transactions**（那不是能量值流转）

### 3. 产品费率从数据库读取，禁止硬编码

- 能量值扣费比例：从产品记录的 `market_rate` 字段读取
- 收益比例：从产品记录的 `profit_rate` 字段读取
- 持仓时间锁：`period * 24` 小时（1天=24h, 3天=72h, 7天=168h）
- **禁止**在代码中硬编码 `period → rate` 映射表

### 4. Supabase REST API update() 可能静默失败

`client.from('users').update({energy_value: ...})` 可能返回 204 但不实际写入数据。
- 所有关键数据更新（energy_value, balance, points 等）必须用 `execute(SQL)` 直接 SQL 执行
- `addEnergy` / `deductEnergy` 函数已改为 `execute(SQL)` 实现

### 5. 用户ID在不同数据库中不同

同一用户在 Coze 数据库和用户 Supabase 数据库中的 ID 不同。例如：
- 小熊饼干：Coze DB `bb614e8e-...`，用户 DB `00000000-0000-0000-0000-000000000101`
- 所有业务操作必须用用户 Supabase 数据库中的 ID

### 6. 历史修复记录

| 问题 | 修复 |
|------|------|
| 购买1天产品能量值按5%扣（硬编码） | 改为读取产品 market_rate（1.4%） |
| 1天产品时间锁72小时 | 改为 period*24（1天=24小时） |
| 市场费分配写入 energy_value | 改为写入 balance（收益） |
| 卖出/审核卖出的市场费也写入 energy_value | 同上改为 balance |
| 能量值统计/展示中混入市场分润类型 | 移除，市场分润归入收益 |
| 7笔已完成订单缺少 provider_revenue_distribution | 补写7条分配记录 |
| COZE_SUPABASE 回退逻辑 | 完全移除，只连用户数据库 |
| Supabase REST API update 静默失败 | 改为 execute(SQL) 直接执行 |
| 批量下架触发上架功能 | POST + action 参数替代 PUT |
| exec_sql 工具连的是 Coze 数据库 | 数据操作只用 REST API 连用户数据库 |
