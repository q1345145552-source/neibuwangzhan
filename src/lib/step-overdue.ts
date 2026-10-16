import type Database from "better-sqlite3";
import { parseDbTime, workDays } from "@/lib/handling-report";
import { currentOpenSteps } from "@/lib/step-status";

/**
 * 步骤超时（流程设置第 3 期，2026-10-16）：在查询时现场算，不写 order_steps.deadline（一写积分就扣分，老板定了先不开）。
 * - 预计天数：只认建单时记在 order_steps.expected_days 的（老规矩「老单不跟着流程变」）；建单时还没设天数的单不判超时，
 *   免得第一次设天数就把积压的老单一下子全提醒一遍。
 * - 从什么时候开始等：这一步最近一次被改成「进行中」的时刻（撤回再开始按最近一次）；没有就用开始时间；
 *   还没点开始的，用前面最近一步办完的时刻；都没有用建单时间。
 * - 按工作日算（周一到周六 08:00-17:00，周日和泰国假日不算，9 小时算 1 天），跟办理月报同一算法。
 * - 当前步骤：见 currentOpenSteps（跟订单列表、办理月报同一口径）。
 */

export type CurrentStepTiming = {
  orderId: string; customer: string; businessTypeId: number; owner: string;
  stepId: number; stepName: string; assignee: string; status: string;
  since: Date | null; elapsedDays: number; expectedDays: number | null; overdue: boolean;
};

type OrderRow = { id: string; customer_name: string; business_type_id: number; sub_service_type: string | null; address_type: string | null; responsible_person: string | null; created_at: string; status: string };
type StepRow = { id: number; order_id: string; step_name: string; step_order: number; status: string; assignee: string | null; started_at: string | null; completed_at: string | null; expected_days: number | null };

export function loadHolidays(db: Database.Database): Set<string> {
  try { return new Set((db.prepare("SELECT date FROM thai_holidays").all() as { date: string }[]).map((h) => h.date)); } catch { return new Set(); }
}

export function currentStepTimings(db: Database.Database, now: Date, onlyOrderIds?: Set<string>): CurrentStepTiming[] {
  const holidays = loadHolidays(db);
  const orders = (db.prepare("SELECT id, customer_name, business_type_id, sub_service_type, address_type, responsible_person, created_at, status FROM orders WHERE status NOT IN ('已完成','客户取消')").all() as OrderRow[])
    .filter((o) => !onlyOrderIds || onlyOrderIds.has(o.id));
  if (!orders.length) return [];
  const steps = db.prepare("SELECT id, order_id, step_name, step_order, status, assignee, started_at, completed_at, expected_days FROM order_steps ORDER BY order_id, step_order, id").all() as StepRow[];
  const byOrder = new Map<string, StepRow[]>();
  for (const s of steps) { const l = byOrder.get(s.order_id); if (l) l.push(s); else byOrder.set(s.order_id, [s]); }
  const restartStmt = db.prepare("SELECT MAX(created_at) AS t FROM audit_logs WHERE target_type = 'step' AND target_id = ? AND action = '更新步骤:进行中'");
  const out: CurrentStepTiming[] = [];
  for (const o of orders) {
    const list = byOrder.get(o.id) || [];
    const current = currentOpenSteps(o.business_type_id, o.sub_service_type, list);
    if (!current.length) continue;
    for (const s of current) {
      const idx = list.indexOf(s);
      const started = parseDbTime(s.started_at);
      let restarted: Date | null = null;
      try { restarted = parseDbTime((restartStmt.get(String(s.id)) as { t: string | null } | undefined)?.t); } catch { /* 老库没有操作记录表 */ }
      const prevDone = list.slice(0, Math.max(idx, 0)).map((x) => parseDbTime(x.completed_at)).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] || null;
      const since = (restarted && (!started || restarted > started) ? restarted : started) || prevDone || parseDbTime(o.created_at);
      const elapsed = since ? workDays(since, now, holidays) : 0;
      const expected = s.expected_days ?? null;
      out.push({
        orderId: o.id, customer: o.customer_name, businessTypeId: o.business_type_id, owner: (o.responsible_person || "").trim(),
        stepId: s.id, stepName: s.step_name, assignee: (s.assignee || "").trim(), status: s.status,
        since, elapsedDays: Math.round(elapsed * 10) / 10, expectedDays: expected,
        overdue: expected != null && elapsed > expected,
      });
    }
  }
  return out;
}
