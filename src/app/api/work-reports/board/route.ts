import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { bangkokToday } from "@/lib/time";

// GET /api/work-reports/board?date=YYYY-MM-DD — 老板看板：某一天所有在职员工的提交状态（仅管理员）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可查看" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const date = (searchParams.get("date") || "").trim() || bangkokToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "日期格式不对" }, { status: 400 });

  const db = getDb();

  const employees = db.prepare(
    "SELECT name FROM employees WHERE role = 'employee' AND status = '在职' ORDER BY name"
  ).all() as { name: string }[];

  const reports = db.prepare("SELECT * FROM work_reports WHERE report_date = ?").all(date) as any[];
  const byName = new Map(reports.map((r) => [r.employee_name, r]));

  const rows = employees
    .map((e) => ({ name: e.name, report: byName.get(e.name) || null }))
    .sort((a, b) => {
      // 有风险标记的日报置顶，其余按姓名排
      const ra = a.report?.risk_flag === 1 ? 0 : 1;
      const rb = b.report?.risk_flag === 1 ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name, "zh");
    });
  return NextResponse.json({ date, today: bangkokToday(), employees: rows });
}
