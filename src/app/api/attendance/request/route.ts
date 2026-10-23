import { publishBossSubmission } from "@/lib/boss-submissions";
import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { ATTENDANCE_REVIEW_TITLES } from "@/lib/notification-types";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
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
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const { date, time, reason } = body;
  // 防冒名申请：普通员工只能给自己提补卡，管理员可代指定员工提
  const employee_name = auth.role === "admin" && body.employee_name ? body.employee_name : auth.name;
  if (!employee_name || !date || !time) {
    return NextResponse.json({ error: "请填写必填字段" }, { status: 400 });
  }
  const result = db.transaction(() => {
    const saved = db.prepare(
      "INSERT INTO attendance_requests (employee_name, date, time, type, reason, photo) VALUES (?, ?, ?, '补签', ?, ?)"
    ).run(employee_name, date, time, reason || "", body.photo || "");
    publishBossSubmission(db, "attendance", Number(saved.lastInsertRowid), employee_name, `提交了补签申请（${date} ${time}）`);
    return saved;
  })();
  logOperation(employee_name, "补签申请", "attendance_request", String(result.lastInsertRowid), `${date} ${time}`);

  return NextResponse.json(
    db.prepare("SELECT * FROM attendance_requests WHERE id = ?").get(result.lastInsertRowid),
    { status: 201 }
  );
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可审批" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const { id, status }: { id: number; status: string } = body;
  if (!id || !status) return NextResponse.json({ error: "缺少参数" }, { status: 400 });

  if (!["待审批", "已通过", "已驳回"].includes(status)) return NextResponse.json({ error: "无效的状态值" }, { status: 400 });
  const rejectionReason = typeof body.rejection_reason === "string" ? body.rejection_reason.trim() : "";
  if (status === "已驳回" && !rejectionReason) return NextResponse.json({ error: "请填写驳回原因" }, { status: 400 });

  return db.transaction(() => {
    const req_ = db.prepare("SELECT * FROM attendance_requests WHERE id = ?").get(id) as any;
    if (!req_) return NextResponse.json({ error: "申请不存在" }, { status: 404 });
    if (typeof req_.employee_name !== "string" || !req_.employee_name.trim()) return NextResponse.json({ error: "申请人信息无效，无法审批" }, { status: 409 });
    if (req_.status === status) return NextResponse.json(req_);
    const changed = db.prepare(
      "UPDATE attendance_requests SET status = ?, rejection_reason = ?, approved_by = ?, approved_at = datetime('now') WHERE id = ? AND status = ?"
    ).run(status, status === "已驳回" ? rejectionReason : "", auth.name, id, req_.status);
    if (changed.changes !== 1) return NextResponse.json({ error: "申请状态已变化，请刷新后重试" }, { status: 409 });

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

    if (status === "已通过" || status === "已驳回") {
      const title = ATTENDANCE_REVIEW_TITLES[status === "已通过" ? 0 : 1];
      db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)").run(
        "", title, `${auth.name}${status === "已通过" ? "已通过" : "已驳回"}你在 ${req_.date} ${req_.time} 的补签申请。${status === "已驳回" ? `\n驳回原因：${rejectionReason}` : ""}`,
        req_.employee_name, String(req_.id), "attendance_review"
      );
      logOperation(auth.name, title, "attendance_request", String(req_.id), `${req_.employee_name} ${req_.date} ${req_.time}`);
    }
    return NextResponse.json(db.prepare("SELECT * FROM attendance_requests WHERE id = ?").get(id));
  }).immediate();
}
