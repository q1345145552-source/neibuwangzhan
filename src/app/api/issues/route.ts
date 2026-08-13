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
  // assignee 现在支持多选，以逗号分隔存储，用包含匹配判断是否被指派
  if (auth.role !== "admin") {
    sql += " AND (',' || assignee || ',' LIKE ? OR created_by = ?)";
    params.push("%," + auth.name + ",%", auth.name);
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
  // assignee 支持多选：数组转逗号分隔字符串，单个字符串兼容旧调用
  const assigneeList = Array.isArray(assignee)
    ? assignee.map((s: any) => String(s).trim()).filter(Boolean)
    : (typeof assignee === "string" ? [assignee.trim()] : []);
  const assigneeStr = assigneeList.join(",");
  if (assigneeList.length === 0) return NextResponse.json({ error: "请至少指定一个解决人" }, { status: 400 });
  const imagesJson = Array.isArray(images) ? JSON.stringify(images.filter((s: string) => s && s.trim())) : "[]";
  const result = db.prepare(
    `INSERT INTO issue_tickets (ticket_number, ref_id, ref_type, description, priority, assignee, created_by, images)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(ticket_number || "", ref_id || "", ref_type || "", description, priority || "medium", assigneeStr, created_by || "", imagesJson);
  const row = db.prepare("SELECT * FROM issue_tickets WHERE id = ?").get(result.lastInsertRowid);
  // 每个被指派的员工都发一条通知
  for (const name of assigneeList) {
    db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)").run(
      "issue_assigned", "新问题工单", description, name, String(result.lastInsertRowid), "issue"
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

  // 归属校验：员工只能处理指派给自己的或自己创建的工单，管理员可处理全部
  const ticket = db.prepare("SELECT assignee, created_by, status FROM issue_tickets WHERE id = ?").get(id) as
    { assignee: string; created_by: string; status: string } | undefined;
  if (!ticket) return NextResponse.json({ error: "工单不存在" }, { status: 404 });
  const assigneeList = (ticket.assignee || "").split(",").map((s) => s.trim()).filter(Boolean);
  const isAssignee = assigneeList.includes(auth.name);
  if (auth.role !== "admin" && !isAssignee && ticket.created_by !== auth.name) {
    return NextResponse.json({ error: "只能处理指派给自己或自己创建的工单" }, { status: 403 });
  }
  // 待处理 → 处理中（开始处理）：只有被指派的员工或管理员能操作，创建人不能替别人开工
  if (auth.role !== "admin" && status === "处理中" && ticket.status === "待处理" && !isAssignee) {
    return NextResponse.json({ error: "只有被指派的员工才能开始处理此工单" }, { status: 403 });
  }

  const sets: string[] = []; const vals: any[] = [];
  // resolved_by 取登录态，不信任请求体
  if (status) { sets.push("status = ?"); vals.push(status); if (status === "已解决") { sets.push("resolved_at = datetime('now')"); sets.push("resolved_by = ?"); vals.push(auth.name); } }
  if (assignee) {
    sets.push("assignee = ?");
    vals.push(Array.isArray(assignee) ? assignee.map((s: any) => String(s).trim()).filter(Boolean).join(",") : assignee);
  }
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
