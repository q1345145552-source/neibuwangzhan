import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const employee = searchParams.get("employee");
  const status = searchParams.get("status");
  let sql = "SELECT * FROM leave_requests WHERE 1=1";
  const params: any[] = [];
  if (employee) { sql += " AND employee_name = ?"; params.push(employee); }
  if (status) { sql += " AND status = ?"; params.push(status); }
  sql += " ORDER BY created_at DESC";
  return NextResponse.json(db.prepare(sql).all(...params));
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const body = await req.json();
  const { employee_name, leave_type, start_date, end_date, reason } = body;
  if (!employee_name || !start_date || !end_date) return NextResponse.json({ error: "请填写必填字段" }, { status: 400 });
  const result = db.prepare(
    "INSERT INTO leave_requests (employee_name, leave_type, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)"
  ).run(employee_name, leave_type || "事假", start_date, end_date, reason || "");
  return NextResponse.json(db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(result.lastInsertRowid), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const body = await req.json();
  const { id, status, approved_by } = body;
  if (!id || !status) return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  const sets = ["status = ?"]; const vals: any[] = [status];
  if (status === "已通过" || status === "已驳回") { sets.push("approved_at = datetime('now')"); if (approved_by) { sets.push("approved_by = ?"); vals.push(approved_by); } }
  vals.push(id);
  db.prepare(`UPDATE leave_requests SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return NextResponse.json(db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(id));
}
