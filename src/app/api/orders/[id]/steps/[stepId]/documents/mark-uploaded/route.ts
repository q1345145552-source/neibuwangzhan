import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";

// POST /api/orders/:id/steps/:stepId/documents/mark-uploaded
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id, stepId } = await params;
  const db = getDb();
  const body = await readJson(req);
  const { document_id } = body;
  if (!document_id) return NextResponse.json({ error: "请提供 document_id" }, { status: 400 });

  db.prepare("UPDATE step_documents SET status = 'uploaded' WHERE id = ? AND order_id = ? AND step_id = ?").run(document_id, id, stepId);
  const doc = db.prepare("SELECT * FROM step_documents WHERE id = ?").get(document_id);
  logOperation(auth.name, "标记步骤文件已上传", "step_document", String(document_id), (doc as { document_name?: string } | undefined)?.document_name || "");
  return NextResponse.json(doc);
}
