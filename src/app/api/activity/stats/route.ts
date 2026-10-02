import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { bangkokToday, bangkokDayRange, toThaiDate } from "@/lib/time";

// 曼谷时区 N 天前的日期（YYYY-MM-DD）
function daysAgo(n: number): string {
  return new Date(Date.now() + 7 * 3600 * 1000 - n * 86400000).toISOString().split("T")[0];
}

// target_type → 工作类型中文分类
function mapCategory(tt: string): string | null {
  if (tt === "order" || tt === "step") return "订单更新";
  if (tt === "todo") return "待办跟进";
  if (tt === "problem" || tt === "issue") return "问题处理";
  if (tt === "attendance") return "打卡";
  if (tt === "leave") return "请假";
  return null;
}

// 解析日志 target → 跳转链接 + 父级标识（订单号 / 柜号等）
function resolveTarget(db: ReturnType<typeof getDb>, tt: string, tid: string): { href: string; parent_label: string } {
  const none = { href: "", parent_label: "" };
  if (!tt || !tid) return none;
  // 订单本体
  if (tt === "order") return { href: `/orders/${tid}`, parent_label: `订单 ${tid}` };
  // 订单子记录（步骤/步骤备注/步骤文件/文档/费用/证书）→ 归属订单
  if (["step", "step_note", "step_document", "document", "finance", "certificate"].includes(tt)) {
    let orderId = "";
    if (tt === "step") orderId = (db.prepare("SELECT order_id FROM order_steps WHERE id = ?").get(Number(tid)) as { order_id: string } | undefined)?.order_id || "";
    else if (tt === "step_note") orderId = (db.prepare("SELECT order_id FROM step_notes WHERE id = ?").get(Number(tid)) as { order_id: string } | undefined)?.order_id || "";
    else if (tt === "step_document") orderId = (db.prepare("SELECT order_id FROM step_documents WHERE id = ?").get(Number(tid)) as { order_id: string } | undefined)?.order_id || "";
    else if (tt === "document") orderId = (db.prepare("SELECT order_id FROM documents WHERE id = ?").get(Number(tid)) as { order_id: string } | undefined)?.order_id || "";
    else if (tt === "finance") orderId = (db.prepare("SELECT order_id FROM finances WHERE id = ?").get(Number(tid)) as { order_id: string } | undefined)?.order_id || "";
    else if (tt === "certificate") orderId = (db.prepare("SELECT order_id FROM certificates WHERE id = ?").get(Number(tid)) as { order_id: string } | undefined)?.order_id || "";
    // document 的 target_id 有时直接是订单号（例如「添加文档」）
    if (!orderId && tt === "document") orderId = tid;
    if (orderId) return { href: `/orders/${orderId}`, parent_label: `订单 ${orderId}` };
    return none;
  }
  // 物流（柜号）
  if (tt === "logistics" || tt === "logistics_note") return { href: `/logistics/${tid}`, parent_label: "" };
  if (tt === "logistics_step" || tt === "logistics_file") {
    const r = (tt === "logistics_step"
      ? db.prepare("SELECT so.id AS lid, so.cabinet_number FROM shipping_steps s JOIN shipping_orders so ON so.id = s.order_id WHERE s.id = ?").get(Number(tid))
      : db.prepare("SELECT so.id AS lid, so.cabinet_number FROM shipping_order_files f JOIN shipping_orders so ON so.id = f.order_id WHERE f.id = ?").get(Number(tid))) as { lid: number; cabinet_number: string } | undefined;
    if (r?.lid) return { href: `/logistics/${r.lid}`, parent_label: `柜号 ${r.cabinet_number || r.lid}` };
    return none;
  }
  // 待办 / 问题 / 工单 / 考勤 / 请假
  if (tt === "todo") return { href: "/todos", parent_label: "" };
  if (tt === "problem") return { href: `/problems/${tid}`, parent_label: "" };
  if (tt === "issue") return { href: "/internal", parent_label: "" };
  if (tt === "attendance" || tt === "attendance_request") return { href: "/internal", parent_label: "" };
  if (tt === "leave") return { href: "/internal/leave-dashboard", parent_label: "" };
  // 客户 / 项目 / 达人
  if (tt === "customer") return { href: `/customers/${tid}`, parent_label: "" };
  if (tt === "project") return { href: `/projects/${tid}`, parent_label: "" };
  if (tt === "influencer") return { href: `/agency/influencers/${tid}`, parent_label: "" };
  return none;
}

// 员工动态只统计普通员工（role=employee 且在職）；老板/管理员等管理层账号不计入
const STAFF_FILTER = "actor IN (SELECT name FROM employees WHERE role = 'employee' AND status = '在职')";

// GET /api/activity/stats?range=today|7d|30d&employee=&category= — 员工动态统计 + 时间线（仅管理员）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可查看" }, { status: 403 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") || "today";
  const employee = searchParams.get("employee") || "";
  const category = searchParams.get("category") || "";

  // 时间范围：今天 / 昨天 / 最近7天 / 最近30天，按曼谷时区零点
  const today = bangkokToday();
  let start: string, end: string;
  if (range === "yesterday") {
    const y = bangkokDayRange(daysAgo(1));
    start = y.start;
    end = y.end;
  } else {
    end = bangkokDayRange(today).end;
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 1;
    start = bangkokDayRange(daysAgo(days - 1)).start;
  }

  // 统计卡片（范围内普通员工全量，不受员工/分类筛选影响）
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE created_at >= ? AND created_at < ? AND ${STAFF_FILTER}`).get(start, end) as { c: number }).c;
  const active = (db.prepare(`SELECT COUNT(DISTINCT actor) AS c FROM audit_logs WHERE created_at >= ? AND created_at < ? AND ${STAFF_FILTER}`).get(start, end) as { c: number }).c;
  const ranking = db.prepare(
    `SELECT actor, COUNT(*) AS count FROM audit_logs WHERE created_at >= ? AND created_at < ? AND ${STAFF_FILTER} GROUP BY actor ORDER BY count DESC, actor ASC`
  ).all(start, end);

  // 范围内出现的分类（供筛选下拉）
  const categories = db.prepare(
    `SELECT target_type FROM audit_logs WHERE created_at >= ? AND created_at < ? AND target_type != '' AND ${STAFF_FILTER} GROUP BY target_type ORDER BY target_type ASC`
  ).all(start, end).map((r: any) => r.target_type);

  // 时间线：范围内普通员工 + 员工/分类筛选，按时间倒序（最新在上）
  let tlSql = `SELECT id, actor, action, target_type, target_id, detail, created_at FROM audit_logs WHERE created_at >= ? AND created_at < ? AND ${STAFF_FILTER}`;
  const tlParams: unknown[] = [start, end];
  if (employee) { tlSql += " AND actor = ?"; tlParams.push(employee); }
  if (category) { tlSql += " AND target_type = ?"; tlParams.push(category); }
  tlSql += " ORDER BY created_at DESC, id DESC LIMIT 300";
  const timeline = (db.prepare(tlSql).all(...tlParams) as any[]).map((t) => {
    const r = resolveTarget(db, t.target_type, t.target_id);
    return { ...t, href: r.href, parent_label: r.parent_label };
  });

  // 昨天范围（对比用）
  const yesterdayDate = daysAgo(1);
  const { start: yStart, end: yEnd } = bangkokDayRange(yesterdayDate);

  // 所有在职员工（含没操作的），每人：今天操作数、昨天操作数、各工作类型数量
  const rows = db.prepare(
    `SELECT e.name, COUNT(a.id) AS count
     FROM employees e
     LEFT JOIN audit_logs a ON a.actor = e.name AND a.created_at >= ? AND a.created_at < ?
     WHERE e.status = '在职' AND e.role = 'employee'
     GROUP BY e.name
     ORDER BY count DESC, e.name ASC`
  ).all(start, end);

  // 每个员工最近一次操作时间（全量历史，用于活跃度预警）
  const lastActiveMap = new Map<string, string>(
    (db.prepare(
      "SELECT actor, MAX(created_at) AS last_active FROM audit_logs WHERE actor != '' GROUP BY actor"
    ).all() as { actor: string; last_active: string }[]).map((r) => [r.actor, r.last_active])
  );

  const employees = rows.map((emp: any) => {
    const yesterday = (db.prepare(
      "SELECT COUNT(*) AS c FROM audit_logs WHERE actor = ? AND created_at >= ? AND created_at < ?"
    ).get(emp.name, yStart, yEnd) as { c: number }).c;
    const typeRows = db.prepare(
      "SELECT target_type, COUNT(*) AS c FROM audit_logs WHERE actor = ? AND created_at >= ? AND created_at < ? GROUP BY target_type"
    ).all(emp.name, start, end);
    const types: Record<string, number> = { "订单更新": 0, "待办跟进": 0, "问题处理": 0, "打卡": 0, "请假": 0 };
    for (const t of typeRows as { target_type: string; c: number }[]) {
      const cat = mapCategory(t.target_type);
      if (cat) types[cat] += t.c;
    }
    // 最近一次操作对应的曼谷日期；超过三天无操作（最近一次在 3 天及以前，或从未操作）→ 预警
    const lastActive = lastActiveMap.get(emp.name) || null;
    const lastActiveDate = lastActive ? toThaiDate(lastActive) : null;
    const inactive = !lastActiveDate || lastActiveDate <= daysAgo(3);
    return { name: emp.name, count: emp.count, yesterday, types, lastActiveDate, inactive };
  });

  return NextResponse.json({ today, range, total, active, ranking, categories, timeline, employees });
}
