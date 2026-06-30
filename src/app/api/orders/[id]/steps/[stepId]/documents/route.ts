import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/orders/:id/steps/:stepId/documents
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const { id, stepId } = await params;
  const db = getDb();
  const rows = db.prepare("SELECT * FROM step_documents WHERE order_id = ? AND step_id = ? ORDER BY id").all(id, stepId);
  return NextResponse.json(rows);
}
