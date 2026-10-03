import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb } from "@/lib/db";

// GET /api/vat/records/[id]/steps/[stepId]/documents
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const { id, stepId } = await params;
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM vat_record_steps WHERE id = ? AND record_id = ?").get(stepId, id)) return NextResponse.json({ error: "步骤不存在" }, { status: 404 });
  const rows = db.prepare("SELECT * FROM vat_step_documents WHERE record_id = ? AND step_id = ? ORDER BY id").all(id, stepId);
  return NextResponse.json(rows);
}

// POST /api/vat/records/[id]/steps/[stepId]/documents — mark as uploaded
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id, stepId } = await params;
  const body = await readJson(req);
  const { document_id } = body;
  if (!document_id) return NextResponse.json({ error: "缺少 document_id" }, { status: 400 });

  const db = getDb();
  if (!db.prepare("SELECT 1 FROM vat_record_steps WHERE id = ? AND record_id = ?").get(stepId, id)) return NextResponse.json({ error: "步骤不存在" }, { status: 404 });
  db.prepare("UPDATE vat_step_documents SET status = 'uploaded' WHERE id = ? AND record_id = ? AND step_id = ?")
    .run(document_id, id, stepId);
  const rows = db.prepare("SELECT * FROM vat_step_documents WHERE record_id = ? AND step_id = ? ORDER BY id").all(id, stepId);
  return NextResponse.json(rows);
}
