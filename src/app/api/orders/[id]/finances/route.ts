import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const rows = db.prepare("SELECT * FROM finances WHERE order_id = ? ORDER BY created_at DESC").all(id);
  return NextResponse.json(rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { type, amount, description } = body;
  if (!type || !amount) return NextResponse.json({ error: "请提供类型和金额" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO finances (order_id, type, amount, status, description) VALUES (?, ?, ?, 'pending', ?)"
  ).run(id, type, amount, description || "");
  const fin = db.prepare("SELECT * FROM finances WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(fin, { status: 201 });
}
