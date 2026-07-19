import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// POST /api/vat/records/[id]/notes
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { content, created_by } = body;
  if (!content) return NextResponse.json({ error: "请填写备注内容" }, { status: 400 });
  db.prepare("UPDATE vat_records SET notes = COALESCE(notes,'') || ? || '\\n' || '— ' || ? || ' ' || datetime('now') || '\\n\\n' WHERE id = ?")
    .run(content, created_by || "", id);
  return NextResponse.json({ success: true }, { status: 201 });
}
