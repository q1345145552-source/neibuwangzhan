import { publicClientNote } from "@/lib/client-view";
import { isClientOrderVisible } from "@/lib/client-scope";
import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb } from "@/lib/db";

// GET /api/orders/:id/steps/:stepId/notes
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id, stepId } = await params;
  if (auth.role === "client" && !isClientOrderVisible(auth.id, auth.name, id)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM order_steps WHERE id = ? AND order_id = ?").get(stepId, id)) return NextResponse.json({ error: "步骤不存在" }, { status: 404 });
  const rows = db.prepare("SELECT * FROM step_notes WHERE order_id = ? AND step_id = ? ORDER BY created_at DESC").all(id, stepId);
  return NextResponse.json(auth.role === "client" ? rows.filter(row => (row as {client_author_id?: number}).client_author_id === auth.id).map(publicClientNote) : rows);
}

// POST /api/orders/:id/steps/:stepId/notes
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id, stepId } = await params;
  if (auth.role === "client" && !isClientOrderVisible(auth.id, auth.name, id)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM order_steps WHERE id = ? AND order_id = ?").get(stepId, id)) return NextResponse.json({ error: "步骤不存在" }, { status: 404 });
  const body = await readJson(req);
  const { content } = body;
  if (!content) return NextResponse.json({ error: "请输入备注内容" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO step_notes (step_id, order_id, content, created_by, client_author_id) VALUES (?, ?, ?, ?, ?)"
  ).run(stepId, id, content, auth.name, auth.role === "client" ? auth.id : null);
  const note = db.prepare("SELECT * FROM step_notes WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(auth.role === "client" ? publicClientNote(note) : note, { status: 201 });
}

// DELETE /api/orders/:id/steps/:stepId/notes
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id, stepId } = await params;
  if (auth.role === "client" && !isClientOrderVisible(auth.id, auth.name, id)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM order_steps WHERE id = ? AND order_id = ?").get(stepId, id)) return NextResponse.json({ error: "步骤不存在" }, { status: 404 });

  // 支持两种传参方式：query ?id=xxx 或 body { note_id: xxx }
  let note_id: string | null = null;
  const url = new URL(req.url);
  note_id = url.searchParams.get("id");
  if (!note_id) {
    try {
      const body = await readJson(req);
      note_id = body.note_id;
    } catch {}
  }

  if (!note_id) return NextResponse.json({ error: "缺少 note_id" }, { status: 400 });

  const numId = Number(note_id);
  const existing = db.prepare("SELECT * FROM step_notes WHERE id = ? AND order_id = ? AND step_id = ?").get(numId, id, stepId);
  if (!existing) return NextResponse.json({ error: "备注不存在" }, { status: 404 });

  db.prepare("DELETE FROM step_notes WHERE id = ?").run(numId);
  return NextResponse.json({ success: true });
}
