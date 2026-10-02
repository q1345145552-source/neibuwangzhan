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
  let tlSql = `SELECT id, actor, action, target_type, target_id, created_at FROM audit_logs WHERE created_at >= ? AND created_at < ? AND ${STAFF_FILTER}`;
  const tlParams: unknown[] = [start, end];
  if (employee) { tlSql += " AND actor = ?"; tlParams.push(employee); }
  if (category) { tlSql += " AND target_type = ?"; tlParams.push(category); }
  tlSql += " ORDER BY created_at DESC, id DESC LIMIT 300";
  const timeline = db.prepare(tlSql).all(...tlParams);

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
