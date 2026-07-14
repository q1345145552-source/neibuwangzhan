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
  // 员工只能看自己的请假记录，管理员看全部
  if (auth.role !== "admin") {
    sql += " AND employee_name = ?";
    params.push(auth.name);
  } else if (employee) {
    sql += " AND employee_name = ?";
    params.push(employee);
  }
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
  const admins = db.prepare("SELECT name FROM employees WHERE role = 'admin'").all() as { name: string }[];
  for (const admin of admins) {
    db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)").run(
      "leave_requested", "请假申请", `${employee_name} 申请${leave_type || "事假"} (${start_date} ~ ${end_date})`, admin.name, String(result.lastInsertRowid), "leave"
    );
  }
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

  // 请假通过：在该日期范围内自动创建/标记考勤为请假
  if (status === "已通过") {
    const leaveReq = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(id) as any;
    if (leaveReq) {
      const start = new Date(leaveReq.start_date);
      const end = new Date(leaveReq.end_date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const ds = d.toISOString().split("T")[0];
        const existing = db.prepare("SELECT id FROM attendance WHERE employee_name = ? AND date = ?").get(leaveReq.employee_name, ds) as any;
        if (existing) {
          db.prepare("UPDATE attendance SET type = '请假' WHERE id = ?").run(existing.id);
        } else {
          db.prepare("INSERT INTO attendance (employee_name, date, type) VALUES (?, ?, '请假')").run(leaveReq.employee_name, ds);
        }
      }
    }
  }

  return NextResponse.json(db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(id));
}
