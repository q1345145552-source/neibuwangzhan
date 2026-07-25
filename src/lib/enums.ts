/**
 * 枚举白名单 —— 与数据库 CHECK 约束保持一致。
 *
 * 背景：很多接口把请求体里的状态值直接写进带 CHECK 约束的列。传个不认识的值，
 * SQLite 会抛 CHECK constraint failed，Next.js 变成一个没有任何说明的 500，
 * 前端只能显示"操作失败"。这里集中定义合法值，在写库之前挡掉并给出明确的 400。
 *
 * 改动约定：新增状态时，**同时**改这里和 db.ts 的建表/迁移，两边必须一致。
 * `scripts/check-enums.js` 会比对本文件与实际 data.db 的 CHECK 约束。
 */

export const ENUMS = {
  "attendance.type": ["正常", "补签", "请假"],
  "attendance_requests.status": ["待审批", "已通过", "已驳回"],
  "certificates.status": ["valid", "expiring", "expired"],
  "client_feedback.feedback_type": ["client", "internal"],
  "contracts.payment_status": ["未付", "部分付", "已付"],
  "customer_points.point_type": ["跟进", "认领", "激活", "升级", "成交"],
  "contracts.phase": ["discovery", "completed_discovery", "contract", "completed_contract", "incubation", "completed_incubation"],
  "customers.status": ["潜在", "跟进中", "已合作", "沉睡"],
  "discovery_tasks.status": ["active", "completed"],
  "documents.direction": ["client_to_us", "us_to_client"],
  "employees.role": ["admin", "employee", "client"],
  "factories.phase": ["discovery", "completed_discovery", "contract", "completed_contract", "incubation", "completed_incubation"],
  "finances.currency": ["CNY", "THB"],
  "finances.type": ["income", "expense"],
  "influencer_evaluations.rating": ["", "A", "B", "C", "D"],
  "influencer_factories.relationship": ["合作", "考察", "已终止"],
  "influencer_finances.type": ["income", "expense"],
  "influencer_steps.phase": ["discovery", "contract", "incubation"],
  "influencers.phase": ["discovery", "completed_discovery", "contract", "completed_contract", "incubation", "completed_incubation"],
  "influencers.reply_status": ["待联系", "已联系", "已回复", "未回复", "不回复"],
  "influencers.status": ["待提交", "待评估", "已评估", "已推荐给老板", "不推荐", "已联系", "签约中", "已签约", "品牌孵化中", "已完成", "已停止", "已入池", "不签约"],
  "issue_tickets.priority": ["low", "medium", "high", "urgent"],
  "issue_tickets.status": ["待处理", "处理中", "已解决"],
  "leave_requests.leave_type": ["事假", "病假", "年假", "其他"],
  "leave_requests.status": ["待审批", "已通过", "已驳回"],
  "notifications.type": ["", "issue_assigned", "leave_requested", "contract_overdue", "eval_done", "mention"],
  "orders.currency": ["CNY", "THB"],
  "point_withdrawals.status": ["待审核", "已通过", "已驳回"],
  "points_records.status": ["有效", "已撤销", "已救回"],
  "points_rules.rule_type": ["auto", "manual"],
  "step_documents.status": ["pending", "uploaded"],
  "tasks.priority": ["low", "medium", "high"],
  "tasks.status": ["pending", "in_progress", "completed"],
  "templates.type": ["contract", "evaluation", "finance"],
  "vat_customers.status": ["启用", "暂停", "已终止"],
  "vat_record_finances.status": ["pending", "paid", "cancelled"],
  "vat_record_finances.type": ["income", "expense"],
  "vat_step_documents.status": ["pending", "uploaded"],
  "wht_customers.status": ["启用", "暂停", "已终止"],
  "wht_record_steps.status": ["待处理", "进行中", "已完成", "已跳过"],
  "wht_records.subtype": ["ภ.ง.ด.1", "ภ.ง.ด.53"],
} as const;

export type EnumKey = keyof typeof ENUMS;

/**
 * 达人步骤状态。
 *
 * 注意：`influencer_steps.status` 在数据库里**没有** CHECK 约束（历史遗留），
 * 所以不能放进上面的 ENUMS——check-enums.js 会报"enums.ts 有但 DB 没有"。
 * 在应用层强制校验，等哪次有机会重建该表时再补 CHECK 并挪进 ENUMS。
 *
 * 「已停止」用于终止整个达人的合作流程，会把达人主状态一并置为已停止。
 */
export const INFLUENCER_STEP_STATUSES = ["待处理", "进行中", "已完成", "阻塞", "已停止"] as const;

export function isValidStepStatus(v: unknown): boolean {
  return typeof v === "string" && (INFLUENCER_STEP_STATUSES as readonly string[]).includes(v);
}

/** 值是否合法（undefined/未提供 视为合法，由各接口自己决定是否必填） */
export function isValidEnum(key: EnumKey, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return (ENUMS[key] as readonly string[]).includes(String(value));
}

/**
 * 校验若干个枚举字段，返回第一个错误信息；全部合法返回 null。
 *
 * 用法：
 *   const err = validateEnums({ "customers.status": body.status });
 *   if (err) return NextResponse.json({ error: err }, { status: 400 });
 */
export function validateEnums(pairs: Partial<Record<EnumKey, unknown>>): string | null {
  for (const [key, value] of Object.entries(pairs) as [EnumKey, unknown][]) {
    if (!isValidEnum(key, value)) {
      const field = key.split(".")[1];
      return `${field} 的值「${String(value)}」无效，可选：${(ENUMS[key] as readonly string[]).filter(Boolean).join(" / ")}`;
    }
  }
  return null;
}
