import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";

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
  const body = await readJson(req);
  const { leave_type, start_date, end_date, destination, reason, images } = body;
  const _e = validateEnums({ "leave_requests.leave_type": leave_type });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });
  // 防冒名：普通员工只能给自己提请假，管理员可代提
  const employee_name = auth.role === "admin" && body.employee_name ? body.employee_name : auth.name;
  if (!employee_name || !start_date || !end_date) return NextResponse.json({ error: "请填写必填字段" }, { status: 400 });
  if (end_date < start_date) return NextResponse.json({ error: "结束日期不能早于开始日期" }, { status: 400 });
  const imagesJson = Array.isArray(images) ? JSON.stringify(images.filter((s: string) => s && s.trim())) : "[]";
  const result = db.prepare(
    "INSERT INTO leave_requests (employee_name, leave_type, start_date, end_date, destination, reason, images) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(employee_name, leave_type || "事假", start_date, end_date, destination || "", reason || "", imagesJson);
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
  const body = await readJson(req);
  // 注意：请求体里的 approved_by 一律忽略，审批人取自登录态
  const { id, status, images, append_images } = body;

  if (!id) return NextResponse.json({ error: "缺少参数 id" }, { status: 400 });

  // 补传附件：只追加图片，不改状态（本人或管理员）
  if (append_images !== undefined && Array.isArray(append_images)) {
    const existing = db.prepare("SELECT images, employee_name FROM leave_requests WHERE id = ?").get(id) as any;
    if (!existing) return NextResponse.json({ error: "请假记录不存在" }, { status: 404 });
    if (auth.role !== "admin" && existing.employee_name !== auth.name) {
      return NextResponse.json({ error: "只能给自己的申请补传附件" }, { status: 403 });
    }
    const oldImages: string[] = (() => { try { return JSON.parse(existing.images || "[]"); } catch { return []; } })();
    const newImages = append_images.filter((s: string) => s && s.trim());
    const merged = [...oldImages, ...newImages];
    db.prepare("UPDATE leave_requests SET images = ? WHERE id = ?").run(JSON.stringify(merged), id);
    return NextResponse.json(db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(id));
  }

  // 正常审批流程 —— 仅管理员可审批，否则员工可自批请假绕过缺勤统计
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可审批请假" }, { status: 403 });
  if (!status) return NextResponse.json({ error: "缺少参数 status" }, { status: 400 });
  const validStatuses = ["待审批", "已通过", "已驳回"];
  if (!validStatuses.includes(status)) return NextResponse.json({ error: "无效的状态值" }, { status: 400 });

  const target = db.prepare("SELECT id FROM leave_requests WHERE id = ?").get(id);
  if (!target) return NextResponse.json({ error: "请假记录不存在" }, { status: 404 });

  const sets = ["status = ?"]; const vals: any[] = [status];
  if (images !== undefined) { sets.push("images = ?"); vals.push(Array.isArray(images) ? JSON.stringify(images.filter((s: string) => s && s.trim())) : "[]"); }
  // 审批人以登录身份为准，不信任请求体
  if (status === "已通过" || status === "已驳回") { sets.push("approved_at = datetime('now')"); sets.push("approved_by = ?"); vals.push(auth.name); }
  vals.push(id);

  // 审批 + 回写考勤放进同一个事务：中途失败会留下"状态已通过、但考勤只标了一半"的数据
  db.transaction(() => {
    db.prepare(`UPDATE leave_requests SET ${sets.join(", ")} WHERE id = ?`).run(...vals);

    // 请假通过：在该日期范围内自动创建/标记考勤为请假
    if (status === "已通过") {
      const leaveReq = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(id) as any;
      if (leaveReq) {
        const start = new Date(leaveReq.start_date + "T00:00:00Z");
        const end = new Date(leaveReq.end_date + "T00:00:00Z");
        for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
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
  })();

  return NextResponse.json(db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(id));
}
