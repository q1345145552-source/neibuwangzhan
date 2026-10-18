import type Database from "better-sqlite3";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OFFSET = 7 * HOUR;
export const SUPERVISION_POLICY = {
  timezone: "Asia/Bangkok",
  leave_statuses: ["待审批", "已通过"],
  full_day_leave: "覆盖09:00–17:00的请假日按整天扣除，其余按实际起止时段；重叠时段不重复扣除",
  report_history: "从入职日期与账号建档日期中较晚者开始，未补交的历史日期持续列出",
  meeting_deadline: "会议当天17:00；现有表没有会议结束时间，尚未到开始时间的会议不列出",
  duration_basis: "逾期时长扣除曼谷周日及请假时段；日报与会议在有请假记录的当天整天豁免",
  notification_complete: "已打印、有照片且已提交；打回视为未落实",
} as const;

type Interval = { start: number; end: number };
export interface SupervisionLeave {
  employee_name: string; status: string; start_date: string; end_date: string;
  start_time: string | null; end_time: string | null;
}
interface Employee { id: number; name: string; hire_date: string | null; created_at: string }
type Category = "todo" | "report" | "meeting" | "notice";
const LABELS = { todo: "待办", report: "日报", meeting: "会议", notice: "通知" } as const;
export interface SupervisionOverdue {
  id: string; employee_id: number; employee_name: string; category: Category;
  category_label: string; source_id: number | string; title: string; business_date?: string;
  deadline_at: string; deadline_bangkok: string; overdue_seconds: number;
  elapsed_overdue_seconds: number; overdue_duration: string;
}

/** 数据库存 UTC；有显式时区的历史 ISO 时间保留自身时区。 */
export function supervisionTimestamp(value: string): number {
  const normalized = value.trim().replace(" ", "T");
  if (!normalized) return NaN;
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : normalized + "Z");
}
function bkkDate(ms: number): string { return new Date(ms + OFFSET).toISOString().slice(0, 10); }
function localMidnight(date: string): number { return Date.parse(date + "T00:00:00+07:00"); }
function validDate(date: string | null): date is string {
  return !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(localMidnight(date)) && bkkDate(localMidnight(date)) === date;
}
function timeOffset(time: string | null, fallback: string): number {
  const value = time || fallback;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN;
  return Number(value.slice(0, 2)) * HOUR + Number(value.slice(3)) * 60_000;
}
function merge(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const interval of intervals.sort((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else result.push({ ...interval });
  }
  return result;
}

export function supervisionCalendar(leaves: SupervisionLeave[]) {
  const daily = new Map<number, Interval[]>();
  const exemptDates = new Set<string>();
  for (const leave of leaves) {
    if (leave.status !== "待审批" && leave.status !== "已通过") continue;
    if (!validDate(leave.start_date) || !validDate(leave.end_date) || leave.end_date < leave.start_date) continue;
    const startOffset = timeOffset(leave.start_time, "09:00"), endOffset = timeOffset(leave.end_time, "17:00");
    if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset)) continue;
    if (leave.start_date === leave.end_date && endOffset <= startOffset) continue;
    for (let day = localMidnight(leave.start_date), last = localMidnight(leave.end_date); day <= last; day += DAY) {
      const date = bkkDate(day);
      exemptDates.add(date);
      const from = date === leave.start_date ? startOffset : 0;
      const to = date === leave.end_date ? endOffset : DAY;
      const ranges = daily.get(day) ?? [];
      ranges.push({ start: day + from, end: day + to });
      daily.set(day, ranges);
    }
  }
  const intervals: Interval[] = [];
  for (const [day, ranges] of daily) {
    const combined = merge(ranges);
    // 一天分两次请半天也算整天；先合并再判断，避免重复扣除。
    if (combined.some(range => range.start <= day + 9 * HOUR && range.end >= day + 17 * HOUR)) intervals.push({ start: day, end: day + DAY });
    else intervals.push(...combined);
  }
  return { intervals: merge(intervals), exemptDates };
}

/** 以曼谷自然日切片，扣除周日和请假区间的并集，不把全天或重叠请假重复相加。 */
export function supervisionClock(start: number, end: number, pauses: Interval[], budget = 0): { elapsed: number; deadline: number | null } {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return { elapsed: 0, deadline: null };
  let elapsed = 0, deadline: number | null = null, pauseIndex = 0;
  for (let day = localMidnight(bkkDate(start)); day < end; day += DAY) {
    if (new Date(day + OFFSET).getUTCDay() === 0) continue;
    let cursor = Math.max(start, day);
    const limit = Math.min(end, day + DAY);
    const add = (until: number) => {
      if (until <= cursor) return;
      if (budget > 0 && deadline === null && elapsed + until - cursor >= budget) deadline = cursor + budget - elapsed;
      elapsed += until - cursor;
      cursor = until;
    };
    while (pauseIndex < pauses.length && pauses[pauseIndex].end <= cursor) pauseIndex++;
    for (let i = pauseIndex; i < pauses.length && pauses[i].start < limit; i++) {
      const pause = pauses[i];
      add(Math.min(limit, Math.max(cursor, pause.start)));
      cursor = Math.min(limit, Math.max(cursor, pause.end));
    }
    add(limit);
  }
  return { elapsed, deadline };
}
function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "不足1分钟";
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时${minutes % 60 ? ` ${minutes % 60}分钟` : ""}`;
  return `${Math.floor(hours / 24)}天 ${hours % 24}小时`;
}
function stringArray(raw: string): string[] {
  try { const parsed: unknown = JSON.parse(raw); return Array.isArray(parsed) ? [...new Set(parsed.filter((v): v is string => typeof v === "string" && !!v.trim()).map(v => v.trim()))] : []; }
  catch { return []; }
}

/** 只读计算；不调用任何会生成待办/通知的提醒同步函数。now仅供服务器及固定时钟测试注入。 */
export function bossSupervisionOverdues(db: Database.Database, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error("无效的监督计算时间");
  const today = bkkDate(now);
  const employees = db.prepare("SELECT id, name, hire_date, created_at FROM employees WHERE role='employee' AND status != '离职' ORDER BY id").all() as Employee[];
  const byName = new Map(employees.map(employee => [employee.name, employee]));
  const byId = new Map(employees.map(employee => [employee.id, employee]));
  const leaves = db.prepare("SELECT employee_name, status, start_date, end_date, start_time, end_time FROM leave_requests WHERE status IN ('待审批','已通过')").all() as SupervisionLeave[];
  const calendars = new Map(employees.map(e => [e.id, supervisionCalendar(leaves.filter(l => l.employee_name === e.name))]));
  const overdues: SupervisionOverdue[] = [];
  // 历史日报逐日追溯，但每个员工的每天只累计一次，避免历史越长重复计算越多。
  const suffixes = new Map<number, { from: number; totals: Map<number, number> }>();
  function fixedElapsed(employee: Employee, deadline: number): number {
    const pauses = calendars.get(employee.id)!.intervals;
    const day = localMidnight(bkkDate(deadline));
    const nextDay = day + DAY;
    if (nextDay >= now) return supervisionClock(deadline, now, pauses).elapsed;
    let cache = suffixes.get(employee.id);
    if (!cache) {
      const from = localMidnight(today);
      cache = { from, totals: new Map([[from, supervisionClock(from, now, pauses).elapsed]]) };
      suffixes.set(employee.id, cache);
    }
    while (cache.from > nextDay) {
      const previous = cache.from - DAY;
      cache.totals.set(previous, cache.totals.get(cache.from)! + supervisionClock(previous, cache.from, pauses).elapsed);
      cache.from = previous;
    }
    return supervisionClock(deadline, nextDay, pauses).elapsed + cache.totals.get(nextDay)!;
  }
  function add(employee: Employee, category: Category, source: number | string, title: string, deadline: number, overdue: number, date?: string) {
    overdues.push({ id: `${category}:${employee.id}:${source}`, employee_id: employee.id, employee_name: employee.name,
      category, category_label: LABELS[category], source_id: source, title, ...(date ? { business_date: date } : {}),
      deadline_at: new Date(deadline).toISOString(), deadline_bangkok: new Date(deadline + OFFSET).toISOString().slice(0, 19).replace("T", " "),
      overdue_seconds: Math.max(0, Math.floor(overdue / 1000)), elapsed_overdue_seconds: Math.max(0, Math.floor((now - deadline) / 1000)), overdue_duration: duration(overdue / 1000) });
  }
  function timed(employee: Employee, category: "todo" | "notice", id: number, title: string, created: string, hours: number) {
    const clock = supervisionClock(supervisionTimestamp(created), now, calendars.get(employee.id)!.intervals, hours * HOUR);
    if (clock.deadline !== null) add(employee, category, id, title, clock.deadline, clock.elapsed - hours * HOUR);
  }
  const todos = db.prepare("SELECT id, content, assignee, created_at FROM todos WHERE status != '已完成'").all() as { id: number; content: string; assignee: string; created_at: string }[];
  for (const todo of todos) { const e = byName.get(todo.assignee); if (e) timed(e, "todo", todo.id, todo.content, todo.created_at, 24); }

  const reports = new Set((db.prepare("SELECT employee_name, report_date FROM work_reports WHERE status='已提交'").all() as { employee_name: string; report_date: string }[]).map(r => `${r.employee_name}\0${r.report_date}`));
  for (const e of employees) {
    const calendar = calendars.get(e.id)!;
    const created = supervisionTimestamp(e.created_at);
    const accountDate = Number.isFinite(created) ? bkkDate(created) : today;
    const since = validDate(e.hire_date) && e.hire_date > accountDate ? e.hire_date : accountDate;
    for (let day = localMidnight(since), last = localMidnight(today); day <= last; day += DAY) {
      const date = bkkDate(day), deadline = day + 17 * HOUR;
      if (new Date(day + OFFSET).getUTCDay() === 0 || calendar.exemptDates.has(date) || now <= deadline || reports.has(`${e.name}\0${date}`)) continue;
      add(e, "report", date, `${date}的日报`, deadline, fixedElapsed(e, deadline), date);
    }
  }
  const reflections = new Set((db.prepare("SELECT DISTINCT meeting_id, employee_name FROM meeting_reflections WHERE status='已提交'").all() as { meeting_id: number; employee_name: string }[]).map(r => `${r.meeting_id}\0${r.employee_name}`));
  const meetings = db.prepare("SELECT id, title, meeting_date, meeting_time, participants FROM meetings WHERE meeting_date <= ?").all(today) as { id: number; title: string; meeting_date: string; meeting_time: string; participants: string }[];
  for (const meeting of meetings) {
    if (!validDate(meeting.meeting_date)) continue;
    const day = localMidnight(meeting.meeting_date), deadline = day + 17 * HOUR;
    const start = timeOffset(meeting.meeting_time, "00:00");
    if (new Date(day + OFFSET).getUTCDay() === 0 || now <= deadline || (Number.isFinite(start) && now < day + start)) continue;
    for (const name of stringArray(meeting.participants)) {
      const e = byName.get(name);
      if (!e || reflections.has(`${meeting.id}\0${name}`)) continue;
      const calendar = calendars.get(e.id)!;
      if (!calendar.exemptDates.has(meeting.meeting_date)) add(e, "meeting", meeting.id, meeting.title, deadline, fixedElapsed(e, deadline), meeting.meeting_date);
    }
  }
  const notices = db.prepare(`SELECT n.id, n.title, n.published_at, r.employee_id, r.printed, r.photos, r.submitted_at, r.review_status
    FROM notice_rules n JOIN notice_rule_implementations r ON r.notice_id=n.id`).all() as { id: number; title: string; published_at: string; employee_id: number; printed: number; photos: string; submitted_at: string | null; review_status: string }[];
  for (const notice of notices) {
    const e = byId.get(notice.employee_id);
    if (!e || (notice.printed && notice.submitted_at && stringArray(notice.photos).length > 0 && notice.review_status !== "打回")) continue;
    timed(e, "notice", notice.id, notice.title, notice.published_at, 12);
  }
  overdues.sort((a, b) => b.overdue_seconds - a.overdue_seconds || a.id.localeCompare(b.id));
  const counts = { todo: 0, report: 0, meeting: 0, notice: 0 };
  for (const entry of overdues) counts[entry.category]++;
  return { generated_at: new Date(now).toISOString(), timezone: SUPERVISION_POLICY.timezone, policies: SUPERVISION_POLICY, total: overdues.length, counts, overdues };
}
