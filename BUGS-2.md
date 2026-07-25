# 第二轮全量代码审查报告

**审查范围**：95 个 API 路由 + 48 个页面 + lib 层（约 3 万行）
**审查时间**：2026-07-25（对应 commit `c4438f6`）
**重点**：功能性 bug、API 与前端契约、业务流程通畅性
**说明**：第一轮报告见 `BUGS.md`，其中的问题已修复；本轮是针对当前代码（含今天新增的 vat / wht / customers / points / client-feedback 等模块）的重新审查。

---

> ## ✅ 22 项已于 2026-07-25 全部修复（P0 + P1 + P2）
>
> `tsc --noEmit` 零错误；P0 冒烟 7/7、P1 冒烟 7/7、迁移演练 6/6、P2 冒烟 8/8 全过。
> 50ทวิ 证书已实际生成 PDF 验证泰文渲染正确。详见文末三份修复记录。

## 🔴 P0 — 功能直接不可用 / 权限失守

### 1. 达人 CSV 批量导入必定失败（401）
`src/app/(app)/agency/influencers/[id]/page.tsx:533`

```ts
const res = await fetch("/api/influencers/evaluations/import", { method: "POST", body: fd });
```

全项目其他上传都走 `fetchWithAuth`，只有这里用裸 `fetch`，不带 `Authorization` 头。而该路由已要求登录 → **每次导入都返回 401「未登录」**，功能完全不可用。

**改法**：`fetch` → `fetchWithAuth`（FormData 不要手动设 Content-Type）。

---

### 2. 请假审批没有权限校验 —— 员工可自批请假
`src/app/api/leave/route.ts:47` PATCH

```ts
const auth = await verifyAuth(req);
if (!auth) return ...401;
// ❌ 没有 if (auth.role !== "admin") 检查
const { id, status, approved_by } = body;
```

任何登录员工都能把自己的请假申请直接 PATCH 成 `已通过`，且 `approved_by` 取自请求体（可伪造成任意人名）。对比同模块的 `attendance/request` PATCH 是有 admin 校验的，这里遗漏了。

**影响链**：请假审批通过 → `attendance/summary` 按 `leave_requests` 算请假天数、扣减缺勤 → 员工可自行消除缺勤记录 → 影响积分/奖惩。

**改法**：加 `if (auth.role !== "admin") return 403`；`approved_by` 用 `auth.name`。

---

### 3. VAT 客户评价链路是断的
`src/app/api/vat/records/[id]/feedback-token/route.ts` + `src/app/api/client-feedback/public/route.ts`

VAT 详情页生成评价链接时，把 **VAT 记录 id（整数 1、2、3）** 写进了 `feedback_tokens.order_id`：

```ts
db.prepare("INSERT INTO feedback_tokens (token, order_id) VALUES (?, ?)").run(token, id);  // id 是 vat_records.id
```

而公开问卷提交时按订单查：

```ts
const order = db.prepare("SELECT responsible_person FROM orders WHERE id = ?").get(orderId);  // "1" 查不到
const completers = db.prepare("SELECT DISTINCT assignee FROM order_steps WHERE order_id = ?")...  // 空
```

已核实：`feedback_tokens` 现有数据的 order_id 都是 `ORD-004` 这种格式，而 `vat_records.id` 是 1/2/3。结果是 **VAT 客户提交评价后：`client_feedback.responsible_person` 为空、participants 为空数组、一条积分都不写**。客户填了问卷，系统里等于什么都没发生。

**改法**：`feedback_tokens` 加 `ref_type`（'order' / 'vat'）字段，public 提交时按类型分别查 `orders` / `vat_records`（VAT 的参与人取 `vat_record_steps.assignee` + `vat_records.assignee`）。

---

### 4. 硬编码 cron 令牌，可完全绕过登录
`src/app/api/vat/records/generate/route.ts:49`、`src/app/api/wht/records/route.ts:104`

```ts
const isCron = req.headers.get("authorization") === "Bearer internal-cron";
if (!isCron) { /* 才校验登录 */ }
```

字符串写死在源码里（且已进 git 历史）。任何人带这个头就能批量生成/篡改 VAT、WHT 申报记录，完全跳过登录和 admin 校验。WHT 那条更宽松——正常路径只要求登录，cron 路径连登录都不要。

**改法**：改成读环境变量 `process.env.CRON_SECRET`，未配置时直接拒绝 cron 分支。

---

## 🟠 P1 — 数据错乱 / 越权

### 5. 客户评价可并发重复提交刷分
`src/app/api/client-feedback/public/route.ts`

```ts
if (tokenRow.submitted) return 409;              // 先检查
...
db.prepare("UPDATE feedback_tokens SET submitted = 1 ... AND submitted = 0").run(...)  // 后更新
// ❌ 没有检查 result.changes
db.prepare("INSERT INTO client_feedback ...").run(...)       // 无论如何都插
for (const name of participants) { INSERT INTO points_records ... }  // 积分照发
```

UPDATE 虽然带了 `AND submitted = 0`，但**没有判断 changes 是否为 0 就继续往下走**。两个并发请求都能通过前面的检查，UPDATE 只有一个生效，但两次插入和两次积分都会执行。该接口无需登录，可被脚本刷。

**改法**：`const r = ...run(); if (r.changes === 0) return 409;` 并把整段包进事务。

---

### 6. VAT「已停止」状态会被步骤同步逻辑复活
`src/app/api/vat/records/[id]/steps/route.ts:100`

客户停用时会把记录置为 `progress = '已停止'`（`vat/customers/route.ts:50`），但只要有人再更新该记录的任意步骤，同步逻辑就会把 progress 覆写成第一个未完成步骤的名字：

```ts
const activeStep = steps.find(s => s.status !== "已完成");
db.prepare("UPDATE vat_records SET progress = ? ...").run(activeStep.step_name, id);
```

已停止的记录被"复活"回进行中，重新出现在待办列表和催办通知里。（与第一轮修的订单状态机同类问题。）

**改法**：同步前先读 progress，若为 `已停止` 则跳过覆写。

---

### 7. influencers 表迁移会把 17 个字段整体错位
`src/lib/db.ts:57`

```ts
INSERT INTO influencers_new SELECT * FROM influencers;
```

`SELECT *` 依赖列顺序。已实测当前 `data.db`：

| 位置 | 现表 | 迁移目标表 |
|---|---|---|
| 5 | `code` | `contact_phone` |
| 6 | `contact_phone` | `line_id` |
| … | …（连续错位 17 列）… | … |
| 21 | `discovery_task_id` | `code` |

即达人编号会被写进电话字段、电话写进 LINE ID、一路错到底。好在**当前 DB 不会触发**（触发条件是 CHECK 里缺 `待提交` 或 `不签约`，现表两个都有），但这是颗雷：

- 触发条件写死了两个状态字符串，而不是比对 `INFLUENCER_STATUS_LIST` 全量 → **以后再往列表里加状态，迁移根本不会触发**，新状态会被旧 CHECK 拒绝，接口直接 500；
- 一旦哪天触发了，要么因 CHECK 冲突迁移失败（静默 catch 掉，只在控制台留一行错），要么静默写错数据。

**改法**：显式列名 `INSERT INTO influencers_new (col1, col2, ...) SELECT col1, col2, ... FROM influencers`；触发条件改成比对完整状态列表。

---

### 8. 通知可越权读取他人内容
`src/app/api/notifications/route.ts:10`

```ts
const recipient = searchParams.get("recipient");
if (recipient) { sql += " AND (recipient = ? OR recipient = '')"; params.push(recipient); }
```

`recipient` 完全来自查询参数，不校验是否等于当前登录人。任何员工 `GET /api/notifications?recipient=张三` 就能读老板的全部通知——里面有 VAT 对账明细、请假理由、工单内容。PATCH 的 `markAll + recipient` 同理，可把别人的通知标记已读。

**改法**：非 admin 强制 `recipient = auth.name`。

---

### 9. 请假可冒名提交
`src/app/api/leave/route.ts:32`

`employee_name` 取自请求体，任何人可以替别人提交请假申请。（第一轮已修 attendance 和补卡，leave 这条是新增模块，同样问题。）

**改法**：`auth.role === "admin" && body.employee_name ? body.employee_name : auth.name`。

---

### 10. 删除 VAT/WHT 客户：全局关外键 + 归档记录变孤儿
`src/app/api/vat/customers/route.ts:95`、`src/app/api/wht/customers/route.ts:164`

```ts
db.pragma("foreign_keys = OFF");
db.prepare("DELETE FROM vat_customers WHERE id = ?").run(id);
db.pragma("foreign_keys = ON");
```

两个问题：

1. `db` 是**全局单例连接**，pragma 是连接级的。Next.js 并发处理请求，这几毫秒内其他所有请求的外键约束都失效；如果 DELETE 抛异常，外键会**永久保持关闭**直到进程重启。
2. 注释说"归档记录保留用于历史查询"，但列表查询用的是 `JOIN vat_customers`（INNER JOIN）—— 客户没了，归档记录在任何列表里都查不到了，等于静默丢失。

另外这个删除接口**没有 admin 校验**（`/api/customers` 的删除是有的），任何员工可删客户及其未归档申报记录。

**改法**：改用事务 + 软删除（`status='已删除'`），或至少给客户表加删除标记而不是物理删除；补 admin 校验。

---

### 11. 积分统计的月份边界按 UTC 切，不是曼谷日历
`src/app/api/internal/points/route.ts:25-31`

```ts
dateFrom = `${month}-01`;
dateTo = `${month}-${lastDay} 23:59:59`;
// 与 points_records.created_at（UTC）直接字符串比较
```

`created_at` 存 UTC，边界却按曼谷日历的月份写。结果：曼谷 1 号 00:00–07:00 产生的积分算进上个月，上月末 17:00 之后的积分算进下个月。项目里已经有 `bangkokMonthRange()` 就是干这个的，这里没用上。季度榜、周报（`internal/weekly-report`）、达人看板（`agency/dashboard`）都是同样写法。

---

### 12. VAT/WHT 默认月份用 UTC
`vat/notify/route.ts:12,122`、`vat/dashboard/route.ts:11`、`wht/stats/route.ts:10`

```ts
const month = ... || new Date().toISOString().slice(0, 7);
```

每月 1 号曼谷早上 7 点前打开页面，看到的是上个月的数据。应改用 `bangkokMonthKey()`。

---

### 13. 客户状态自动流转：在 GET 里写库，且规则会连锁跳级
`src/app/api/customers/route.ts:12-38, 141`

`applyAutoFlow()` 在**每次列表 GET 时执行 UPDATE**，且三条规则顺序执行：

```
规则1: 跟进中 + 有过订单           → 已合作
规则3: 已合作 + 近3个月无新订单     → 沉睡
```

一个"跟进中"、但订单是半年前的客户，**同一次请求内**会被规则1 改成"已合作"、紧接着被规则3 改成"沉睡"——销售刚认领就看到客户变沉睡。另外这套规则每次列表刷新都跑一遍，**会覆盖管理员手动改的状态**（手动改回"跟进中"，下次刷新又被打回去）。

匹配还是靠 `customers.company_name = orders.customer_name` 字符串相等，公司名有一个字不一样就关联不上。

**改法**：自动流转移到定时任务或显式触发；规则之间加互斥；加 `manual_status_locked` 标记保护手动修改。

---

## 🟡 P2 — 体验 / 一致性问题

### 14. WHT 50ทวิ 证书 PDF：泰文会渲染成乱码
`src/app/api/wht/records/[id]/certificate/route.ts`

整份 PDF 用 `Helvetica` 输出泰文（`หนังสือรับรองการหักภาษี ณ ที่จ่าย` 等）。**Helvetica 不含泰文字形**，pdfkit 会输出空白或乱码方块——这份要交给税局/收款方的证明基本不可用。

同一文件另外两处：
- 税率写死 `const taxRate = 3;`，实际 WHT 有 1/2/3/5/10% 多档，且 `taxAmount = amount × 3%` 的算法假设 `amount` 是收入额——但 VAT/WHT 模块里 `amount` 语义看起来是税额，数字可能整个是错的；
- `Content-Disposition: filename="50tawi-${公司名}-..."`，公司名含中文/泰文时非 ASCII 直接进 filename，部分浏览器会下载失败或文件名乱码（应改 `filename*=UTF-8''`）。

**改法**：`doc.registerFont()` 嵌入 Sarabun / Noto Sans Thai；税率做成字段；文件名用 RFC 5987 编码。

### 15. WHT 列表把停用客户的历史记录整个藏起来
`src/app/api/wht/records/route.ts:52` — `where` 初始值硬编码 `c.status = '启用'`。客户一旦停用，他过去所有申报记录在列表里立刻消失，无法查历史。VAT 列表没有这个限制，两边行为不一致。应改成可选筛选项。

### 16. VAT 费用金额为 0 被拒
`src/app/api/vat/records/[id]/finances/route.ts:29` — `if (!description?.trim() || !amount)`，`amount: 0` 被判为空。（第一轮在订单费用里修过同样的写法。）另外 `type` 不校验 income/expense。

### 17. VAT/WHT 模块基本没有 client 角色拦截
VAT 17 个路由只有 4 个、WHT 13 个只有 2 个带 `role === "client"` 检查。客户账号登录后可以改 VAT 申报步骤、加删费用记录。（第一轮给订单模块补齐了，新模块没跟上。）

### 18. 工作签证 / 社保开户页面标题重复
`src/app/(app)/work-visa/page.tsx`、`social-security/page.tsx` 自己渲染了一遍 h1 + 描述，`BusinessLinePage` 内部又渲染一遍 `label` + `description` —— 页面上出现两个标题、两段描述。

### 19. 批量暂停不限定原状态
`src/app/api/vat/records/batch/route.ts` 的 `pause` 分支注释写"启用 → 暂停"，SQL 没有 `WHERE status = '启用'`，会把已停用/已终止的客户也一并改写。

### 20. VAT 记录改金额后对账表不同步
`vat/records/[id]/steps/route.ts` 只在「步骤2 标记完成」的那一刻把 `amount` 写进 `vat_reconciliation`。用户先完成步骤2、之后再通过 `PATCH /api/vat/records/[id]` 改金额，对账表停留在旧值，报表对不上。步骤5 的 `tax_paid = record.amount` 同理，且固定全额、不支持部分付款。

### 21. 未知 subtype 会创建出"僵尸"WHT 记录
`wht/records/route.ts` 创建记录时不校验 `subtype` 是否在 `WHT_STEPS` 里。传个不认识的类型 → `seedRecordSteps` 静默生成 0 个步骤 → 记录永远推进不了，也没有任何报错。VAT 侧 subtype/月份格式同样没校验。

### 22. 删除类接口的 admin 校验不一致
25 个带 DELETE 的路由里，只有少数几个校验 admin。达人、工厂、合同、VAT/WHT 客户这些主数据，任何登录员工都能删且不可恢复；而普通员工、订单反而有校验。建议统一：主数据删除限 admin，或全部改软删除。

---

## 复核说明

以下结论是**实际查库/查代码验证过**的，不是推测：

- 第 3 条：查了 `feedback_tokens` 现有 4 条数据，order_id 均为 `ORD-xxx` 格式；`vat_records.id` 为 1/2/3。
- 第 7 条：用 `PRAGMA table_info(influencers)` 比对了现表与迁移目标表列序，逐列列出了 17 处错位；并确认当前 CHECK 已含两个状态、迁移暂不会触发。
- 第 1 条：全项目 grep 了 `/api/upload` 与各上传调用，确认只有 CSV 导入这一处用裸 `fetch`。
- 第 11/12 条：grep 了全部 `new Date().toISOString()` 的日期用法，逐个对照 `lib/time.ts` 已有的曼谷时区函数。

## 建议修复顺序

1. **今天就修**：#1（导入功能全坏）、#2（自批请假）、#4（cron 令牌）、#8（通知越权）
2. **本周**：#3（VAT 评价链路）、#5（刷分）、#6（状态复活）、#9（冒名请假）、#10（外键 + 孤儿数据）
3. **排期**：#7（迁移改显式列名，改之前先备份 data.db）、#13（自动流转重构）、#14（泰文字体）
4. **顺手**：#11/#12（统一走 lib/time）、#16/#17/#19/#21（校验补齐）、#18（重复标题）

---

# P0 修复记录（2026-07-25）

| # | 问题 | 改动 |
|---|---|---|
| 1 | CSV 导入 401 | `agency/influencers/[id]/page.tsx` 裸 `fetch` → `fetchWithAuth`；顺带给 `res.json()` 加了 catch 兜底 |
| 2 | 请假审批越权 | `api/leave/route.ts`：PATCH 加 `role !== "admin"` → 403；`approved_by` 改用 `auth.name`（请求体的值一律忽略）；status 白名单校验；记录不存在返回 404；补传附件限本人或管理员 |
| 3 | VAT 评价链路断裂 | `feedback_tokens` / `client_feedback` 加 `ref_type` 列（迁移已自动生效）；VAT 的 ref 存为 `VAT-{id}` 前缀；`client-feedback/public` 按 ref_type 分流解析参与人；公开问卷页对 VAT 显示「VAT申报 #n」 |
| 4 | 硬编码 cron 令牌 | 新增 `src/lib/cron-auth.ts`（读 `CRON_SECRET`，等时比较，未配置则 cron 分支直接不可用）；vat/wht 两个路由改用它；两个 cron 脚本改读环境变量并在缺失时中止；新增 `.env.example`；`.gitignore` 加 `!.env.example` |

顺带修的（同一处代码路径，不改会留隐患）：

- **#5 并发重复提交刷分**：`client-feedback/public` 整段包进事务，以 `UPDATE ... AND submitted = 0` 的 `changes` 作为唯一判据，重复提交返回 409。
- **#9 请假可冒名**：`leave` POST 的 `employee_name` 改为取登录态（管理员可代提），并校验结束日期不早于开始日期。
- **构建阻断的类型错误**：`agency/page.tsx:235` 的 `staffList.map((s: { id: string; ... }))` 与实际 `id: number` 冲突，导致 `tsc` / `next build` 直接失败。这是并行开发那边今天新引入的，已删掉多余的类型标注改为推导。

## ⚠️ 部署前必做

1. **配置 `CRON_SECRET`**：不配的话每月 1 号的 VAT / WHT 自动生成脚本会失败退出（这是有意设计，避免静默不执行）。生成：`openssl rand -hex 32`，容器与 cron 脚本两侧要一致，参考 `.env.example`。
2. 顺便确认 `JWT_SECRET` 已配置（生产环境未配置会拒绝启动）。

## 验证方式

- `npx tsc --noEmit` → 0 error
- 冒烟测试（复制 data.db 后在副本上跑，未动生产数据）：VAT token 前缀与 ref_type、VAT ref 可解析回申报记录并取出参与人（实测 `VAT-16「湘泰 2026-07」→ ['Eve']`）、旧逻辑查 orders 确实为空的对照、存量订单 token 回归正常、重复提交 changes=0 → 7/7 通过。
- 沙箱跑不了 `next build`（SWC 二进制是 macOS 的），请在本地再跑一次确认。


---

# P1 修复记录（2026-07-25）

改动前已备份数据库到 `backups/data_before_p1_20260725_211929.db`。

| # | 问题 | 改动 |
|---|---|---|
| 6 | VAT「已停止」被复活 | `vat/records/[id]/steps` 同步 progress 前先读当前值，为 `已停止` 则跳过覆写。WHT 无此标记，不受影响 |
| 7 | influencers 迁移列错位 | 触发条件改为逐个比对 `INFLUENCER_STATUS_LIST` 全量（以前只认死 `待提交`/`不签约` 两个字符串）；搬运数据改为**按列名显式映射**，只搬两表都有的列；`pragma foreign_keys` 恢复放进 `finally`；脏数据清洗改为按完整状态列表判断 |
| 8 | 通知越权 | `notifications` GET/PATCH：非 admin 一律强制 `recipient = auth.name`，请求里的 recipient 只对 admin 生效；PATCH 单条标记也限定归属；limit 加上下限 |
| 10 | VAT/WHT 客户删除 | 改**软删除**：新增 `deleted` 列，客户主记录保留（外键不再悬空、归档记录仍可 JOIN 查出），同时置 `status='已终止'` 让按「启用」过滤的生成/通知逻辑自动跳过；删除全过程包进事务；去掉全局 `pragma foreign_keys = OFF`；补 admin 校验；WHT 原本连归档记录一起删，现与 VAT 统一为保留 |
| 11 | 积分月份按 UTC 切 | 新增 `bangkokMonthBounds()` / `utcSecondBefore()`，月榜和季度榜的 `created_at` 边界改为由曼谷日历换算出的 UTC 区间 |
| 12 | VAT/WHT 默认月份 | `vat/notify`(×2)、`vat/dashboard`、`wht/stats` 改用 `bangkokMonthKey()`；`leave/dashboard` 的「今天」改用 `bangkokToday()` |
| 13 | 客户状态自动流转 | 新增 `status_locked` 列，手动改过状态的客户不再被规则覆盖（PATCH 改 status 时置位，release 释放回公海时清零）；规则2、规则3 增加 `updated_at` 守卫，修掉「跟进中→已合作→沉睡」一次到底、以及「刚激活的客户下次刷新又被打回沉睡」两处连锁；`applyAutoFlow` 包 try/catch，自动流转出错不再让整个客户列表 500 |

顺带修的（扫描时新发现，都是同类问题）：

- **`GET /api/wht/customers` 完全没有鉴权** —— 同文件其他方法有，所以第一轮按文件粒度的扫描漏掉了。未登录即可拉取全部预扣税客户名单。已补。本轮改用 **handler 粒度**重扫，现在全项目只剩 4 个无鉴权入口，都是有意为之的公开接口：`auth/login`、`external/login`、`client-feedback/public` 的 GET/POST。
- **三张表只在路由文件里首次访问才建**（`wht_step_notes`、`wht_record_documents`、`vat_step_notes` 的 `ensureTable()`）—— 别处引用（比如客户删除的级联清理）会撞 "no such table"。已统一挪进 `db.ts` 建表。

## 验证方式

1. `npx tsc --noEmit` → 0 error
2. **influencers 迁移演练（6/6）**：把 `data.db` 副本还原成线上那种「code 在第 5 位、CHECK 缺新状态」的老表，跑真实迁移逻辑（常量和列清单直接从 `db.ts` 正则读取，确保验的就是线上代码）：16 行数据逐字段比对完全一致、新 CHECK 覆盖全部状态、新状态可写入、外键已恢复。
   **对照实验**证明旧写法确实会坏数据：
   ```
   迁移前: (id=4, code='111', contact_phone='', line_id='', status='已签约')
   迁移后: (id=4, code='4',   contact_phone='111', line_id='', status='')   ← 错位
   ```
3. **P1 冒烟（7/7）**：软删除后客户主记录保留、列表不展示、归档记录仍能 INNER JOIN 查出（旧实现这里是 0）、按「启用」过滤自动跳过；自动流转不再连锁跳级、手动锁定不被覆盖。
4. 沙箱依旧跑不了 `next build`（SWC 是 macOS 二进制），请本地再跑一次。

## 遗留（P2，未处理）

WHT 50ทวิ 证书泰文乱码（#14，需要嵌泰文字体）、WHT 列表隐藏停用客户历史（#15）、VAT 费用金额 0 被拒（#16）、VAT/WHT 缺 client 角色拦截（#17）、工作签证/社保开户页面重复标题（#18）、批量暂停不限定原状态（#19）、改金额后对账表不同步（#20）、未知 subtype 生成僵尸记录（#21）、删除接口 admin 校验不一致（#22）。


---

# P2 修复记录（2026-07-25）

| # | 问题 | 改动 |
|---|---|---|
| 14 | 50ทวิ 证书泰文乱码 / 税率写死 / 文件名 | ① 新增 `src/lib/pdf-fonts.ts`，嵌入 **Sarabun**（泰文+拉丁，OFL 授权，2 个字体文件共 161KB，已放进 `public/fonts/`），证书里所有 Helvetica 全部替换；字体缺失时直接返回 500 而不是静默产出方块文件。② 税率改用 `wht_records.tax_rate`（新增列，默认 3）。③ **算法本身是错的**：`amount` 存的是应扣税额（对账表里进 `tax_payable`），旧代码却当成收入额再乘 3%，等于对税额又收了一次税。现在税额直接用 `amount`，收入额优先取新增的 `income_amount` 列，没录入时按税率反算并在 PDF 上标注"推算值"。④ 文件名改 RFC 5987 `filename*=UTF-8''`，另留一个纯 ASCII 的 `filename` 兜底。 |
| 15 | WHT 列表隐藏停用客户的历史 | 去掉硬编码的 `c.status = '启用'`，改为可选参数 `customer_status`；默认只排除已软删客户，停用客户的历史申报记录重新可查 |
| 16 | VAT 费用金额 0 被拒 | `amount == null` 判断替代 `!amount`，另加非负数字校验和 `type` 白名单 |
| 17 | VAT/WHT 缺 client 角色拦截 | 两个模块所有写方法补齐 `role === "client"` → 403（VAT 19 个写方法、WHT 14 个，已全覆盖；少数原本就有更严格的 admin 校验的保持不变） |
| 18 | 工作签证/社保开户页面重复标题 | 两个页面去掉自己那层 `<h1>` + 描述，统一交给 `BusinessLinePage` 渲染，原文案合并进 `description` |
| 19 | 批量暂停不限定原状态 | 加 `AND status = '启用' AND deleted = 0`，返回值改用真实受影响行数 |
| 20 | 改金额后对账表不同步 | VAT / WHT 各加一个 `syncReconciliation()`，PATCH 改 amount 时按"该客户该月所有记录税额合计"重算应付和未付（已付金额保持不变）。之前只在「步骤2 标记完成」那一刻同步一次 |
| 21 | 未知 subtype 生成僵尸记录 | WHT 创建/批量生成校验 subtype 在 `WHT_SUBTYPES` 内；VAT/WHT 都加了 `YYYY-MM` 月份格式校验、客户存在性校验 |
| 22 | 删除接口权限不一致 | 主数据删除统一为「管理员或创建人本人」：达人、合同、发现任务按 `created_by`/`creator` 判断；工厂表没有创建人字段，限管理员 |

## 验证方式

1. `npx tsc --noEmit` → 0 error
2. **PDF 实际生成对比**（用 pdftotext 提取文字）：
   ```
   旧版 (Helvetica): â¾ãâ®7âÞ#ãâ>-à~ã.#â¾1à ã.)ãR á~5äŽä     ← 乱码
   新版 (Sarabun):   หนังสือรับรองการหักภาษี ณ ที่จ่าย        ← 正确
   ```
   并确认新版 PDF 内嵌了字体子集（BaseFont: `DZZZZZ+Sarabun-Regular`），旧版没有内嵌。
3. **P2 冒烟 8/8**：税额/收入额换算、金额 0 可提交、负数被拒、已终止客户不被批量暂停改写、改金额后对账同步、未知 subtype 与月份格式校验。
4. **全局复核**：无鉴权 handler 只剩 4 个（都是有意公开的 `auth/login`、`external/login`、`client-feedback/public` GET+POST）；API 层不再有 `pragma foreign_keys = OFF`；证书里 Helvetica 残留 0 处；硬编码 cron 令牌残留 0 处。
5. 沙箱跑不了 `next build`（SWC 是 macOS 二进制），请本地再跑一次。

## ⚠️ 部署注意

1. **`public/fonts/` 必须随代码一起部署**。Docker 部署时确认字体文件进了镜像——缺文件会让 50ทวิ 下载直接报 500（这是有意的，好过发出一份全是方块的税务文件）。
2. **中文公司名暂不会渲染**：Sarabun 不含 CJK 字形。需要的话把中文字体放到 `public/fonts/NotoSansSC-Regular.ttf`，代码会自动检测启用；没放则只在服务端日志里警告。字体约 10MB，所以没直接进仓库，获取方式写在 `src/lib/pdf-fonts.ts` 顶部注释里。
3. 别忘了上一轮就需要的 `CRON_SECRET` 和 `JWT_SECRET`（见 `.env.example`）。

## 新增的数据库列（均为 ALTER，幂等，无需手工迁移）

`wht_records.income_amount` / `wht_records.tax_rate` / `vat_customers.deleted` / `wht_customers.deleted` / `customers.status_locked` / `feedback_tokens.ref_type` / `client_feedback.ref_type`
