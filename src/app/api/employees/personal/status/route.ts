import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";

// GET /api/employees/personal/status — 所有员工的个人情况最近更新日期（仅管理员，供列表标黄提醒）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const rows = db.prepare(
    "SELECT e.id, e.name, p.updated_at FROM employees e LEFT JOIN employee_personal_notes p ON p.employee_id = e.id WHERE e.role = 'employee' ORDER BY e.name ASC, e.id ASC"
  ).all() as { id: number; name: string; updated_at: string }[];

  return NextResponse.json({ items: rows });
}
