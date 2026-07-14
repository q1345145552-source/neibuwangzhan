import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const today = new Date().toISOString().split("T")[0];

  const employees = db.prepare(
    "SELECT name FROM employees WHERE role IN ('admin','employee')"
  ).all() as any[];

  const results = employees.map((emp) => {
    const record = db.prepare(
      "SELECT * FROM attendance WHERE employee_name = ? AND date = ?"
    ).get(emp.name, today) as any;

    // 检查是否在请假中
    const leave = db.prepare(
      "SELECT * FROM leave_requests WHERE employee_name = ? AND status = '已通过' AND start_date <= ? AND end_date >= ?"
    ).get(emp.name, today, today) as any;

    return {
      name: emp.name,
      hasCheckedIn: !!record?.check_in,
      hasCheckedOut: !!record?.check_out,
      checkInTime: record?.check_in || null,
      checkOutTime: record?.check_out || null,
      workHours: record?.work_hours || null,
      type: record?.type || null,
      isOnLeave: !!leave,
      leaveType: leave?.leave_type || null,
    };
  });

  return NextResponse.json(results);
}
