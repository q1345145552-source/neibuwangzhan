import type Database from "better-sqlite3";
import { subServices } from "@/lib/constants";
import { currentOpenSteps } from "@/lib/step-status";

/**
 * 办理效率月报（2026-10-15，老板定的口径）：
 * - 天数按工作日：周一到周六 08:00-17:00（曼谷），周日和 thai_holidays 里的泰国法定假日不算，9 个工作小时算 1 天
 * - 办理周期从建单那一刻算到最后一步完成
 * - 步骤名以「等待」「再次等待」开头的（等待官方审核、等待Shopee联系、等待客户签署……）算「外部等待」，不算到员工头上；
 *   名字中间提到等待的不算（如「做账报税：…等待老板安排…」）；
 *   以后流程设置能勾选「外部等待」时改用勾选
 * - 公司注册的新注册/VAT/开户/地址/做账共用一套 11 步（含条件步骤、按月循环的做账），周期和最慢一步先不算，只列单数；
 *   「公司变更」有自己的 4 步顺序流程，照常算
 * - 步骤被撤回后重新开始的，从最近一次重新开始算（开始时间字段只记第一次，所以从操作记录里取）
 * - 已取消的单不进任何统计
 * - 订单表没记办结时间，用最后一步的完成时间；经办人没有历史，「每人手上的单」只能看现在
 */

const WORKDAY_SECONDS = 9 * 3600;
const BKK_OFFSET_MS = 7 * 3600 * 1000;
/** 几分钟内连着点完的步骤：耗时没有意义，不进中间值 */
const BATCH_SECONDS = 300;
/** 判断「平时多久」的样本数下限和回看天数 */
const MIN_SAMPLES = 5;
const LOOKBACK_DAYS = 90;
/** 周期统计至少几单才给中间值 */
const MIN_CYCLE_SAMPLES = 3;
const OVERDUE_FACTOR = 1.5;
/** 「最慢的几步」只列中间值超过半个工作日的，几小时就办完的步骤列出来没有意义 */
const SLOW_MIN_DAYS = 0.5;
const COMPANY_REG = "公司注册";
const CANCELLED = "客户取消";
const DONE = "已完成";
const closed = (s: { status: string }) => s.status === DONE || s.status === "已跳过"; // 已跳过 = 这一步不用办（2026-10-16）

type OrderRow = { id: string; customer_name: string; business_type_id: number; sub_service_type: string | null; address_type: string | null; status: string; created_at: string; responsible_person: string | null };
type StepRow = { id: number; order_id: string; step_name: string; step_order: number; status: string; assignee: string | null; started_at: string | null; completed_at: string | null; created_at: string | null; expected_days: number | null };

/** 库里时间两种写法混存：「YYYY-MM-DD HH:MM:SS」（UTC）和 ISO（带 Z） */
export function parseDbTime(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += "T00:00:00Z";
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = s.replace(" ", "T") + "Z";
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += "Z";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function bkk(d: Date): Date { return new Date(d.getTime() + BKK_OFFSET_MS); }
function pad(n: number): string { return String(n).padStart(2, "0"); }
export function bkkDateKey(d: Date): string { const b = bkk(d); return `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(b.getUTCDate())}`; }
export function bkkMonthKey(d: Date): string { return bkkDateKey(d).slice(0, 7); }

/** 两个时刻之间的工作秒数：只算曼谷周一到周六 08:00-17:00，跳过法定假日 */
export function workSeconds(from: Date, to: Date, holidays: Set<string>): number {
  if (!(to > from)) return 0;
  let total = 0;
  const b = bkk(from);
  // 从 from 所在的曼谷日开始逐日累加
  let dayStartUtc = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - BKK_OFFSET_MS;
  while (dayStartUtc < to.getTime()) {
    const day = new Date(dayStartUtc);
    const key = bkkDateKey(day);
    const dow = bkk(day).getUTCDay();
    if (dow !== 0 && !holidays.has(key)) {
      const ws = dayStartUtc + 8 * 3600 * 1000, we = dayStartUtc + 17 * 3600 * 1000;
      const s = Math.max(ws, from.getTime()), e = Math.min(we, to.getTime());
      if (e > s) total += (e - s) / 1000;
    }
    dayStartUtc += 24 * 3600 * 1000;
  }
  return total;
}
export function workDays(from: Date, to: Date, holidays: Set<string>): number {
  return workSeconds(from, to, holidays) / WORKDAY_SECONDS;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

export function isExternalWait(stepName: string): boolean { return /^(再次)?等待/.test(stepName.trim()); }

export type HandlingReport = {
  month: string;
  months: string[];
  asOf: string;
  summary: { done: number; medianDays: number | null; inProgress: number; blockedOrders: number; overdue: number; coverage: number | null; batchSteps: number; cancelledTotal: number };
  groups: { group: string; done: number; medianDays: number | null; maxDays: number | null; inProgress: number; note: string }[];
  slowSteps: { group: string; step: string; medianDays: number; samples: number; external: boolean }[];
  load: { person: string; kind: "staff" | "unassigned" | "external" | "other"; orders: number; blocked: number; notStarted: number; longestDays: number }[];
  /** normalDays：流程设置里设了预计天数的用设定值（bySetting=true），没设的用近 90 天中间值 */
  overdue: { orderId: string; customer: string; group: string; step: string; assignee: string; external: boolean; stayedDays: number; normalDays: number; bySetting?: boolean }[];
};

export function buildHandlingReport(db: Database.Database, month: string, now: Date): HandlingReport {
  const orders = db.prepare("SELECT id, customer_name, business_type_id, sub_service_type, address_type, status, created_at, responsible_person FROM orders").all() as OrderRow[];
  const steps = db.prepare("SELECT id, order_id, step_name, step_order, status, assignee, started_at, completed_at, created_at, expected_days FROM order_steps ORDER BY order_id, step_order, id").all() as StepRow[];
  const btName = new Map((db.prepare("SELECT id, name FROM business_types").all() as { id: number; name: string }[]).map(b => [b.id, b.name]));
  const staff = (db.prepare("SELECT name, status FROM employees WHERE role IN ('admin','employee') AND name <> ''").all() as { name: string; status: string }[]);
  const staffByLower = new Map(staff.map(e => [e.name.trim().toLowerCase(), e]));
  let holidays = new Set<string>();
  try { holidays = new Set((db.prepare("SELECT date FROM thai_holidays").all() as { date: string }[]).map(h => h.date)); } catch { /* 老库没有假日表就只扣周日 */ }

  // 每一步被改成「进行中」的时刻（开始、撤回后重新开始、阻塞后撤回）：步骤表的 started_at 只记第一次
  const restarts = new Map<string, Date[]>();
  try {
    for (const r of db.prepare("SELECT target_id, created_at FROM audit_logs WHERE target_type = 'step' AND action = '更新步骤:进行中'").all() as { target_id: string; created_at: string }[]) {
      const t = parseDbTime(r.created_at); if (!t) continue;
      const l = restarts.get(r.target_id); if (l) l.push(t); else restarts.set(r.target_id, [t]);
    }
  } catch { /* 没有操作记录表就只用 started_at */ }
  /** 这一步最近一次开始的时刻（不晚于 limit）；没有记录或早于 started_at 时用 started_at */
  const roundStart = (s: StepRow, limit?: Date): Date | null => {
    const first = parseDbTime(s.started_at);
    const latest = (restarts.get(String(s.id)) || []).filter(t => !limit || t <= limit).sort((a, b) => b.getTime() - a.getTime())[0];
    return latest && (!first || latest > first) ? latest : first;
  };

  const stepsByOrder = new Map<string, StepRow[]>();
  for (const s of steps) { const list = stepsByOrder.get(s.order_id); if (list) list.push(s); else stepsByOrder.set(s.order_id, [s]); }

  const groupOf = (o: OrderRow): string => {
    const name = btName.get(o.business_type_id) || "未知业务";
    if (name === "地址认证") return `${name} · ${o.address_type === "xiangtai" ? "湘泰地址" : "客户地址"}`;
    const sub = o.sub_service_type || "";
    const label = sub && sub !== "storefront-unclassified" ? (subServices[o.business_type_id] || []).find(x => x.key === sub)?.label : undefined;
    return label ? `${name} · ${label}` : name;
  };
  /** 公司注册里共用那套 11 步的单（「公司变更」是自己的 4 步，不算在内） */
  const isCompanyReg = (o: OrderRow) => btName.get(o.business_type_id) === COMPANY_REG && o.sub_service_type !== "change";

  const live = orders.filter(o => o.status !== CANCELLED);
  const orderById = new Map(live.map(o => [o.id, o]));

  // ---------- 本月办完的单 ----------
  const doneInMonth: { o: OrderRow; days: number }[] = [];
  for (const o of live) {
    if (o.status !== DONE) continue;
    const list = stepsByOrder.get(o.id) || [];
    if (!list.length || !list.every(closed)) continue;
    const doneAt = list.map(s => parseDbTime(s.completed_at)).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
    const created = parseDbTime(o.created_at);
    if (!doneAt || !created || bkkMonthKey(doneAt) !== month) continue;
    doneInMonth.push({ o, days: workDays(created, doneAt, holidays) });
  }

  // ---------- 步骤耗时样本（已完成、有开始时间、不是几分钟内连着点完的） ----------
  type Sample = { group: string; step: string; days: number; completed: Date };
  const samples: Sample[] = [];
  let batchSteps = 0, monthSteps = 0, monthStepsWithStart = 0;
  for (const s of steps) {
    const o = orderById.get(s.order_id);
    if (!o || s.status !== DONE) continue;
    const done = parseDbTime(s.completed_at);
    if (!done) continue;
    const start = roundStart(s, done);
    if (bkkMonthKey(done) === month) { monthSteps++; if (start) monthStepsWithStart++; }
    if (!start || done < start) continue;
    if ((done.getTime() - start.getTime()) / 1000 < BATCH_SECONDS) { if (bkkMonthKey(done) === month) batchSteps++; continue; }
    if (isCompanyReg(o)) continue;
    samples.push({ group: groupOf(o), step: s.step_name, days: workDays(start, done, holidays), completed: done });
  }

  // 月末：所选月份的最后一刻（当月就用现在）
  const [y, m] = month.split("-").map(Number);
  const monthEndUtc = new Date(Date.UTC(y, m, 1) - BKK_OFFSET_MS - 1000);
  const reportEnd = monthEndUtc < now ? monthEndUtc : now;
  const within = (d: Date, end: Date) => d <= end && d.getTime() > end.getTime() - LOOKBACK_DAYS * 86400 * 1000;
  const keyOf = (g: string, st: string) => `${g}\u0000${st}`;
  const collect = (end: Date) => {
    const map = new Map<string, number[]>();
    for (const s of samples) if (within(s.completed, end)) { const k = keyOf(s.group, s.step); const l = map.get(k); if (l) l.push(s.days); else map.set(k, [s.days]); }
    return map;
  };

  const slowMap = collect(reportEnd);
  const slowSteps = [...slowMap.entries()]
    .filter(([, v]) => v.length >= MIN_SAMPLES && (median(v) ?? 0) >= SLOW_MIN_DAYS)
    .map(([k, v]) => { const [group, step] = k.split("\u0000"); return { group, step, medianDays: round1(median(v))!, samples: v.length, external: isExternalWait(step) }; })
    .sort((a, b) => b.medianDays - a.medianDays)
    .slice(0, 8);

  // ---------- 现在还在办的单：当前做到哪一步、谁手上、停了多久 ----------
  const baseline = collect(now);
  const loadMap = new Map<string, { kind: HandlingReport["load"][number]["kind"]; orders: Set<string>; blocked: Set<string>; notStarted: Set<string>; longest: number }>();
  const bump = (person: string, kind: HandlingReport["load"][number]["kind"], s: StepRow, stayed: number) => {
    let e = loadMap.get(person);
    if (!e) { e = { kind, orders: new Set(), blocked: new Set(), notStarted: new Set(), longest: 0 }; loadMap.set(person, e); }
    e.orders.add(s.order_id);
    if (s.status === "阻塞") e.blocked.add(s.order_id);
    if (s.status === "待处理") e.notStarted.add(s.order_id);
    e.longest = Math.max(e.longest, stayed);
  };
  const overdue: HandlingReport["overdue"] = [];
  const blockedOrders = new Set<string>();
  const inProgressOrders = live.filter(o => o.status !== DONE);
  for (const o of inProgressOrders) {
    const list = stepsByOrder.get(o.id) || [];
    if (list.some(s => s.status === "阻塞")) blockedOrders.add(o.id);
    // 公司注册（公司变更除外）可以不按顺序办：在办的步骤都算，一步都没开始就算第一个没做完的；跟订单列表、超时同一口径
    const current: StepRow[] = currentOpenSteps(o.business_type_id, o.sub_service_type, list);
    for (const s of current) {
      const idx = list.indexOf(s);
      // 前面最近一次办完的时刻（前一步被跳过时没有完成时间，往前找）
      const prevDone = list.slice(0, Math.max(idx, 0)).map(x => parseDbTime(x.completed_at)).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] || null;
      const since = roundStart(s) || prevDone || parseDbTime(o.created_at);
      const stayed = since ? workDays(since, now, holidays) : 0;
      const external = isExternalWait(s.step_name);
      // 步骤没写经办人的算订单负责人的（与「我的环节」同一口径，2026-10-15）；负责人也没填才算「未指定」
      const split = (v: string | null) => (v || "").split(/[\/、,，]/).map(x => x.trim()).filter(Boolean);
      const rawNames = split(s.assignee).length ? split(s.assignee) : split(o.responsible_person);
      if (external) bump("外部等待（等官方、等平台、等客户）", "external", s, stayed);
      else if (!rawNames.length) bump("未指定", "unassigned", s, stayed);
      else for (const raw of rawNames) {
        const emp = staffByLower.get(raw.toLowerCase());
        if (!emp) bump(`其他：${raw}`, "other", s, stayed);
        else if (emp.status === "离职" || emp.status === "停薪留职") bump(`${emp.name.trim()}（${emp.status}，要改派）`, "other", s, stayed);
        else bump(emp.name.trim(), "staff", s, stayed);
      }
      const who = (s.assignee || "").trim() || ((o.responsible_person || "").trim() ? `负责人：${(o.responsible_person || "").trim()}` : "");
      // 建单时记下了预计天数（流程设置里设的，2026-10-16）：超过就算超时，公司注册也一样；没记的（老单）照旧按平时 1.5 倍判
      const setDays = s.expected_days ?? null;
      if (setDays != null) {
        if (stayed > setDays) overdue.push({ orderId: o.id, customer: o.customer_name, group: groupOf(o), step: s.step_name, assignee: who, external, stayedDays: round1(stayed)!, normalDays: setDays, bySetting: true });
        continue;
      }
      if (isCompanyReg(o)) continue;
      const base = baseline.get(keyOf(groupOf(o), s.step_name));
      const normal = base && base.length >= MIN_SAMPLES ? median(base) : null;
      if (normal != null && stayed > normal * OVERDUE_FACTOR && stayed >= 1) {
        overdue.push({ orderId: o.id, customer: o.customer_name, group: groupOf(o), step: s.step_name, assignee: who, external, stayedDays: round1(stayed)!, normalDays: round1(normal)! });
      }
    }
  }
  overdue.sort((a, b) => b.stayedDays / Math.max(b.normalDays, 0.1) - a.stayedDays / Math.max(a.normalDays, 0.1));

  const kindRank = { staff: 0, other: 1, unassigned: 2, external: 3 } as const;
  const load = [...loadMap.entries()]
    .map(([person, e]) => ({ person, kind: e.kind, orders: e.orders.size, blocked: e.blocked.size, notStarted: e.notStarted.size, longestDays: round1(e.longest)! }))
    .sort((a, b) => kindRank[a.kind] - kindRank[b.kind] || b.orders - a.orders);

  // ---------- 各类业务 ----------
  const groupNames = new Set<string>([...doneInMonth.map(d => groupOf(d.o)), ...inProgressOrders.map(groupOf)]);
  const groups = [...groupNames].map(group => {
    const done = doneInMonth.filter(d => groupOf(d.o) === group);
    const companyReg = done.some(d => isCompanyReg(d.o)) || inProgressOrders.some(o => groupOf(o) === group && isCompanyReg(o));
    const days = done.map(d => d.days);
    const enough = !companyReg && days.length >= MIN_CYCLE_SAMPLES;
    return {
      group,
      done: done.length,
      medianDays: enough ? round1(median(days)) : null,
      maxDays: enough ? round1(Math.max(...days)) : null,
      inProgress: inProgressOrders.filter(o => groupOf(o) === group).length,
      note: companyReg ? "几种服务共用一套流程，周期先不算" : done.length > 0 && !enough ? `少于 ${MIN_CYCLE_SAMPLES} 单，只列单数` : "",
    };
  }).sort((a, b) => b.done - a.done || b.inProgress - a.inProgress);

  const cycleAll = doneInMonth.filter(d => !isCompanyReg(d.o)).map(d => d.days);

  // 月份下拉：最早一单所在月到现在
  const firstCreated = orders.map(o => parseDbTime(o.created_at)).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] || now;
  const months: string[] = [];
  for (let k = bkkMonthKey(firstCreated); k <= bkkMonthKey(now); ) {
    months.push(k);
    const [yy, mm] = k.split("-").map(Number);
    k = mm === 12 ? `${yy + 1}-01` : `${yy}-${pad(mm + 1)}`;
  }

  return {
    month,
    months: months.reverse(),
    asOf: bkkDateKey(now),
    summary: {
      done: doneInMonth.length,
      medianDays: cycleAll.length >= MIN_CYCLE_SAMPLES ? round1(median(cycleAll)) : null,
      inProgress: inProgressOrders.length,
      blockedOrders: blockedOrders.size,
      overdue: overdue.length,
      coverage: monthSteps ? Math.round((monthStepsWithStart / monthSteps) * 100) : null,
      batchSteps,
      cancelledTotal: orders.length - live.length,
    },
    groups,
    slowSteps,
    load,
    overdue,
  };
}
