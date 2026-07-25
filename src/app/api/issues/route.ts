import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const assignee = searchParams.get("assignee");
  const created_by = searchParams.get("created_by");
  let sql = "SELECT * FROM issue_tickets WHERE 1=1";
  const params: any[] = [];
  // 员工只能看自己的工单（指派给自己的、或自己创建的），管理员看全部
  if (auth.role !== "admin") {
    sql += " AND (assignee = ? OR created_by = ?)";
    params.push(auth.name, auth.name);
  } else {
    if (status) { sql += " AND status = ?"; params.push(status); }
    if (assignee) { sql += " AND assignee = ?"; params.push(assignee); }
    if (created_by) { sql += " AND created_by = ?"; params.push(created_by); }
  }
  sql += " ORDER BY created_at DESC";
  return NextResponse.json(db.prepare(sql).all(...params));
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const body = await readJson(req);
  const { ticket_number, ref_id, ref_type, description, priority, assignee, created_by, images } = body;
  if (!description?.trim()) return NextResponse.json({ error: "请填写问题描述" }, { status: 400 });
  const imagesJson = Array.isArray(images) ? JSON.stringify(images.filter((s: string) => s && s.trim())) : "[]";
  const result = db.prepare(
    `INSERT INTO issue_tickets (ticket_number, ref_id, ref_type, description, priority, assignee, created_by, images)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(ticket_number || "", ref_id || "", ref_type || "", description, priority || "medium", assignee || "", created_by || "", imagesJson);
  const row = db.prepare("SELECT * FROM issue_tickets WHERE id = ?").get(result.lastInsertRowid);
  if (assignee) {
    db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)").run(
      "issue_assigned", "新问题工单", description, assignee, String(result.lastInsertRowid), "issue"
    );
  }
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const body = await readJson(req);
  const { id, status, assignee, description, priority, images, resolve_screenshot } = body;
  if (!id) return NextResponse.json({ error: "缺少工单ID" }, { status: 400 });

  // 状态白名单：表上有 CHECK 约束，非法值会直接抛异常变成 500
  const VALID_STATUS = ["待处理", "处理中", "已解决"];
  if (status && !VALID_STATUS.includes(status)) {
    return NextResponse.json({ error: "无效的状态值" }, { status: 400 });
  }
  const VALID_PRIORITY = ["low", "medium", "high", "urgent"];
  if (priority && !VALID_PRIORITY.includes(priority)) {
    return NextResponse.json({ error: "无效的优先级" }, { status: 400 });
  }

  // 归属校验：GET 和 DELETE 都限定了本人，PATCH 却没有——
  // 任何员工都能改/关闭别人的工单，而"解决工单"是会加分的（issue_resolved +3/个）
  const ticket = db.prepare("SELECT assignee, created_by FROM issue_tickets WHERE id = ?").get(id) as
    { assignee: string; created_by: string } | undefined;
  if (!ticket) return NextResponse.json({ error: "工单不存在" }, { status: 404 });
  if (auth.role !== "admin" && ticket.assignee !== auth.name && ticket.created_by !== auth.name) {
    return NextResponse.json({ error: "只能处理指派给自己或自己创建的工单" }, { status: 403 });
  }

  const sets: string[] = []; const vals: any[] = [];
  // resolved_by 取登录态，不信任请求体
  if (status) { sets.push("status = ?"); vals.push(status); if (status === "已解决") { sets.push("resolved_at = datetime('now')"); sets.push("resolved_by = ?"); vals.push(auth.name); } }
  if (assignee) { sets.push("assignee = ?"); vals.push(assignee); }
  if (body.withdrawn_by) { sets.push("withdrawn_by = ?"); vals.push(body.withdrawn_by); sets.push("withdrawn_at = datetime('now')"); }
  if (description) { sets.push("description = ?"); vals.push(description); }
  if (priority) { sets.push("priority = ?"); vals.push(priority); }
  if (images !== undefined) { sets.push("images = ?"); vals.push(Array.isArray(images) ? JSON.stringify(images.filter((s: string) => s && s.trim())) : "[]"); }
  if (resolve_screenshot !== undefined) { sets.push("resolve_screenshot = ?"); vals.push(resolve_screenshot || ""); }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE issue_tickets SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return NextResponse.json(db.prepare("SELECT * FROM issue_tickets WHERE id = ?").get(id));
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少工单ID" }, { status: 400 });
  const db = getDb();
  // 只有管理员或创建人本人可以删除
  if (auth.role !== "admin") {
    const ticket = db.prepare("SELECT created_by FROM issue_tickets WHERE id = ?").get(id) as { created_by: string } | undefined;
    if (!ticket || ticket.created_by !== auth.name) {
      return NextResponse.json({ error: "无权删除此工单" }, { status: 403 });
    }
  }
  db.prepare("DELETE FROM issue_tickets WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
