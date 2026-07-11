import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const rows = db.prepare("SELECT * FROM influencer_documents WHERE influencer_id = ? ORDER BY created_at DESC").all(id);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const { name, file_type, file_url, uploaded_by } = await req.json();
  if (!name) return NextResponse.json({ error: "请填写文档名" }, { status: 400 });
  const result = db.prepare("INSERT INTO influencer_documents (influencer_id, name, file_type, file_url, uploaded_by) VALUES (?, ?, ?, ?, ?)")
    .run(id, name, file_type || "", file_url || "", uploaded_by || "");
  const row = db.prepare("SELECT * FROM influencer_documents WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const docId = searchParams.get("id");
  if (!docId) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  db.prepare("DELETE FROM influencer_documents WHERE id = ?").run(docId);
  return NextResponse.json({ success: true });
}
