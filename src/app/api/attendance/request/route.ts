import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  let sql = "SELECT * FROM attendance_requests WHERE 1=1";
  const params: any[] = [];
  if (auth.role !== "admin") {
    sql += " AND employee_name = ?";
    params.push(auth.name);
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
  const { date, time, reason } = body;
  // 防冒名申请：普通员工只能给自己提补卡，管理员可代指定员工提
  const employee_name = auth.role === "admin" && body.employee_name ? body.employee_name : auth.name;
  if (!employee_name || !date || !time) {
    return NextResponse.json({ error: "请填写必填字段" }, { status: 400 });
  }
  // 注意：占位符数量必须与传值一致（此前漏传 photo 导致 500）
  const result = db.prepare(
    "INSERT INTO attendance_requests (employee_name, date, time, type, reason, photo) VALUES (?, ?, ?, '补签', ?, ?)"
  ).run(employee_name, date, time, reason || "", body.photo || "");

  // 通知管理员
  const admins = db.prepare("SELECT name FROM employees WHERE role = 'admin'").all() as { name: string }[];
  for (const admin of admins) {
    db.prepare(
      "INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("leave_requested", "补卡申请", `${employee_name} 申请补卡 ${date} ${time}`, admin.name, String(result.lastInsertRowid), "attendance_request");
  }

  return NextResponse.json(
    db.prepare("SELECT * FROM attendance_requests WHERE id = ?").get(result.lastInsertRowid),
    { status: 201 }
  );
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可审批" }, { status: 403 });
  const db = getDb();
  const body = await req.json();
  const { id, status }: { id: number; status: string } = body;
  if (!id || !status) return NextResponse.json({ error: "缺少参数" }, { status: 400 });

  const req_ = db.prepare("SELECT * FROM attendance_requests WHERE id = ?").get(id) as any;
  if (!req_) return NextResponse.json({ error: "申请不存在" }, { status: 404 });

  db.prepare(
    "UPDATE attendance_requests SET status = ?, approved_by = ?, approved_at = datetime('now') WHERE id = ?"
  ).run(status, auth.name, id);

  // 审批通过：自动补打卡记录
  if (status === "已通过") {
    const existing = db.prepare(
      "SELECT id FROM attendance WHERE employee_name = ? AND date = ?"
    ).get(req_.employee_name, req_.date) as any;

    if (existing) {
      // 已有记录则更新
      const exRec = db.prepare("SELECT check_in FROM attendance WHERE id = ?").get(existing.id) as any; if (!exRec.check_in) {
        const checkIn = `${req_.date} ${req_.time}`;
        db.prepare("UPDATE attendance SET check_in = ?, type = '补签', check_in_ip = '补签' WHERE id = ?").run(checkIn, existing.id);
      }
    } else {
      const checkIn = `${req_.date} ${req_.time}`;
      db.prepare(
        "INSERT INTO attendance (employee_name, date, check_in, type, check_in_ip, check_in_photo) VALUES (?, ?, ?, '补签', '补签', ?)"
      ).run(req_.employee_name, req_.date, checkIn, req_.photo || '');
    }
  }

  return NextResponse.json(
    db.prepare("SELECT * FROM attendance_requests WHERE id = ?").get(id)
  );
}
