import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const { id, stepId } = await params;
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM influencer_step_notes WHERE influencer_id = ? AND step_id = ? ORDER BY created_at DESC"
  ).all(id, stepId);
  const res = NextResponse.json(rows);
  res.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  return res;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const { id, stepId } = await params;
  const db = getDb();
  const body = await req.json();
  const { content, created_by } = body;
  if (!content) return NextResponse.json({ error: "请输入备注内容" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO influencer_step_notes (step_id, influencer_id, content, created_by) VALUES (?, ?, ?, ?)"
  ).run(stepId, id, content, created_by || "");
  const note = db.prepare("SELECT * FROM influencer_step_notes WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(note, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { note_id } = body;

  if (!note_id) return NextResponse.json({ error: "缺少 note_id" }, { status: 400 });

  const existing = db.prepare("SELECT * FROM influencer_step_notes WHERE id = ? AND influencer_id = ?").get(note_id, id);
  if (!existing) return NextResponse.json({ error: "备注不存在" }, { status: 404 });

  db.prepare("DELETE FROM influencer_step_notes WHERE id = ?").run(note_id);
  return NextResponse.json({ success: true });
}
