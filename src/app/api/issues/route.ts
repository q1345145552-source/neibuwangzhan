import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

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
  if (status) { sql += " AND status = ?"; params.push(status); }
  if (assignee) { sql += " AND assignee = ?"; params.push(assignee); }
  if (created_by) { sql += " AND created_by = ?"; params.push(created_by); }
  sql += " ORDER BY created_at DESC";
  return NextResponse.json(db.prepare(sql).all(...params));
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const body = await req.json();
  const { ticket_number, ref_id, ref_type, description, priority, assignee, created_by } = body;
  if (!description?.trim()) return NextResponse.json({ error: "请填写问题描述" }, { status: 400 });
  const result = db.prepare(
    `INSERT INTO issue_tickets (ticket_number, ref_id, ref_type, description, priority, assignee, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(ticket_number || "", ref_id || "", ref_type || "", description, priority || "medium", assignee || "", created_by || "");
  const row = db.prepare("SELECT * FROM issue_tickets WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const body = await req.json();
  const { id, status, resolved_by, assignee, description, priority } = body;
  if (!id) return NextResponse.json({ error: "缺少工单ID" }, { status: 400 });
  const sets: string[] = []; const vals: any[] = [];
  if (status) { sets.push("status = ?"); vals.push(status); if (status === "已解决") { sets.push("resolved_at = datetime('now')"); if (resolved_by) { sets.push("resolved_by = ?"); vals.push(resolved_by); } } }
  if (assignee) { sets.push("assignee = ?"); vals.push(assignee); }
  if (description) { sets.push("description = ?"); vals.push(description); }
  if (priority) { sets.push("priority = ?"); vals.push(priority); }
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
  getDb().prepare("DELETE FROM issue_tickets WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
