import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET /api/orders/:id/steps/:stepId/notes
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id, stepId } = await params;
  const db = getDb();
  const rows = db.prepare("SELECT * FROM step_notes WHERE order_id = ? AND step_id = ? ORDER BY created_at DESC").all(id, stepId);
  return NextResponse.json(rows);
}

// POST /api/orders/:id/steps/:stepId/notes
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id, stepId } = await params;
  const db = getDb();
  const body = await req.json();
  const { content, created_by } = body;
  if (!content) return NextResponse.json({ error: "请输入备注内容" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO step_notes (step_id, order_id, content, created_by) VALUES (?, ?, ?, ?)"
  ).run(stepId, id, content, created_by || "");
  const note = db.prepare("SELECT * FROM step_notes WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(note, { status: 201 });
}

// DELETE /api/orders/:id/steps/:stepId/notes
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { note_id } = body;

  if (!note_id) return NextResponse.json({ error: "缺少 note_id" }, { status: 400 });

  const existing = db.prepare("SELECT * FROM step_notes WHERE id = ? AND order_id = ?").get(note_id, id);
  if (!existing) return NextResponse.json({ error: "备注不存在" }, { status: 404 });

  db.prepare("DELETE FROM step_notes WHERE id = ?").run(note_id);
  return NextResponse.json({ success: true });
}
