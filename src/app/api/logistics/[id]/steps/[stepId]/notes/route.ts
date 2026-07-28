import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb } from "@/lib/db";

// POST /api/logistics/[id]/steps/[stepId]/notes
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id, stepId } = await params;
  const db = getDb();
  const body = await readJson(req);
  const { content, created_by } = body;

  if (!content?.trim()) return NextResponse.json({ error: "请填写备注内容" }, { status: 400 });

  db.prepare(
    "INSERT INTO shipping_step_notes (order_id, step_id, content, created_by) VALUES (?, ?, ?, ?)"
  ).run(id, stepId, content.trim(), created_by || auth.name || "");

  const notes = db.prepare(
    "SELECT * FROM shipping_step_notes WHERE step_id = ? ORDER BY created_at"
  ).all(stepId);

  return NextResponse.json(notes, { status: 201 });
}

// DELETE /api/logistics/[id]/steps/[stepId]/notes?id=note_id
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id, stepId } = await params;
  const noteId = new URL(req.url).searchParams.get("id");
  if (!noteId) return NextResponse.json({ error: "缺少备注ID" }, { status: 400 });

  const db = getDb();
  db.prepare("DELETE FROM shipping_step_notes WHERE id = ? AND step_id = ? AND order_id = ?").run(noteId, stepId, id);

  const notes = db.prepare(
    "SELECT * FROM shipping_step_notes WHERE step_id = ? ORDER BY created_at"
  ).all(stepId);

  return NextResponse.json(notes);
}
