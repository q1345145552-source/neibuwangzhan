import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可导出" }, { status: 403 });

  const db = getDb();
  const month = new URL(req.url).searchParams.get("month") || new Date().toISOString().slice(0, 7);

  const rows = db.prepare(
    "SELECT employee_name, leave_type, start_date, end_date, start_time, end_time, reason, destination, status, rejection_reason, approved_by, approved_at, created_at FROM leave_requests WHERE start_date LIKE ? ORDER BY start_date"
  ).all(month + "%") as any[];

  // CSV header
  const headers = ["姓名","请假类型","开始日期","结束日期","开始时间","结束时间","原因","目的地","状态","驳回原因","审批人","审批时间","提交时间"];
  const csvRows = [headers.join(",")];

  for (const r of rows) {
    csvRows.push([
      `"${(r.employee_name || "").replace(/"/g,'""')}"`,
      `"${(r.leave_type || "")}"`,
      `"${r.start_date || ""}"`,
      `"${r.end_date || ""}"`,
      `"${r.start_time || "09:00"}"`,
      `"${r.end_time || "17:00"}"`,
      `"${(r.reason || "").replace(/"/g,'""')}"`,
      `"${(r.destination || "").replace(/"/g,'""')}"`,
      `"${r.status || ""}"`,
      `"${(r.rejection_reason || "").replace(/"/g,'""')}"`,
      `"${r.approved_by || ""}"`,
      `"${r.approved_at || ""}"`,
      `"${r.created_at || ""}"`,
    ].join(","));
  }

  const csv = "\uFEFF" + csvRows.join("\n"); // BOM for Excel Chinese support
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leave_report_${month}.csv"`,
    },
  });
}
