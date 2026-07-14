# Bug 审查报告（2026-07-15）

## 🔴 严重（安全类）

### 1. 达人/代运营模块约 20 个 API 路由完全没有鉴权
以下路由既不调用 `verifyAuth` 也不校验 token，任何人不登录即可读写数据：

- `src/app/api/contracts/route.ts`（GET/POST/DELETE 无鉴权，仅 PATCH 有）
- `src/app/api/influencers/**` 全部（含 route.ts、[id]、steps、notes、documents、finances、certificates、evaluations、evaluations/import、start-phase、factories）
- `src/app/api/factories/route.ts`、`factories/[id]/route.ts`
- `src/app/api/discovery-tasks/**` 全部
- `src/app/api/agency/stats/route.ts`

合同（含底薪/佣金等敏感数据）、达人档案、财务记录可被匿名读取、篡改和删除。

### 2. contracts PATCH 存在 SQL 列名注入
`src/app/api/contracts/route.ts` PATCH：

```ts
for (const [k, v] of Object.entries(fields)) {
  sets.push(`${k} = ?`); vals.push(v);   // k 直接来自请求体，未白名单校验
}
```

请求体的字段名直接拼进 SQL。构造恶意 key（如 `"payment_status = '已付' WHERE 1=1 --"`）可注入任意 SQL 片段。必须改为字段白名单。

### 3. 打卡接口可代打卡
`src/app/api/attendance/route.ts` POST 用请求体里的 `employee_name` 而不是 `auth.name`，任何登录用户可替任何人签到/签退。同理 `attendance/request`（补卡）如有相同写法也需检查。

### 4. 员工可越权操作
- `PATCH /api/orders/:id` 和 `DELETE` 挡了 client 角色，但 `orders/:id/steps`、`finances`、`documents`、`certificates` 的写接口对 client 角色不设限 —— 客户账号可以改步骤状态、加删费用记录。
- `DELETE /api/employees` 允许管理员删除自己/最后一个 admin，无保护。

## 🟠 高（功能逻辑错误）

### 5. step_documents 表从未写入 —— 步骤文件清单功能整体失效
全项目只有 SELECT/UPDATE/DELETE step_documents，没有任何 INSERT（订单创建时也不生成）。因此：
- 订单详情页 `existingDoc` 永远是 undefined，"标记已上传"按钮永远不出现；
- "文件 x/y" 进度永远不显示；
- `mark-uploaded` 接口永远无数据可更新。

修法：`POST /api/orders` 创建步骤时按 `stepRequiredDocs`/`getStepDocs` 同步插入 step_documents。

### 6. 地址认证"湘泰地址"流程从前端无法触发
`orders/new/page.tsx` 没有 address_type 和 monthly_rent 表单项，createOrder 也不传该字段 → 后端永远收到默认 `client`，`getStepsWithAddressType` 的 xiangtai 分支（插入"签订租赁合同/收取首月租金"两步）成了死代码。CLAUDE.md 声明的核心特性实际不可用。

### 7. 湘泰地址步骤插入后，文档/时间映射会错位（潜在）
`getStepsWithAddressType` 在第 4、5 位插入两步后，后续所有步骤 step_order +2，但 `addressDocs`/`addressTimes` 仍按原 16 步的序号映射 → 订单详情页展示的"所需文件/预估时间"全部错位两位。目前因 bug #6 未暴露，一旦修了 #6 就会显现。

### 8. 商标"国际商标/购买R标"子服务的文档配置是死代码
`constants.ts` 定义了 `internationalTrademarkDocs/Times/Steps`、`buyRTrademarkDocs/Times/Steps`，但全项目无引用（步骤模板在 db.ts 里重复写了一份）。`getStepDocs(2, ...)` 忽略 sub_service_type 一律返回 `trademarkDocs`（7 步），国际/R标订单（8 步）在详情页会显示错误的所需文件和时间。

### 9. FDA"医疗器械认证"无步骤模板
`fdaSubServices` 有 `medical`，也有 `/fda-certification/medical` 页面，但 `getBusinessSteps` 没有 medical 分支 → 回落到通用 FDA 5 步（收集资料/送检/提交/缴费/拿证），文档映射回落到化妆品配置。若非有意，需补模板。

### 10. 考勤全部用 UTC，时区错误连环
`src/app/api/attendance/route.ts` / `summary/route.ts`：
- `today = new Date().toISOString().split("T")[0]` 是 UTC 日期。曼谷（UTC+7）早上 7 点前打卡会记到**前一天**；"今天已打卡"的判断边界也是 UTC 零点（曼谷早 7 点）。
- 迟到判断 `check_in > "${date} 09:00:00"` 比较的是 UTC 时间，等于曼谷 16:00 才算迟到 —— 迟到统计基本恒为 0。
- `getWorkDays` 注释写"周一至周五"，实现是 `day !== 0`（把周六算工作日），两者取其一。

### 11. 考勤月度汇总多处统计错误
`attendance/summary/route.ts`：
- 请假天数用 `COUNT(*)` 数**请假单数**而非天数：一张 5 天的假条只算 1 天，缺勤数被高估。
- attendance 表中 type='请假' 的记录与 leave_requests 会重复计入 leaveCount。
- 查询未来月份时 `elapsedWorkDays` 用当前日号套到目标月，结果无意义。

### 12. 全部步骤"阻塞"时订单被标记为"已完成"
`orders/[id]/steps/route.ts`：`allDone = steps.every(s => s.status === "已完成" || s.status === "阻塞")` —— 一个订单所有步骤都阻塞也会把订单状态置为"已完成"。

### 13. 任务 ID 会碰撞
`tasks/route.ts`：`TASK-${String(Date.now()).slice(-6)}` 取毫秒时间戳末 6 位，每 ~16.7 分钟循环一次；撞上已有 ID 时 INSERT 违反主键约束直接 500。建议用自增或加随机后缀。

### 14. CSV 评估导入的 gmv_range 列判定逻辑错误
`influencers/evaluations/import/route.ts`：

```ts
const gmvRangeIdx = headers.findIndex(h => h.includes("gmv") && headers.filter(...).length > 1 ? headers.lastIndexOf("gmv") : gmvIdx);
```

三元运算符优先级问题：findIndex 回调返回的是**索引数字**而不是布尔值（0 为假、-1 为真），结果完全随机错位，可能把第 1 列数据写进 gmv_range。另外：
- CSV 用 `split(",")` 解析，字段含逗号（带引号）即错位；
- rating 不在 `('','A','B','C','D')` 内会触发 CHECK 约束异常 → 整个请求 500，且无事务，前面行已写入（部分导入）。

## 🟡 中（一致性/边界）

15. **费用金额为 0 被拒**：`orders/[id]/finances` POST 用 `if (!type || !amount)`，`amount: 0` 会被 400；且 type 不校验 income/expense，非法值触发 CHECK 约束 → 500。
16. **证书 PATCH 不校验归属**：`UPDATE certificates ... WHERE id = ?` 未带 `AND order_id = ?`，可跨订单改证书（DELETE 有校验，PATCH 没有）。
17. **新增证书不自动算状态**：POST 恒为 'valid'，即使 expiry_date 已过期；PATCH 才有自动计算。
18. **外部客户接口按姓名匹配订单**：`external/orders` 用 `orders.customer_name = token.name` 关联，同名客户互相可见订单；customer_name 与员工表 name 是弱关联，改名即失联。
19. **多币种金额直接相加**：`business-line-page.tsx`（及 finance 页如同样写法）把 CNY 和 THB 的 total_amount 直接 sum 后按 ¥ 显示。
20. **子服务判定不看业务线**：`getBusinessSteps` 的 sub_service_type 分支是全局 if（不校验 businessTypeId），如果不同业务线出现同名 key（现有 "site"、"tiktok" 等）会拿到别的业务线的步骤模板。
21. **步骤更新接口 step 相关校验**：`updateStep` 前端在改负责人时必须回传当前 status（`{ status: step.status, assignee }`），API 把 status 设为必填导致"只改负责人"也会触发状态逻辑重算 completed_at（非已完成状态会清空 completed_at —— 对已完成步骤改负责人需带"已完成"，前端已带，但接口设计脆弱）。
22. **审计日志 actor 不可信**：`documents` POST 用 `uploaded_by`（请求体）而非 `auth.name` 记日志；tasks POST 用 `assignee` 当 actor。
23. **CLAUDE.md 与实际不符**：文档说 8 条业务线/端口 3002 等，实际种子有 9 条（含 NBTC）且新增了 agency/internal/attendance 等大量模块；文档表结构也缺 tasks、attendance、influencer 系列表。按文档改代码容易踩坑。

## 建议修复顺序
1. #1/#2/#3/#4（安全，1 天内）
2. #5/#6/#7（订单核心流程）
3. #10/#11/#12/#13（考勤与状态机）
4. 其余按需。
