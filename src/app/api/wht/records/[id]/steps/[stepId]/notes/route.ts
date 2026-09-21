import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb } from "@/lib/db";

function ensureTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wht_step_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER NOT NULL,
      step_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

// GET /api/wht/records/[id]/steps/[stepId]/notes
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id, stepId } = await params;
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM wht_record_steps WHERE id = ? AND record_id = ?").get(stepId, id)) return NextResponse.json({ error: "步骤不存在" }, { status: 404 });
  ensureTable(db);
  const rows = db.prepare("SELECT * FROM wht_step_notes WHERE record_id = ? AND step_id = ? ORDER BY created_at DESC").all(id, stepId);
  return NextResponse.json(rows);
}

// POST /api/wht/records/[id]/steps/[stepId]/notes
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id, stepId } = await params;
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM wht_record_steps WHERE id = ? AND record_id = ?").get(stepId, id)) return NextResponse.json({ error: "步骤不存在" }, { status: 404 });
  ensureTable(db);
  const body = await readJson(req);
  const { content, created_by } = body;
  if (!content) return NextResponse.json({ error: "请输入备注内容" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO wht_step_notes (record_id, step_id, content, created_by) VALUES (?, ?, ?, ?)"
  ).run(id, stepId, content, created_by || "");
  const note = db.prepare("SELECT * FROM wht_step_notes WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(note, { status: 201 });
}

// DELETE /api/wht/records/[id]/steps/[stepId]/notes
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const url = new URL(req.url);
  const noteId = url.searchParams.get("id");
  if (!noteId) return NextResponse.json({ error: "缺少 note_id" }, { status: 400 });

  const { id, stepId } = await params;
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM wht_record_steps WHERE id = ? AND record_id = ?").get(stepId, id)) return NextResponse.json({ error: "步骤不存在" }, { status: 404 });
  ensureTable(db);
  db.prepare("DELETE FROM wht_step_notes WHERE id = ? AND record_id = ? AND step_id = ?").run(noteId, id, stepId);
  return NextResponse.json({ success: true });
}
