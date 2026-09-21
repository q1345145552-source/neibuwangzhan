import { publicStepDocument } from "@/lib/client-view";
import { isClientOrderVisible } from "@/lib/client-scope";
import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// GET /api/orders/:id/steps/:stepId/documents
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
  const rows = db.prepare("SELECT * FROM step_documents WHERE order_id = ? AND step_id = ? ORDER BY id").all(id, stepId);
  return NextResponse.json(auth.role === "client" ? rows.map(publicStepDocument) : rows);
}
