import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { bangkokToday } from "@/lib/time";

// 曼谷日期往前推 n 天（纯日历运算）
function bangkokDaysAgo(n: number): string {
  const d = new Date(bangkokToday() + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split("T")[0];
}

// GET /api/work-reports — 管理员看全部，员工看自己
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const isAdmin = auth.role === "admin";
  const rows = isAdmin
    ? db.prepare("SELECT * FROM work_reports ORDER BY report_date DESC, id DESC").all()
    : db.prepare("SELECT * FROM work_reports WHERE employee_name = ? ORDER BY report_date DESC, id DESC").all(auth.name);
  return NextResponse.json(rows);
}

// POST /api/work-reports — 员工提交今日 / 补交昨日工作记录
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const { report_date, completed_items, summary, tomorrow_plan, problems } = body;

  const today = bangkokToday();
  const yesterday = bangkokDaysAgo(1);

  if (!report_date || !String(report_date).trim()) return NextResponse.json({ error: "缺少日报日期" }, { status: 400 });
  const date = String(report_date).trim();
  if (date !== today && date !== yesterday) {
    return NextResponse.json({ error: "只能填今天或补交昨天" }, { status: 400 });
  }

  const existing = db.prepare("SELECT id FROM work_reports WHERE employee_name = ? AND report_date = ?").get(auth.name, date);
  if (existing) {
    return NextResponse.json({ error: date === today ? "今天已经提交过了" : "昨天已经提交过了" }, { status: 400 });
  }

  // 今日已完成：手动添加的工作项（至少一条）
  let items: string[] = [];
  if (Array.isArray(completed_items)) {
    items = completed_items.map((s: unknown) => String(s).trim()).filter(Boolean);
  } else if (typeof completed_items === "string") {
    try {
      const p = JSON.parse(completed_items);
      if (Array.isArray(p)) items = p.map((s: unknown) => String(s).trim()).filter(Boolean);
    } catch {}
  }
  if (items.length === 0) return NextResponse.json({ error: "请至少填写一条今日已完成" }, { status: 400 });

  const isBackfill = date === yesterday ? 1 : 0;
  const now = new Date().toISOString();
  const result = db.prepare(
    "INSERT INTO work_reports (employee_name, report_date, completed_items, summary, tomorrow_plan, problems, status, is_backfill, submitted_at) VALUES (?, ?, ?, ?, ?, ?, '已提交', ?, ?)"
  ).run(auth.name, date, JSON.stringify(items), String(summary || "").trim(), String(tomorrow_plan || "").trim(), String(problems || "").trim(), isBackfill, now);
  logOperation(auth.name, "提交工作记录", "work_report", String(result.lastInsertRowid), date);
  return NextResponse.json(db.prepare("SELECT * FROM work_reports WHERE id = ?").get(result.lastInsertRowid), { status: 201 });
}
