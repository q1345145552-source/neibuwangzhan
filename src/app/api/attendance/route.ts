import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { bangkokToday, utcNowStr } from "@/lib/time";

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
  // 角色隔离：非管理员只能看自己
  if (auth.role !== "admin") {
    sql += " AND employee_name = ?";
    params.push(auth.name);
  } else if (employee) {
    sql += " AND employee_name = ?";
    params.push(employee);
  }
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
  const { action } = body;
  // 防代打卡：普通员工只能给自己打卡，管理员可代指定员工补录
  const employee_name = auth.role === "admin" && body.employee_name ? body.employee_name : auth.name;
  if (!employee_name) return NextResponse.json({ error: "缺少员工姓名" }, { status: 400 });
  if (action !== "check_in" && action !== "check_out") {
    return NextResponse.json({ error: "无效的 action，应为 check_in 或 check_out" }, { status: 400 });
  }

  // 日期按曼谷时区（UTC+7）计算，时间戳仍存 UTC
  const today = bangkokToday();
  const now = utcNowStr();
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "127.0.0.1";
  const ua = req.headers.get("user-agent") || "";

  if (action === "check_in") {
    const existing = db.prepare("SELECT id FROM attendance WHERE employee_name = ? AND date = ?").get(employee_name, today) as any;
    if (existing) return NextResponse.json({ error: "今天已经打过卡了" }, { status: 400 });
    db.prepare(
      "INSERT INTO attendance (employee_name, date, check_in, check_in_ip, ip_address, user_agent, check_in_photo) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(employee_name, today, now, ip, ip, ua, body.check_in_photo || '');
  } else if (action === "check_out") {
    const record = db.prepare(
      "SELECT * FROM attendance WHERE employee_name = ? AND date = ? AND check_out = ''"
    ).get(employee_name, today) as any;
    if (!record) return NextResponse.json({ error: "今天还没有签到记录" }, { status: 400 });
    const checkIn = new Date(record.check_in);
    const checkOut = new Date(now);
    const hours = Math.round(((checkOut.getTime() - checkIn.getTime()) / 3600000) * 100) / 100;
    db.prepare(
      "UPDATE attendance SET check_out = ?, work_hours = ?, check_out_ip = ?, check_out_photo = ? WHERE id = ?"
    ).run(now, hours, ip, body.check_out_photo || '', record.id);
  }

  const rows = db.prepare(
    "SELECT * FROM attendance WHERE employee_name = ? AND date = ?"
  ).all(employee_name, today);
  return NextResponse.json(rows[0] || {});
}
