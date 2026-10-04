import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation, notifyAdmins, sendNotification } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";

const FIELDS = "id, employee_id, employee_name, phone, address, emergency_name, emergency_phone, emergency_relation, status, reject_reason, created_by, reviewed_by, reviewed_at, created_at";

// GET /api/employee-info-changes — 变更申请（管理员看全部；普通员工只看自己）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  let sql = `SELECT ${FIELDS} FROM employee_info_changes WHERE 1=1`;
  const params: any[] = [];
  if (auth.role !== "admin") {
    sql += " AND employee_id = ?";
    params.push(auth.id);
  }
  if (status) { sql += " AND status = ?"; params.push(status); }
  sql += " ORDER BY created_at DESC, id DESC";

  const rows = db.prepare(sql).all(...params);
  return NextResponse.json(rows);
}

// POST /api/employee-info-changes — 员工自助提交（只能改自己的电话/地址/紧急联系人）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const phone = String(body?.phone ?? "").trim();
  const address = String(body?.address ?? "").trim();
  const emergency_name = String(body?.emergency_name ?? "").trim();
  const emergency_phone = String(body?.emergency_phone ?? "").trim();
  const emergency_relation = String(body?.emergency_relation ?? "").trim();

  if (!phone || !address || !emergency_name || !emergency_phone) {
    return NextResponse.json({ error: "电话、地址、紧急联系人（姓名和电话）都必填" }, { status: 400 });
  }

  // 已有一条待审核的申请时，先等管理员处理，避免堆叠
  const pending = db.prepare(
    "SELECT id FROM employee_info_changes WHERE employee_id = ? AND status = '待审核' LIMIT 1"
  ).get(auth.id);
  if (pending) return NextResponse.json({ error: "你已有一条待审核的变更申请，请等待管理员审核后再提交" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO employee_info_changes (employee_id, employee_name, phone, address, emergency_name, emergency_phone, emergency_relation, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(auth.id, auth.name, phone, address, emergency_name, emergency_phone, emergency_relation, auth.name);

  logOperation(auth.name, "提交信息变更申请", "employee", String(auth.id), `电话/地址/紧急联系人变更`);
  notifyAdmins(
    "info_change_request",
    "信息变更申请",
    `${auth.name} 提交了信息变更申请（电话/地址/紧急联系人），请审核`,
    String(result.lastInsertRowid),
    "info_change"
  );

  const row = db.prepare(`SELECT ${FIELDS} FROM employee_info_changes WHERE id = ?`).get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}

// PATCH /api/employee-info-changes — 管理员审核（通过则生效；驳回需填原因，信息不变）
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可审核" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const id = Number(body?.id);
  const status = String(body?.status ?? "");
  const reject_reason = String(body?.reject_reason ?? "").trim();

  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少申请ID" }, { status: 400 });
  const _e = validateEnums({ "employee_info_changes.status": status });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });

  const target = db.prepare(`SELECT ${FIELDS} FROM employee_info_changes WHERE id = ?`).get(id) as any;
  if (!target) return NextResponse.json({ error: "申请不存在" }, { status: 404 });
  if (target.status !== "待审核") return NextResponse.json({ error: "该申请已处理过" }, { status: 400 });

  if (status === "已驳回") {
    if (!reject_reason) return NextResponse.json({ error: "驳回必须填写原因" }, { status: 400 });
    db.prepare("UPDATE employee_info_changes SET status = '已驳回', reject_reason = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?")
      .run(reject_reason, auth.name, id);
    logOperation(auth.name, "驳回信息变更申请", "employee", String(target.employee_id), `${target.employee_name} 电话/地址/紧急联系人（原因：${reject_reason}）`);
    sendNotification(
      "info_change_request",
      "信息变更已驳回",
      `你的信息变更申请被驳回：${reject_reason}`,
      target.employee_name,
      String(id),
      "info_change"
    );
  } else if (status === "已通过") {
    // 审核通过：新信息才写入员工档案
    db.transaction(() => {
      db.prepare(
        "UPDATE employees SET phone = ?, address = ?, emergency_name = ?, emergency_phone = ?, emergency_relation = ? WHERE id = ?"
      ).run(target.phone, target.address, target.emergency_name, target.emergency_phone, target.emergency_relation, target.employee_id);
      db.prepare("UPDATE employee_info_changes SET status = '已通过', reject_reason = '', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?")
        .run(auth.name, id);
    })();
    logOperation(auth.name, "通过信息变更申请", "employee", String(target.employee_id), `${target.employee_name} 电话/地址/紧急联系人`);
    sendNotification(
      "info_change_request",
      "信息变更已通过",
      "你的信息变更申请已通过，新信息已生效",
      target.employee_name,
      String(id),
      "info_change"
    );
  }

  const updated = db.prepare(`SELECT ${FIELDS} FROM employee_info_changes WHERE id = ?`).get(id);
  return NextResponse.json(updated);
}
