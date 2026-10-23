import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { canReadIssue, parseIssueAssignees } from "@/lib/chat-todo-issue-card";

const VALID_STATUS = ["待处理", "处理中", "已解决"];

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const assignee = searchParams.get("assignee");
  const created_by = searchParams.get("created_by");
  let sql = "SELECT * FROM issue_tickets WHERE 1=1";
  const params: any[] = [];
  // 老板原筛选保留；员工名单逐人精确比较，与手动分享的权限一致。
  if (auth.role === "admin") {
    if (status) { sql += " AND status = ?"; params.push(status); }
    if (assignee) { sql += " AND assignee = ?"; params.push(assignee); }
    if (created_by) { sql += " AND created_by = ?"; params.push(created_by); }
  }
  sql += " ORDER BY created_at DESC";
  const rows = db.prepare(sql).all(...params) as { assignee: string | null; created_by: string | null }[];
  return NextResponse.json(auth.role === "admin" ? rows : rows.filter(row => canReadIssue(auth, row)));
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const { ticket_number, ref_id, ref_type, description, priority, assignee, created_by, images } = body;
  if (typeof description !== "string" || !description.trim()) return NextResponse.json({ error: "请填写问题描述" }, { status: 400 });
  const status = body.status === undefined ? "待处理" : body.status;
  if (!VALID_STATUS.includes(status)) return NextResponse.json({ error: "无效的状态值" }, { status: 400 });
  // assignee 支持多选：数组转逗号分隔字符串，单个字符串兼容旧调用
  const assigneeList = Array.isArray(assignee)
    ? assignee.map((s: any) => String(s).trim()).filter(Boolean)
    : (typeof assignee === "string" ? [assignee.trim()].filter(Boolean) : []);
  const assigneeStr = assigneeList.join(",");
  if (assigneeList.length === 0) return NextResponse.json({ error: "请至少指定一个解决人" }, { status: 400 });
  const imagesJson = Array.isArray(images) ? JSON.stringify(images.filter((s: string) => s && s.trim())) : "[]";
  const now = new Date().toISOString();
  return db.transaction(() => {
    const result = db.prepare(
      `INSERT INTO issue_tickets (ticket_number, ref_id, ref_type, description, priority, assignee, created_by, images, created_at, updated_at, status, resolved_by, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(ticket_number || "", ref_id || "", ref_type || "", description, priority || "medium", assigneeStr, created_by || "", imagesJson, now, now,
      status, status === "已解决" ? auth.name : "", status === "已解决" ? now : null);
    const row = db.prepare("SELECT * FROM issue_tickets WHERE id = ?").get(result.lastInsertRowid);
    logOperation(created_by || auth.name, "提交工单", "issue", String(result.lastInsertRowid), description);
    // 沿用工单页的指派通知；通知和工单一起提交，避免只创建一半。
    for (const name of assigneeList) {
      db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)").run(
        "工单指派", "新问题工单", description, name, String(result.lastInsertRowid), "issue"
      );
    }
    return NextResponse.json(row, { status: 201 });
  })();
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const { id, status, assignee, description, priority, images, resolve_screenshot } = body;
  if (!id) return NextResponse.json({ error: "缺少工单ID" }, { status: 400 });

  // 状态白名单：表上有 CHECK 约束，非法值会直接抛异常变成 500
  if (status && !VALID_STATUS.includes(status)) {
    return NextResponse.json({ error: "无效的状态值" }, { status: 400 });
  }
  const VALID_PRIORITY = ["low", "medium", "high", "urgent"];
  if (priority && !VALID_PRIORITY.includes(priority)) {
    return NextResponse.json({ error: "无效的优先级" }, { status: 400 });
  }

  return db.transaction(() => {
  // 归属校验仍基于修改前的完整名单，不能把自己加进新名单来取得修改权限。
  const ticket = db.prepare("SELECT assignee, created_by, status FROM issue_tickets WHERE id = ?").get(id) as
    { assignee: string; created_by: string; status: string } | undefined;
  if (!ticket) return NextResponse.json({ error: "工单不存在" }, { status: 404 });
  const assigneeList = parseIssueAssignees(ticket.assignee);
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
  const changed = db.prepare(`UPDATE issue_tickets SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  if (changed.changes !== 1) return NextResponse.json({ error: "工单已变化，请刷新后重试" }, { status: 409 });
  const updated = db.prepare("SELECT * FROM issue_tickets WHERE id = ?").get(id) as any;
  const currentNames = parseIssueAssignees(updated.assignee);
  const previousNames = new Set(assigneeList);
  const addedNames = currentNames.filter(name => !previousNames.has(name));
  const statusChanged = ticket.status !== updated.status;
  const notices = new Map<string, { assigned: boolean; status: boolean; resolved: boolean }>();
  const add = (name: string, reason: "assigned" | "status" | "resolved") => {
    const item = notices.get(name) || { assigned: false, status: false, resolved: false };
    item[reason] = true; notices.set(name, item);
  };
  // 与原指派候选一致：真实员工/管理员账号。无对应账号不猜人，也不退回广播。
  if (addedNames.length || (statusChanged && updated.status !== "已解决")) {
    const validNames = new Set((db.prepare("SELECT DISTINCT name FROM employees WHERE role IN ('admin', 'employee') AND TRIM(name) <> ''").all() as { name: string }[]).map(row => row.name));
    for (const name of addedNames) if (validNames.has(name)) add(name, "assigned");
    if (statusChanged && updated.status !== "已解决") {
      for (const name of currentNames) if (name !== auth.name && validNames.has(name)) add(name, "status");
    }
  }
  // 已解决仍只走原创建人提醒；若此人同时新获指派，合为一条原完成提醒。
  if (statusChanged && updated.status === "已解决" && updated.created_by && updated.created_by !== auth.name) add(updated.created_by, "resolved");
  const insertNotice = db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)");
  for (const [name, reason] of notices) {
    const assignment = `${auth.name}已将你加入工单「${updated.description || ""}」的负责人。`;
    if (reason.resolved) {
      insertNotice.run("工单完成", "你派的工单已解决", `工单「${updated.description || ""}」已由 ${auth.name} 解决${reason.assigned ? `\n${assignment}` : ""}`, name, String(updated.id), "issue");
    } else {
      const title = reason.assigned && reason.status ? "工单负责人和状态已变更" : reason.assigned ? "工单负责人已变更" : "工单状态已变更";
      const content = [reason.assigned ? assignment : "", reason.status ? `${auth.name}将工单「${updated.description || ""}」从「${ticket.status}」改为「${updated.status}」。` : ""].filter(Boolean).join("\n");
      insertNotice.run("", title, content, name, String(updated.id), "issue_update");
    }
  }
  if (status) {
    logOperation(auth.name, status === "已解决" ? "解决工单" : "改工单状态", "issue", String(id), status);
  }
  return NextResponse.json(updated);
  }).immediate();
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
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
