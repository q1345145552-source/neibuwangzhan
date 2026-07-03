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
  const db = getDb();
  const rows = db.prepare("SELECT * FROM step_documents WHERE order_id = ? AND step_id = ? ORDER BY id").all(id, stepId);
  return NextResponse.json(rows);
}
