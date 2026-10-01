import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { bangkokToday, bangkokDayRange } from "@/lib/time";

// 曼谷时区 N 天前的日期（YYYY-MM-DD）
function daysAgo(n: number): string {
  return new Date(Date.now() + 7 * 3600 * 1000 - n * 86400000).toISOString().split("T")[0];
}

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

  // 时间范围：今天 / 最近7天 / 最近30天，按曼谷时区零点
  const today = bangkokToday();
  const { end } = bangkokDayRange(today);
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 1;
  const startDate = daysAgo(days - 1);
  const { start } = bangkokDayRange(startDate);

  // 统计卡片（范围内全量，不受员工/分类筛选影响）
  const total = (db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE created_at >= ? AND created_at < ?").get(start, end) as { c: number }).c;
  const active = (db.prepare("SELECT COUNT(DISTINCT actor) AS c FROM audit_logs WHERE created_at >= ? AND created_at < ? AND actor != ''").get(start, end) as { c: number }).c;
  const ranking = db.prepare(
    "SELECT actor, COUNT(*) AS count FROM audit_logs WHERE created_at >= ? AND created_at < ? AND actor != '' GROUP BY actor ORDER BY count DESC, actor ASC"
  ).all(start, end);

  // 范围内出现的分类（供筛选下拉）
  const categories = db.prepare(
    "SELECT target_type FROM audit_logs WHERE created_at >= ? AND created_at < ? AND target_type != '' GROUP BY target_type ORDER BY target_type ASC"
  ).all(start, end).map((r: any) => r.target_type);

  // 时间线：范围内 + 员工/分类筛选，按时间倒序（最新在上）
  let tlSql = "SELECT id, actor, action, target_type, target_id, created_at FROM audit_logs WHERE created_at >= ? AND created_at < ?";
  const tlParams: unknown[] = [start, end];
  if (employee) { tlSql += " AND actor = ?"; tlParams.push(employee); }
  if (category) { tlSql += " AND target_type = ?"; tlParams.push(category); }
  tlSql += " ORDER BY created_at DESC, id DESC LIMIT 300";
  const timeline = db.prepare(tlSql).all(...tlParams);

  // 所有在职员工（含没操作的），每人在范围内操作数（含 0）
  const employees = db.prepare(
    `SELECT e.name, COUNT(a.id) AS count
     FROM employees e
     LEFT JOIN audit_logs a ON a.actor = e.name AND a.created_at >= ? AND a.created_at < ?
     WHERE e.status = '在职' AND e.role IN ('admin','employee')
     GROUP BY e.name
     ORDER BY count DESC, e.name ASC`
  ).all(start, end);

  return NextResponse.json({ today, range, total, active, ranking, categories, timeline, employees });
}
