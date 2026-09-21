import { isClientOrderVisible } from "@/lib/client-scope";
import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb } from "@/lib/db";

// POST /api/orders/:id/steps/:stepId/documents/mark-uploaded
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id, stepId } = await params;
  if (auth.role === "client" && !isClientOrderVisible(auth.id, auth.name, id)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  const db = getDb();
  const body = await readJson(req);
  const { document_id } = body;
  if (!document_id) return NextResponse.json({ error: "请提供 document_id" }, { status: 400 });

  db.prepare("UPDATE step_documents SET status = 'uploaded' WHERE id = ? AND order_id = ? AND step_id = ?").run(document_id, id, stepId);
  const doc = db.prepare("SELECT * FROM step_documents WHERE id = ? AND order_id = ? AND step_id = ?").get(document_id, id, stepId);
  if (!doc) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  return NextResponse.json(doc);
}
