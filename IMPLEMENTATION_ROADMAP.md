# 纪元智科 - 实施路线图

## 当前状态

### ✅ 已完成
1. **前端页面** - 三个后台管理界面（总公司、服务商、会员端）
2. **UI组件** - shadcn/ui 组件库集成
3. **数据可视化** - Recharts 图表展示
4. **模拟数据** - 页面展示用假数据

### ❌ 待完成
目前系统只是"展示壳子"，没有真实数据和业务逻辑

---

## 第一阶段：核心后端开发（必做）

### 1. 数据库设计与实现
**预计工作量**: 3-5天

#### 数据表设计
```
用户表 (users)
├── id, username, password_hash, phone, email
├── user_type (platform_admin, provider, member)
├── provider_id (服务商ID，会员关联)
├── status, created_at, updated_at

服务商表 (providers)
├── id, name, contact_person, contact_phone
├── region, status, commission_rate
├── total_members, total_revenue
├── created_at, updated_at

算力包表 (power_packages)
├── id, name, gpu_type, power_amount
├── price, validity_days, status
├── created_at, updated_at

用户算力包表 (user_packages)
├── id, user_id, package_id
├── total_power, used_power, remain_power
├── expire_at, status, created_at

流转交易表 (transfers)
├── id, seller_id, buyer_id, package_id
├── power_amount, price, fee
├── status, created_at, completed_at

交易记录表 (transactions)
├── id, user_id, type (purchase/transfer/use)
├── amount, balance_before, balance_after
├── description, created_at
```

#### 技术选型
- **数据库**: PostgreSQL (推荐) / MySQL
- **ORM**: Prisma / Drizzle (已集成)
- **迁移工具**: Prisma Migrate / Drizzle Kit

### 2. 后端API开发
**预计工作量**: 5-7天

#### 必需API接口
```
认证相关
├── POST /api/auth/register      # 注册
├── POST /api/auth/login         # 登录
├── POST /api/auth/logout        # 登出
├── GET  /api/auth/me            # 当前用户信息

算力包相关
├── GET  /api/packages           # 算力包列表（商城）
├── POST /api/packages/purchase  # 购买算力包
├── GET  /api/packages/my        # 我的算力包
├── POST /api/packages/use       # 使用算力

流转交易相关
├── GET  /api/transfers          # 流转市场列表
├── POST /api/transfers/publish  # 发布转让
├── POST /api/transfers/buy      # 购买转让包
├── GET  /api/transfers/my       # 我的转让记录

服务商管理（服务商端）
├── GET  /api/provider/members   # 旗下会员列表
├── GET  /api/provider/stats     # 服务商统计数据
├── GET  /api/provider/transfers # 转让记录

平台管理（总公司端）
├── GET  /api/admin/providers    # 服务商列表
├── POST /api/admin/providers/create
├── GET  /api/admin/stats        # 平台统计
├── GET  /api/admin/alerts       # 系统告警
```

### 3. 用户认证系统
**预计工作量**: 2-3天

- JWT Token 认证
- 密码加密存储 (bcrypt)
- 登录状态管理
- 权限控制中间件
- 手机号/邮箱验证（可选）

---

## 第二阶段：支付与结算（重要）

### 4. 支付集成
**预计工作量**: 3-4天

#### 支付渠道
- 微信支付（小程序/H5）
- 支付宝
- 银联支付（企业用户）

#### 需要开发
- 支付订单创建
- 支付回调处理
- 退款处理
- 充值/提现

### 5. 财务结算系统
**预计工作量**: 2-3天

- 用户钱包系统
- 佣金计算与发放
- 提现申请与审核
- 财务报表生成

---

## 第三阶段：核心业务功能

### 6. 算力资源对接
**预计工作量**: 5-7天

#### 算力供应商选择
- 阿里云 PAI
- 腾讯云 TI
- AWS / Azure
- 自建GPU集群

#### 需要开发
- 算力调度接口
- 任务队列管理
- 算力使用监控
- 资源计费系统

### 7. 流转交易系统
**预计工作量**: 3-4天

- 转让定价规则
- 交易撮合逻辑
- 手续费计算
- 交易确认流程
- 纠纷处理机制

### 8. 推广裂变系统
**预计工作量**: 2-3天

- 推广码生成
- 邀请关系绑定
- 多级佣金计算
- 推广任务系统
- 排行榜

---

## 第四阶段：风控与合规

### 9. 交易风控系统
**预计工作量**: 3-4天

- 实名认证（对接第三方）
- 交易异常检测
- 大额交易审核
- 防刷单机制
- 反洗钱监测

### 10. 消息通知系统
**预计工作量**: 2-3天

- 站内消息
- 短信通知（阿里云/腾讯云短信）
- 邮件通知
- 微信服务号模板消息
- APP推送

---

## 第五阶段：部署与运维

### 11. 服务器部署
**预计工作量**: 2-3天

#### 服务器需求
- **Web服务器**: 2核4G 起步
- **数据库**: 云数据库 RDS
- **缓存**: Redis
- **对象存储**: OSS/S3（图片、文件）
- **CDN**: 静态资源加速

#### 部署方案
- Docker 容器化部署
- Nginx 反向代理
- HTTPS 证书配置
- 域名备案（国内必需）

### 12. 监控与运维
**预计工作量**: 1-2天

- 日志收集（ELK）
- 性能监控
- 告警通知
- 自动备份

---

## 技术栈推荐

### 后端
```
运行时: Node.js 18+ / Python 3.10+
框架: Express / Fastify / NestJS / FastAPI
数据库: PostgreSQL
缓存: Redis
消息队列: RabbitMQ / Redis Queue
```

### 前端（已完成）
```
框架: Next.js 16
UI: shadcn/ui + Tailwind CSS
图表: Recharts
```

### 第三方服务
```
支付: 微信支付 / 支付宝
短信: 阿里云短信 / 腾讯云短信
实名: 阿里云实人认证
算力: 阿里云PAI / 腾讯云TI
存储: 阿里云OSS / 腾讯云COS
```

---

## 开发优先级

### 🔴 必须先做（第一优先）
1. 数据库设计
2. 用户认证系统
3. 基础API接口
4. 算力包购买功能

### 🟡 其次做（第二优先）
5. 支付集成
6. 流转交易功能
7. 服务商管理

### 🟢 可以后做（第三优先）
8. 推广裂变系统
9. 消息通知
10. 高级风控

---

## 预估总工作量

| 阶段 | 工作量 | 说明 |
|------|--------|------|
| 核心后端 | 10-15天 | 数据库+API+认证 |
| 支付结算 | 5-7天 | 支付+钱包 |
| 核心业务 | 10-14天 | 算力+流转+推广 |
| 风控合规 | 5-7天 | 风控+通知 |
| 部署运维 | 3-5天 | 上线部署 |
| **总计** | **33-48天** | 约1.5-2个月 |

---

## 最小可行产品 (MVP) 方案

如果资源有限，可以先做 MVP 版本：

### MVP 核心功能
1. 用户注册登录
2. 算力包购买（模拟算力）
3. 基础流转交易
4. 服务商管理

### MVP 技术简化
- 不对接真实算力（模拟算力消耗）
- 暂不接支付（后台充值）
- 基础风控即可

### MVP 工作量
- **后端**: 7-10天
- **部署**: 2天
- **总计**: 约2周

---

## 下一步建议

1. **确定技术方案**: 选择后端语言和数据库
2. **设计数据库**: 画出完整的ER图
3. **开发认证系统**: 用户登录注册
4. **开发核心API**: 算力包CRUD
5. **前后端联调**: 替换模拟数据

需要我帮您开始实现哪个部分？
