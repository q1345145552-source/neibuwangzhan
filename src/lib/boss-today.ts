import type Database from "better-sqlite3";
import { reportSubmissionRevision } from "./boss-submission-types";
import { bossPendingSubmissions, type BossPendingItem } from "./boss-submissions";
import { WORK_REPORT_REQUIRED_FROM } from "./work-report-policy";

/**
 * 老板今日：每天 5–10 分钟看完的一屏。只读聚合，不写任何业务表。
 * 只挑“需要老板出手”的事：等拍板的、卡住的、员工提出的问题、连续没做到的；
 * 正常日报只给一个“全部标为已看”的批量入口。
 */

export const STUCK_DAYS = 7;          // 当前步骤超过这么多天没动静算卡住
export const ISSUE_STUCK_DAYS = 3;    // 工单超过这么多天还没解决算卡住
export const STALE_TODO_DAYS = 14;    // 待办超过这么多天算拖了很久
const ACTIVE = "('在职','试用期','待离职')";

export const DONE_NOT_CLOSED_DAYS = 3; // 步骤全部办完、订单还没结单超过这么多天
export const COMPLETED_TODO_DAYS = 7;  // 员工完成你派的待办，最近这么多天内的拿出来给你确认

/**
 * “遇到的问题”里写的是不是“没有问题”。按线上实际写法整理（2026-11）：
 * 没有 / ไม่มี / ไม่พบปัญหา(没发现问题) / ไม่มีปัญหา / -，以及“暂时没有”“ไม่มีปัญหาค่ะ”这类加前缀、语气词的说法。
 * 只认整段都是这些话的；只要多写了一点实际内容，就当作提了问题，宁可多显示也不漏。
 */
const NO_PROBLEM_PREFIX = /^(暂时|目前|今天|今日|暂|还|也|基本|วันนี้|ตอนนี้|ยัง)+/;
const NO_PROBLEM_SUFFIX = /(的|呢|哦|啊|了|ค่ะ|คะ|ค่า|ครับ|คับ|นะคะ|นะครับ|นะ|จ้า|จ้ะ|เลย|ใดๆ|อะไร)+$/;
const NO_PROBLEM_WORDS = new Set([
  "", "无", "没", "没有", "暂无", "无问题", "没问题", "没有问题", "没什么问题", "没有什么问题", "无异常", "没有异常", "正常", "一切正常", "一切顺利", "顺利",
  "ไม่มี", "ไม่มีปัญหา", "ไม่พบ", "ไม่พบปัญหา", "ปกติ", "ปัญหาที่พบ",
  "none", "no", "nothing", "na", "nil", "noproblem", "noproblems", "noissue", "noissues",
]);
export function hasRealProblem(text: string | null | undefined): boolean {
  if (!text) return false;
  let t = text.toLowerCase().replace(/[\s\-–—_.。,，、:：;；/!！~?？()（）"'“”‘’…*·•]+/g, "");
  for (let i = 0; i < 3; i++) t = t.replace(NO_PROBLEM_PREFIX, "").replace(NO_PROBLEM_SUFFIX, "");
  return !NO_PROBLEM_WORDS.has(t);
}

function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 曼谷日历上最近的 n 个工作日（周一到周六，跳过 thai_holidays），不含今天，从近到远。 */
export function recentWorkdays(db: Database.Database, today: string, n: number): string[] {
  let holidays = new Set<string>();
  try { holidays = new Set((db.prepare("SELECT date FROM thai_holidays").all() as { date: string }[]).map(h => h.date)); } catch { /* 老库没有假日表 */ }
  const out: string[] = [];
  for (let d = addDays(today, -1); out.length < n && d > addDays(today, -60); d = addDays(d, -1)) {
    if (new Date(d + "T00:00:00Z").getUTCDay() === 0 || holidays.has(d)) continue;
    out.push(d);
  }
  return out;
}

export interface StuckOrder {
  order_id: string; customer_name: string; business: string; step_name: string; step_status: string;
  /** 负责人不在在职名单里（离职、写错名字或没分配），这种单不会有人推进 */
  assignee: string; assignee_left: boolean; idle_days: number; href: string;
}
export interface StuckIssue { id: number; ticket_number: string; description: string; assignee: string; age_days: number; status: string; href: string }
export interface RaisedProblem { report_id: number; employee_name: string; report_date: string; problems: string; translated: boolean; href: string }
export interface MissPerson { name: string; no_attendance: boolean; no_report: boolean; report_miss_streak: number }
export interface CompletedTodo { id: number; content: string; assignee: string; created_by: string; completed_at: string; href: string }
export interface ReportToClear { id: number; revision: string; employee_name: string; report_date: string; summary: string; ai_label: string; old: boolean }

export function bossToday(db: Database.Database, viewer: string, today: string) {
  const workdays = recentWorkdays(db, today, 6);
  const lastWorkday = workdays[0] ?? addDays(today, -1);

  // 1. 等你拍板：沿用监督看板的审批类数据，只取必须老板决定的几类。
  const pending = bossPendingSubmissions(db);
  const decisionCats = new Set(["leave", "attendance", "problem", "notice", "meeting"]);
  const decisions: BossPendingItem[] = pending.items.filter(item => decisionCats.has(item.category));

  // 2. 卡住的订单：每单取第一个未完成步骤；最近动静 = 订单更新、步骤开始/完成、步骤备注中最晚的一个。
  const activeNames = new Set((db.prepare(`SELECT name FROM employees WHERE status IN ${ACTIVE} AND name<>''`).all() as { name: string }[]).map(r => r.name.trim().toLowerCase()));
  const orderRows = db.prepare(`
    SELECT o.id order_id, COALESCE(o.customer_name,'') customer_name, COALESCE(bt.name,'') business,
      s.step_name, s.status step_status,
      -- 没有未完成步骤时（待结单），由最后一步的经办人去结单
      COALESCE(s.assignee, (SELECT l.assignee FROM order_steps l WHERE l.order_id=o.id ORDER BY l.step_order DESC LIMIT 1), '') step_assignee,
      COALESCE(o.responsible_person,'') responsible,
      (SELECT COUNT(*) FROM order_steps c WHERE c.order_id=o.id) step_count,
      julianday('now') - MAX(
        COALESCE(julianday(o.updated_at),0), COALESCE(julianday(o.created_at),0),
        COALESCE(julianday(s.started_at),0),
        COALESCE((SELECT MAX(julianday(x.completed_at)) FROM order_steps x WHERE x.order_id=o.id),0),
        COALESCE((SELECT MAX(julianday(n.created_at)) FROM step_notes n WHERE n.order_id=o.id),0)
      ) idle
    FROM orders o
    LEFT JOIN order_steps s ON s.id = (SELECT id FROM order_steps WHERE order_id=o.id AND status<>'已完成' ORDER BY step_order LIMIT 1)
    LEFT JOIN business_types bt ON bt.id=o.business_type_id
    WHERE o.status IN ('进行中','待处理')`).all() as {
      order_id: string; customer_name: string; business: string; step_name: string | null; step_status: string | null;
      step_assignee: string; responsible: string; step_count: number; idle: number;
    }[];
  const stuckOrders: StuckOrder[] = orderRows.map(r => {
    const assignee = (r.step_assignee || r.responsible).trim();
    const names = assignee.split(/[,，、/]/).map(s => s.trim()).filter(Boolean);
    // 没有未完成步骤：要么全部办完了还没结单，要么这个订单压根没生成步骤
    const stepName = r.step_name ?? (r.step_count ? "步骤都办完了，订单还没结单" : "这个订单没有办理步骤");
    const stepStatus = r.step_status ?? (r.step_count ? "待结单" : "无步骤");
    return {
      order_id: r.order_id, customer_name: r.customer_name, business: r.business, step_name: stepName, step_status: stepStatus,
      assignee: assignee || "未分配", assignee_left: names.length === 0 || names.every(n => !activeNames.has(n.toLowerCase())), idle_days: Math.floor(r.idle), href: `/orders/${encodeURIComponent(r.order_id)}`,
    };
  }).filter(o => o.step_status === "阻塞" || o.idle_days >= (o.step_status === "待结单" ? DONE_NOT_CLOSED_DAYS : STUCK_DAYS))
    .sort((a, b) => Number(b.step_status === "阻塞") - Number(a.step_status === "阻塞") || Number(b.assignee_left) - Number(a.assignee_left) || b.idle_days - a.idle_days);

  const stuckIssues: StuckIssue[] = (db.prepare(`SELECT id, COALESCE(ticket_number,'') ticket_number, COALESCE(NULLIF(description_zh,''),description,'') description,
      COALESCE(assignee,'') assignee, status, CAST(julianday('now')-julianday(created_at) AS INTEGER) age_days
    FROM issue_tickets WHERE status IN ('待处理','处理中') AND julianday('now')-julianday(created_at) >= ? ORDER BY created_at`).all(ISSUE_STUCK_DAYS) as Omit<StuckIssue, "href">[])
    .map(i => ({ ...i, description: i.description.slice(0, 200), href: `/issues?open=${i.id}` }));

  // 3. 员工提的问题 + 4. 需要清掉的日报：只看还没被老板看过的已提交日报。
  const unviewed = db.prepare(`SELECT r.id, r.employee_name, r.report_date, r.submitted_at, r.created_at, COALESCE(r.ai_label,'') ai_label,
      COALESCE(NULLIF(r.problems_zh,''), r.problems, '') problems, COALESCE(r.problems_zh,'')<>'' problems_translated, COALESCE(NULLIF(r.summary_zh,''), r.summary, '') summary
    FROM work_reports r LEFT JOIN boss_submission_state s ON s.category='report' AND s.source_id=r.id
    WHERE r.status='已提交' AND COALESCE(s.viewed_revision,'') <> COALESCE(NULLIF(r.submitted_at,''), r.created_at)
      AND NOT (s.generation IS NULL AND (COALESCE(r.boss_rating,0) > 0 OR TRIM(COALESCE(r.boss_comment,'')) <> ''))
    ORDER BY r.report_date DESC, r.id DESC`).all() as {
      id: number; employee_name: string; report_date: string; submitted_at: string; created_at: string; ai_label: string; problems: string; problems_translated: number; summary: string;
    }[];
  const recentFrom = addDays(today, -7);
  const raisedProblems: RaisedProblem[] = [];
  const reportsToClear: ReportToClear[] = [];
  for (const r of unviewed) {
    const revision = reportSubmissionRevision(r);
    if (r.report_date >= recentFrom && hasRealProblem(r.problems)) {
      raisedProblems.push({ report_id: r.id, employee_name: r.employee_name, report_date: r.report_date, problems: r.problems.slice(0, 400), translated: !!r.problems_translated, href: `/work-reports?report=${r.id}` });
    }
    reportsToClear.push({ id: r.id, revision, employee_name: r.employee_name, report_date: r.report_date, summary: r.summary.slice(0, 160), ai_label: r.ai_label, old: r.report_date < recentFrom });
  }

  // 5. 昨天谁没做到：只算该上班的员工（在职、已入职、当天没请假）。
  const people = db.prepare(`SELECT DISTINCT e.name FROM employees e WHERE e.role='employee' AND e.status IN ${ACTIVE} AND e.name<>''
      AND (COALESCE(e.hire_date,'')='' OR e.hire_date<=?) ORDER BY e.name`).all(lastWorkday) as { name: string }[];
  const onLeave = db.prepare("SELECT 1 FROM leave_requests WHERE employee_name=? AND status IN ('待审批','已通过') AND start_date<=? AND end_date>=?");
  const attended = db.prepare("SELECT 1 FROM attendance WHERE employee_name=? AND date=? AND COALESCE(check_in,'')<>''");
  const reported = db.prepare("SELECT 1 FROM work_reports WHERE employee_name=? AND report_date=? AND status='已提交'");
  const misses: MissPerson[] = [];
  for (const { name } of people) {
    if (onLeave.get(name, lastWorkday, lastWorkday)) continue;
    const reportRequired = lastWorkday >= WORK_REPORT_REQUIRED_FROM;
    const noAttendance = !attended.get(name, lastWorkday);
    const noReport = reportRequired && !reported.get(name, lastWorkday);
    let streak = 0;
    for (const day of workdays) {
      if (day < WORK_REPORT_REQUIRED_FROM || onLeave.get(name, day, day)) break;
      if (reported.get(name, day)) break;
      streak++;
    }
    if (noAttendance || noReport) misses.push({ name, no_attendance: noAttendance, no_report: noReport, report_miss_streak: streak });
  }

  // 6. 员工完成了老板（任一管理员）派的待办、还没人确认的：以前每条都推通知，现在集中在这里一次确认。
  const completedTodos: CompletedTodo[] = (db.prepare(`SELECT t.id, t.content, t.assignee, t.created_by, t.completed_at FROM todos t
      LEFT JOIN boss_submission_state s ON s.category='todo' AND s.source_id=t.id
      WHERE t.status='已完成' AND COALESCE(s.confirmed_at,'')=''
        AND julianday('now') - julianday(t.completed_at) <= ?
        AND EXISTS (SELECT 1 FROM employees a WHERE a.name=t.created_by AND a.role='admin')
        AND EXISTS (SELECT 1 FROM employees e WHERE e.name=t.assignee AND e.role='employee')
      ORDER BY t.completed_at DESC`).all(COMPLETED_TODO_DAYS) as Omit<CompletedTodo, "href">[])
    .map(t => ({ ...t, content: t.content.slice(0, 200), href: `/todos?todo=${t.id}` }));

  // 7. 待办：你自己的，和员工拖了很久的（只给数量，点进去处理）。
  const myTodos = db.prepare(`SELECT COUNT(*) total, SUM(julianday('now')-julianday(created_at) >= ?) stale FROM todos WHERE assignee=? AND status='未完成'`)
    .get(STALE_TODO_DAYS, viewer) as { total: number; stale: number | null };
  const teamStaleTodos = db.prepare(`SELECT assignee name, COUNT(*) count FROM todos t
      WHERE t.status='未完成' AND julianday('now')-julianday(t.created_at) >= 7 AND t.assignee<>?
        AND EXISTS (SELECT 1 FROM employees e WHERE e.name=t.assignee AND e.role='employee' AND e.status IN ${ACTIVE})
      GROUP BY assignee ORDER BY count DESC`).all(viewer) as { name: string; count: number }[];

  return {
    generated_at: new Date().toISOString(), today, last_workday: lastWorkday,
    decisions, stuck_orders: stuckOrders, stuck_issues: stuckIssues, raised_problems: raisedProblems,
    misses, reports_to_clear: reportsToClear, completed_todos: completedTodos,
    my_todos: { total: myTodos.total, stale: myTodos.stale ?? 0 }, team_stale_todos: teamStaleTodos,
  };
}
export type BossToday = ReturnType<typeof bossToday>;
