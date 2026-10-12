import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { bangkokDayRange } from "@/lib/time";

// 曼谷日期往前推 n 天（纯日历运算）
function dateMinusOne(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
}

// 一条操作日志 → 一句能看懂的话，如「新建订单 12号」「处理工单 45号」
function toSentence(action: string, targetId: string): string {
  let s = String(action || "操作").trim();
  const tid = String(targetId || "").trim();
  if (tid) {
    s += ` ${tid}${/^\d+$/.test(tid) ? "号" : ""}`;
  }
  return s;
}

// GET /api/work-reports/auto?date=YYYY-MM-DD — 自动带出：当天系统操作 + 前一天的明日计划
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const date = (searchParams.get("date") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "日期格式不对" }, { status: 400 });

  const db = getDb();
  const { start, end } = bangkokDayRange(date);

  // 该员工当天的系统操作（排除考勤/请假/日报本身这类非业务动作）
  const logs = db.prepare(
    `SELECT action, target_id FROM audit_logs
     WHERE actor = ? AND created_at >= ? AND created_at < ?
       AND target_type NOT IN ('attendance', 'attendance_request', 'leave', 'work_report')
       AND action != '系统' AND action != ''
     ORDER BY created_at ASC, id ASC`
  ).all(auth.name, start, end) as { action: string; target_id: string }[];

  // 转成一句话并去重（同一天里反复编辑同一条订单只算一条）
  const seen = new Set<string>();
  const system_items: string[] = [];
  for (const l of logs) {
    const sentence = toSentence(l.action, l.target_id);
    if (!sentence || seen.has(sentence)) continue;
    seen.add(sentence);
    system_items.push(sentence);
  }

  // 前一天的明日计划，给员工对照「昨天计划的今天做了没」
  const prevDate = dateMinusOne(date);
  const prev = db.prepare("SELECT tomorrow_plan FROM work_reports WHERE employee_name = ? AND report_date = ?").get(auth.name, prevDate) as { tomorrow_plan: string } | undefined;
  const prev_plan = prev?.tomorrow_plan || "";

  return NextResponse.json({ system_items, prev_plan });
}
