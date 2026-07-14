# 湘泰内部管理系统 — 开发指南

## 项目概览

这是一套面向泰国/中国跨境企业服务公司的内部管理系统，覆盖 9 条业务线的订单全流程管理（公司注册/商标/FDA认证/TISI/DLD/清关/地址认证/Mall开店/NBTC），另含达人代运营（agency/influencers/factories/contracts/discovery-tasks）、内部管理（考勤/补卡/请假/工单/通知/周报）等模块。

**时区约定**：数据库时间戳统一存 UTC；"哪一天"（考勤日期等）按曼谷时区（UTC+7）计算，工具函数在 `src/lib/time.ts`。前端展示用 `toThaiTime()`（utils.ts）。

**安全约定**：所有 API 路由（除 /api/auth/login 和 /api/external/*）必须先 `verifyAuth`；动态 UPDATE 的字段名必须走 db.ts 里的 `*_UPDATABLE_FIELDS` 白名单；审计日志操作人用 `auth.name`，不信任请求体。

- **技术栈**: Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 + shadcn/ui (@base-ui/react)
- **数据库**: SQLite (better-sqlite3)，文件 `data.db`，已在 `.gitignore`
- **色彩系统**: OKLCH 色域，CSS 自定义属性定义在 `src/app/globals.css`，支持浅色/深色模式切换
- **注册类型**: product（产品型应用，设计服务于功能）

## 启动与开发

```bash
npm install
npm run dev        # 开发模式 → http://localhost:3002
npm run build      # 生产构建
npm run start      # 生产启动
```

首次启动会自动创建 `data.db` 并初始化种子数据。要重置数据库，删除 `data.db` 后重启。

## 项目结构

```
src/
├── app/
│   ├── layout.tsx              # 根布局（字体、ThemeProvider）
│   ├── globals.css             # 全局样式 + OKLCH 色板 + dark mode
│   ├── login/                  # 登录页（独立布局，无侧栏）
│   ├── (app)/                  # 仪表盘 + 8个业务线 + 订单/任务/文档/费用/设置
│   │   ├── page.tsx            # 仪表盘首页
│   │   ├── layout.tsx          # 带侧栏的布局壳
│   │   ├── company-registration/
│   │   ├── trademark/          # 含子页面 international, buy-r
│   │   ├── fda-certification/  # 含子页面 cosmetics, food, hazard, medical
│   │   ├── tisi/               # 含子页面 nbtc
│   │   ├── dld/                # 含子页面 site
│   │   ├── customs-clearance/
│   │   ├── address-certification/
│   │   ├── mall-store/         # 含子页面 tiktok, lazada
│   │   ├── orders/             # 订单列表 /new /[id]
│   │   ├── tasks/ documents/ finance/ settings/
│   └── api/                    # REST API 路由
├── components/
│   ├── sidebar.tsx             # 深色侧栏（三区：仪表盘/业务线/工具）
│   ├── theme-provider.tsx       # 主题 Context + localStorage
│   ├── theme-toggle.tsx         # 月亮/太阳切换按钮
│   ├── dashboard/              # 仪表盘组件
│   │   ├── business-chart.tsx   # 业务线柱状图（recharts，已动态导入）
│   │   ├── business-line-page.tsx  # 通用业务线页面（统计+订单列表+快捷入口）
│   │   ├── fda-sub-service-page.tsx # FDA 子服务页面（统计+费用标准）
│   │   ├── stat-card.tsx
│   │   └── todo-list.tsx
│   └── ui/                     # shadcn/ui 基础组件
├── lib/
│   ├── db.ts                   # SQLite 初始化 + 表定义 + 种子数据 + 步骤模板
│   ├── constants.ts            # 业务配置（步骤文档需求、时间估算、子服务列表、价格）
│   ├── api.ts                  # 前端 API 调用函数 + TypeScript 类型定义
│   └── utils.ts                # cn() 工具函数
└── mock/                       # 旧 mock 数据（已废弃，保留参考，实际从 API 拉）
```

## 数据库设计

### 表结构

| 表 | 用途 | 关键字段 |
|---|---|---|
| `employees` | 员工列表 | id, name |
| `business_types` | 业务线类型 | id, name（公司注册/商标/FDA认证/TISI/DLD/清关/地址认证/Mall开店）|
| `orders` | 订单 | id(PK), customer_name, business_type_id(FK), sub_service_type, address_type, monthly_rent, status, responsible_person, total_amount |
| `order_steps` | 订单步骤 | id(PK), order_id(FK), step_name, step_order, status, assignee, approval_status, submission_count, deadline, logistics_status, step_data(JSON) |
| `documents` | 订单文档 | id(PK), order_id(FK), name, file_type, status(待审核/已审核/已驳回) |
| `finances` | 费用记录 | id(PK), order_id(FK), type(income/expense), amount, status(pending/paid/cancelled) |
| `certificates` | 证书 | id(PK), order_id(FK), certificate_number, issue_date, expiry_date, status(valid/expiring/expired), nsw_registration, nsw_download_status |
| `step_notes` | 步骤备注 | id(PK), step_id(FK), order_id(FK), content, created_by |
| `step_documents` | 步骤所需文件 | id(PK), step_id(FK), order_id(FK), document_name, status(uploaded/pending) |

### 关键设计决策

1. **订单创建自动生成步骤和文件清单**: `POST /api/orders` 根据 `business_type_id` + `sub_service_type` + `address_type` 通过 `getOrderStepsWithDocs()` 自动生成步骤、负责人和每步的 `step_documents` 所需文件清单
2. **步骤 JSON 字段**: `order_steps.step_data` 存储灵活的 JSON 数据（物流追踪、外部联系人、外部确认等）
3. **地址认证特殊处理**: `address_type` 为 `xiangtai` 时，自动插入"签订租赁合同"和"收取首月租金"两个额外步骤
4. **子服务路由**: 相同 business_type_id 的不同子服务通过 `sub_service_type` 字段区分，步骤模板在 `getBusinessSteps()` 中按 sub_service_type 分发

## API 路由总览

### 基础
```
GET  /api/business-types          → 业务线列表
GET  /api/employees               → 员工列表
GET  /api/dashboard/stats         → 仪表盘统计（总数/进行中/已完成/待办）
```

### 订单
```
GET    /api/orders                → 订单列表（?business_type_id=&status=）
POST   /api/orders                → 创建订单（自动生成步骤）
GET    /api/orders/:id            → 订单详情（含步骤）
PATCH  /api/orders/:id/steps      → 更新步骤状态（支持 approval_status, submission_count）
```

### 文档 & 费用
```
GET    /api/orders/:id/documents  → 订单文档列表
POST   /api/orders/:id/documents  → 新增文档记录
GET    /api/orders/:id/finances   → 订单费用列表
POST   /api/orders/:id/finances   → 新增费用记录
```

### 步骤备注 & 文件清单
```
GET    /api/orders/:id/steps/:stepId/notes     → 步骤备注列表
POST   /api/orders/:id/steps/:stepId/notes     → 添加备注
GET    /api/orders/:id/steps/:stepId/documents → 步骤所需文件
POST   ../documents/mark-uploaded              → 标记已上传
```

### 证书
```
GET    /api/orders/:id/certificates → 证书列表
POST   /api/orders/:id/certificates → 新增证书
```

## 业务线配置模式

每个业务线的配置分散在两个文件中：

**`src/lib/constants.ts`** — 静态配置
- `xxxDocs`: 每个步骤需要的文件清单（`Record<stepOrder, string[]>`）
- `xxxTimes`: 每个步骤的预估时间
- `xxxSubServices`: 子服务列表（key + label）

**`src/lib/db.ts`** — 运行时逻辑
- `businessSteps[btId]`: 默认步骤模板（`{ name, assignee }[]`）
- `getBusinessSteps(btId, subServiceType?)`: 根据子服务返回对应步骤模板
- `getStepsWithAddressType(btId, subServiceType?, addressType?)`: 地址认证特殊处理

**新增业务线步骤**：
1. 在 `constants.ts` 添加文档和时间配置
2. 在 `db.ts` 的 `businessSteps` 对象添加默认步骤
3. 在 `getBusinessSteps()` 添加子服务分支
4. 更新 `stepRequiredDocs`、`stepTimeEstimates` 的映射表
5. 更新 `subServices` 映射表

## 前端页面模式

### 业务线页面（带子服务）
```
/trademark         → 选项卡切换 TM标/国际/购买R标，通过 Link 跳转子页面
/trademark/international → 独立页面，filter by sub_service_type
```

### 通用组件
- **`BusinessLinePage`**: 统计卡片 + 订单表格 + 快捷入口（`/orders/new` + `/documents` + `/tasks`）。接受 `businessKey`（匹配 DB 中的 business_types.name）
- **`FdaSubServicePage`**: FDA 专用，增加费用标准展示。接受 `subServiceType` 进行筛选

### 组件约定
- 所有颜色通过 `var(--xxx)` 引用 CSS 自定义属性（**不要硬编码颜色**）
- 表格使用 raw `<table>` + `overflow-x-auto` 容器（不用 shadcn Table 组件）
- 按钮使用 shadcn `<Button size="sm">`（≥36px），图标按钮 `size="icon-sm"`（≥44px）
- 移动端：`max-md:hidden` 隐藏次要列，`md:pl-16 lg:pl-60` 侧栏适配

## 主题系统

- 浅色/深色变量定义在 `globals.css` 的 `:root` 和 `.dark` 块
- `ThemeProvider` 通过 `localStorage("theme")` 持久化 + `document.documentElement.classList.toggle("dark")`
- `ThemeToggle` 组件放在侧栏底部用户区域
- 侧栏**始终深色**，不受主题切换影响（使用独立的 `--sidebar-*` 变量）

## 开发注意事项

1. **数据库初始化**: 首次调用 `getDb()` 时自动建表 + 插种子。`initTables()` 检查 COUNT，只在空表时插数据
2. **步骤 ID vs 步骤序号**: `order_steps.id` 是数据库主键，`step_order` 是 1-based 序号。API 路由用 `stepId`（数据库 ID），前端调用 `fetchStepNotes(orderId, step.id)` 传入的是数据库 ID
3. **重新 seed**: 删除 `data.db` 重启即可。注意 `data.db` 在 `.gitignore` 中
4. **Turbopack 构建问题**: 某些修改后可能需 `rm -rf .next` 清理缓存
5. **`next/dynamic`**: 重组件（recharts）用动态导入，避免 SSR 问题
6. **TypeScript 类型**: `src/lib/api.ts` 定义了所有前端类型（Order, OrderStep, Document, Finance, Certificate 等），新增字段需同步更新
7. **中文文案**: 所有 UI 文案直接硬编码中文，无 i18n。语气偏口语化（"早上好，张三"、"把订单信息填好，别漏了"）
8. **深色模式**: 切换时内容区颜色变化，但侧栏保持深色不变
9. **端到端测试**: 当前所有按钮 `onClick` 仍是 `console.log` 占位符，需要后续实现真实业务逻辑
10. **子服务页面过滤**: 子服务页面（如 `/trademark/international`）从 API 拉全部该业务线的订单，前端 filter by `sub_service_type`。如果数据量大，应该加后端筛选参数

## 常用改法

- **加新业务线步骤**: 改 `constants.ts`（docs/times）+ `db.ts`（steps map + getBusinessSteps 分支）
- **改步骤负责人**: 改 `db.ts` 对应 business_type_id 的 `assignee` 值
- **改页面颜色**: 改 `globals.css` 对应 CSS 变量
- **加新 API**: 在 `src/app/api/` 下建目录 + `route.ts`（App Router 约定）
- **改侧栏导航**: 改 `src/components/sidebar.tsx` 的 `navigation` 数组
