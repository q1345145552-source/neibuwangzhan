import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const rows = db.prepare("SELECT * FROM documents WHERE order_id = ? ORDER BY created_at DESC").all(id);
  return NextResponse.json(rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { name, file_type, uploaded_by, direction, file_url, status } = body;
  if (!name) return NextResponse.json({ error: "请提供文档名称" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO documents (order_id, name, file_type, status, direction, uploaded_by, file_url) VALUES (?, ?, ?, status || "已审核", ?, ?, ?)"
  ).run(id, name, file_type || "", direction || "client_to_us", uploaded_by || "", file_url || "");
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(doc, { status: 201 });
}
