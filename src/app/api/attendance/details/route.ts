import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const employee = searchParams.get("employee") || auth.name;
  const month = searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const type = searchParams.get("type") || "";

  if (auth.role !== "admin" && employee !== auth.name) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const from = `${month}-01`;
  const to = `${month}-${String(lastDay).padStart(2, "0")}`;

  if (type === "supplement") {
    const rows = db.prepare(
      "SELECT * FROM attendance WHERE employee_name = ? AND date >= ? AND date <= ? AND type = '补签' ORDER BY date ASC"
    ).all(employee, from, to) as any[];
    // Also get supplement request reasons
    const enriched = rows.map((r: any) => {
      const req = db.prepare(
        "SELECT reason, photo FROM attendance_requests WHERE employee_name = ? AND date = ? AND status = '已通过' ORDER BY created_at DESC LIMIT 1"
      ).get(employee, r.date) as any;
      return { ...r, reason: req?.reason || "", request_photo: req?.photo || "" };
    });
    return NextResponse.json(enriched);
  }

  if (type === "leave") {
    const rows = db.prepare(
      "SELECT * FROM leave_requests WHERE employee_name = ? AND status = '已通过' AND start_date <= ? AND end_date >= ? ORDER BY start_date ASC"
    ).all(employee, to, from) as any[];
    return NextResponse.json(rows);
  }

  if (type === "late") {
    const rows = db.prepare(
      "SELECT * FROM attendance WHERE employee_name = ? AND date >= ? AND date <= ? AND check_in > '' AND check_in > (date || ' 09:00:00') ORDER BY date ASC"
    ).all(employee, from, to) as any[];
    return NextResponse.json(rows);
  }

  if (type === "absent") {
    // Get all attendance records for the month
    const attendances = db.prepare(
      "SELECT * FROM attendance WHERE employee_name = ? AND date >= ? AND date <= ?"
    ).all(employee, from, to) as any[];

    const leaveReqs = db.prepare(
      "SELECT * FROM leave_requests WHERE employee_name = ? AND status = '已通过' AND start_date <= ? AND end_date >= ?"
    ).all(employee, to, from) as any[];

    const seenDates = new Set(attendances.map((a: any) => a.date));
    const leaveDates = new Set<string>();
    leaveReqs.forEach((l: any) => {
      const start = new Date(l.start_date);
      const end = new Date(l.end_date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        leaveDates.add(d.toISOString().split("T")[0]);
      }
    });

    const absentDates: { date: string }[] = [];
    const today = new Date().toISOString().split("T")[0];
    for (let d2 = 1; d2 <= lastDay; d2++) {
      const ds = `${month}-${String(d2).padStart(2, "0")}`;
      if (ds > today) break;
      const day = new Date(y, m - 1, d2).getDay();
      if (day === 0) continue; // 周日休息
      if (!seenDates.has(ds) && !leaveDates.has(ds)) {
        absentDates.push({ date: ds });
      }
    }
    return NextResponse.json(absentDates);
  }

  return NextResponse.json([]);
}
