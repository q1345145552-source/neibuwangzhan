import { withWorkReportSeen } from "@/lib/work-report-seen";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";

// 解析 related_objects JSON → [{type, id}]
function parseRelated(s: string): { type: string; id: string }[] {
  try {
    const a = JSON.parse(s || "[]");
    if (!Array.isArray(a)) return [];
    return a
      .map((o: Record<string, unknown>) => ({ type: String(o?.type || ""), id: String(o?.id ?? "") }))
      .filter((o) => o.type && o.id);
  } catch { return []; }
}

// GET /api/work-reports/story?type=project|customer|order&id=xxx — 按业务对象看日报时间线
// 老板看围绕该对象的所有人日报；员工只看自己的
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const type = (searchParams.get("type") || "").trim();
  const id = (searchParams.get("id") || "").trim();
  if (!["project", "customer", "order"].includes(type) || !id) {
    return NextResponse.json({ error: "参数不对" }, { status: 400 });
  }

  const db = getDb();
  const isAdmin = auth.role === "admin";
  const rows = (isAdmin
    ? db.prepare("SELECT * FROM work_reports ORDER BY report_date ASC, id ASC").all()
    : db.prepare("SELECT * FROM work_reports WHERE employee_name = ? ORDER BY report_date ASC, id ASC").all(auth.name)) as any[];

  const timeline = rows.filter((r) => parseRelated(r.related_objects).some((o) => o.type === type && o.id === id));
  return NextResponse.json(withWorkReportSeen(db,timeline), {headers:{"Cache-Control":"private, no-store"}});
}
