import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

function ensureTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wht_record_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      file_url TEXT DEFAULT '',
      uploaded_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

// GET /api/wht/records/[id]/documents
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  ensureTable(db);
  const rows = db.prepare("SELECT * FROM wht_record_documents WHERE record_id = ? ORDER BY created_at DESC").all(id);
  return NextResponse.json(rows);
}

// POST /api/wht/records/[id]/documents
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  ensureTable(db);
  const body = await req.json();
  const { name, file_url, uploaded_by } = body;
  if (!name) return NextResponse.json({ error: "请填写文档名" }, { status: 400 });
  const result = db.prepare(
    "INSERT INTO wht_record_documents (record_id, name, file_url, uploaded_by) VALUES (?, ?, ?, ?)"
  ).run(id, name, file_url || "", uploaded_by || "");
  const doc = db.prepare("SELECT * FROM wht_record_documents WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(doc, { status: 201 });
}

// DELETE /api/wht/records/[id]/documents
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });
  const url = new URL(req.url);
  const docId = url.searchParams.get("id");
  if (!docId) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  const db = getDb();
  ensureTable(db);
  db.prepare("DELETE FROM wht_record_documents WHERE id = ?").run(docId);
  return NextResponse.json({ success: true });
}
