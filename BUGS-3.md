# 第三轮代码审查报告

**审查时间**：2026-07-25
**换的维度**：前两轮按「模块」扫，这轮换成按「失效方式」扫——之前只粗看过的模块逐个通读，外加事务完整性、并发竞态、崩溃点、性能这四个新维度。
**结果**：找到 11 个新问题，全部已修。`tsc` 零错误，14 项验证全过。

---

## 🔴 最严重的一个：积分引擎从来没跑通过

`src/app/api/internal/points/route.ts`

奖惩积分模块的自动计算函数 `computeAutoPoints()` 里有这么一句：

```ts
const lateRecs = db.prepare("SELECT id, date, points FROM points_records WHERE ...").all(en);
```

但 **`points_records` 表根本没有 `date` 列**（只有 `created_at`）。实测：

```
sqlite> SELECT id, date, points FROM points_records LIMIT 1;
Error: no such column: date
```

调用方是这样写的：

```ts
if (doRefresh) {
  try { computeAutoPoints(db, month); } catch (e) { console.error("[积分引擎] 失败", e); }
}
```

异常被吞掉，前端看到的是"刷新成功"。而实际发生的是：

1. 函数开头的 `DELETE` 已经把当月全部自动积分**清空**了；
2. 迟到、缺勤、全勤、连续打卡几条规则插入了记录；
3. 走到「救回机制」抛异常 —— **整个函数中断**；
4. 后面的「步骤逾期」「提前完成」「工单超时」「解决工单」「A级评估」**5 条规则从来没有被执行过**；
5. 没有事务，前面的删除和插入全部留在库里。

也就是说：**每点一次"刷新积分"，就把当月积分删掉再补回一半。** 这个模块从上线起就没有正常工作过。

而且「救回机制」的设计本身和数据模型对不上——`late` 规则是按月汇总成一条记录的，根本没有单日信息，所以就算加了 `date` 列也修不好。

**改法**：救回逻辑改成直接基于考勤数据按天判定（迟到那天之后到本周六，每个工作日都出勤且不迟到 → 救回一半扣分），不再依赖不存在的字段；整个重算包进事务；失败通过 `refreshError` 返回给前端，不再静默。

---

## 🟠 积分引擎的另外 4 个计算错误

修完崩溃点之后，剩下的规则也是错的：

### 1. 工作日天数算的是上个月的日历，1 月直接算成 31 天

```ts
const ym = +y, mm = +m - 1;                       // mm 是 0-based
const ds = `${ym}-${String(mm).padStart(2,"0")}-${...}`;   // 但这里当成 1-based 拼日期字符串
```

实测拼出来的字符串：

| 月份 | 代码拼出的日期 | 后果 |
|---|---|---|
| 2026-07 | `2026-06-15` | 用 6 月的日历算 7 月的工作日 |
| 2026-01 | `2026-00-15` | 非法日期 → `bangkokDayOfWeek` 返回 NaN → `NaN !== 0` 恒真 → **整月 31 天全算工作日**（实际应为 27 天） |

`workDays` 直接进 `absentDays = workDays - 出勤 - 请假`，而缺勤是 **-10 分/天**。1 月份每人平白多扣 40 分。

### 2. 迟到判定用 UTC 比较，等于要下午 4 点才算迟到

```sql
substr(check_in, 12, 8) > '09:00:00'
```

`check_in` 存的是 UTC，这么比等于「曼谷时间 16:00 之后才算迟到」——迟到扣分几乎从不触发。这和第一轮已经在 `attendance/summary` 修过的是同一个 bug，points 这边漏了。

### 3. 工单和 A 级评估统计的是"有史以来"

```ts
"SELECT COUNT(*) FROM issue_tickets WHERE assignee = ? AND status = '已解决'"   // 没有月份范围
"SELECT COUNT(*) FROM influencer_evaluations WHERE evaluated_by = ? AND final_rating = 'A'"  // 同样
```

每个月重算，都会把同一批历史工单和评估重新加一遍分，月月累积。

### 4. 重算历史月份，分数记到当月

`insertAuto` 不带 `created_at`，默认取 `datetime('now')`。而 `DELETE` 是按月份范围删的。所以重算 6 月：删掉 6 月的记录 → 插入的新记录 created_at 是今天（7 月）→ **6 月永远空着，7 月被污染**。

---

## 🟠 其他模块

### 5. 工单 PATCH 没有归属校验
`src/app/api/issues/route.ts`

GET 限定了「只看自己的」、DELETE 限定了「只删自己创建的」，唯独 PATCH 没有——任何员工都能修改、指派、关闭别人的工单。而「解决工单」是加分项（`issue_resolved` +3/个），等于可以刷分。同时 `status`/`priority` 没有白名单校验，非法值会撞 CHECK 约束变成 500；`resolved_by` 取自请求体可伪造。

### 6. 审计日志任何员工都能看全量
`src/app/api/audit-logs/route.ts`

审计日志记录的是"谁在什么时候把什么改成了什么"（含合同金额、负责人变更等），但接口只校验了登录，不限角色。另外 `limit` 参数没做数字校验，`?limit=abc` → `parseInt` 得到 NaN → SQLite 报 `datatype mismatch` → 500。

### 7. 级联删除没有事务，且两个入口清理的表不一致
`influencers` 有两个删除入口（`/api/influencers?id=` 和 `/api/influencers/[id]`），清理的子表**不一样**：前者漏删了步骤、备注、文档、财务、证书 5 张表，会留下一堆指向已删达人的孤儿数据。两个入口都没有事务。`discovery-tasks` 的删除同样没有事务，而且不删达人时没有解除 `discovery_task_id` 关联，达人会指向一个不存在的任务。

### 8. 请假审批 + 回写考勤没有事务
审批通过时会按日期区间逐天写 `attendance` 记录，中途失败就会留下"状态已通过、但考勤只标了一半"的数据。顺带修了日期迭代用本地时区 `new Date(dateStr)` 的问题（服务器时区不同会偏移一天）。

### 9. 57 个路由的 `req.json()` 没有保护
请求体为空或不是合法 JSON 时，`await req.json()` 抛异常 → Next.js 变成一个没有任何说明的 500。新增 `src/lib/req.ts` 的 `readJson()` 统一兜底，让后续字段校验去返回带原因的 400。

### 10. VAT 步骤更新缺事务
步骤状态、对账金额、记录进度三处写操作分开执行，中途失败会出现"步骤已完成但对账金额没跟上"的对不上账状态。

### 11. 批量操作缺事务
VAT/WHT 的批量催交、批量通知，循环里逐条写，失败会留半套。

---

## 已知但**没有**处理的（不是 bug，或需要单独排期）

| 项目 | 说明 |
|---|---|
| 外部客户接口靠公司名匹配订单 | BUGS.md #18，需要加 `customer_id` 字段做数据迁移，建议单独排期 |
| PDF 中文字体 | Sarabun 不含 CJK，中文公司名渲染不出来。10MB 的字体没进仓库，装法见 `src/lib/pdf-fonts.ts` 注释 |
| 工作日 = 周一至周六 | 业务规则，不是 bug。要改五天工作制的话，`attendance/summary` 和 `points` 各有一处 |
| N+1 查询（约 30 处） | 客户/员工都是几十条量级，SQLite 进程内查询，实测无感知延迟。数据量上去了再优化 |
| `points` PATCH 的撤销/申诉分支无事务 | 每个分支只有 1–3 条相关写操作，且都在同一张表上，风险很低 |
| 部分列表接口无分页 | orders / documents / audit-logs 等，目前数据量下没问题 |

---

## 验证

- `npx tsc --noEmit` → 0 error
- **14 项自动验证全过**：崩溃点移除、事务覆盖、月份拼接、时区换算、月份过滤、历史时间戳、工单归属与白名单、审计日志加固、`req.json()` 零裸调用、鉴权 handler 数正确（只剩 4 个有意公开的接口）
- 数值对照：2026-01 实际工作日 27 天（旧代码算 31）、2026-07 实际 27 天（旧代码算的是 6 月日历）

## 三轮累计

| 轮次 | 发现 | 修复 |
|---|---|---|
| 第一轮（BUGS.md） | 23 | 21（2 项明确延后） |
| 第二轮（BUGS-2.md） | 22 | 22 |
| 第三轮（本报告） | 11 | 11 |
| **合计** | **56** | **54** |

## 部署前检查清单

1. 本地跑 `npm run build`（沙箱的 SWC 是 macOS 二进制，跑不了）
2. `.env` 配置 `JWT_SECRET` 和 `CRON_SECRET`（见 `.env.example`）
3. 确认 `public/fonts/` 随代码进了 Docker 镜像（缺字体会让 50ทวิ 下载报 500）
4. 提交前建议先看一遍 `git diff`，改动量较大
