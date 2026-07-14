import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const employee = searchParams.get("employee");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  let sql = "SELECT * FROM attendance WHERE 1=1";
  const params: any[] = [];
  if (employee) { sql += " AND employee_name = ?"; params.push(employee); }
  if (from) { sql += " AND date >= ?"; params.push(from); }
  if (to) { sql += " AND date <= ?"; params.push(to); }
  sql += " ORDER BY date DESC, created_at DESC";
  return NextResponse.json(db.prepare(sql).all(...params));
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const body = await req.json();
  const { employee_name, action } = body; // action: "check_in" | "check_out"
  if (!employee_name) return NextResponse.json({ error: "缺少员工姓名" }, { status: 400 });

  const today = new Date().toISOString().split("T")[0];
  const now = new Date().toISOString().replace("T", " ").split(".")[0];

  if (action === "check_in") {
    const existing = db.prepare("SELECT id FROM attendance WHERE employee_name = ? AND date = ?").get(employee_name, today) as any;
    if (existing) return NextResponse.json({ error: "今天已经打过卡了" }, { status: 400 });
    db.prepare("INSERT INTO attendance (employee_name, date, check_in) VALUES (?, ?, ?)").run(employee_name, today, now);
  } else if (action === "check_out") {
    const record = db.prepare("SELECT * FROM attendance WHERE employee_name = ? AND date = ? AND check_out = ''").get(employee_name, today) as any;
    if (!record) return NextResponse.json({ error: "今天还没有签到记录" }, { status: 400 });
    const checkIn = new Date(record.check_in);
    const checkOut = new Date(now);
    const hours = Math.round(((checkOut.getTime() - checkIn.getTime()) / 3600000) * 100) / 100;
    db.prepare("UPDATE attendance SET check_out = ?, work_hours = ? WHERE id = ?").run(now, hours, record.id);
  }

  const rows = db.prepare("SELECT * FROM attendance WHERE employee_name = ? AND date = ?").all(employee_name, today);
  return NextResponse.json(rows[0] || {});
}
