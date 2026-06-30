import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const rows = db.prepare("SELECT * FROM certificates WHERE order_id = ? ORDER BY created_at DESC").all(id);
  return NextResponse.json(rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { certificate_number, product_name, issue_date, expiry_date, notes } = body;
  if (!certificate_number) return NextResponse.json({ error: "请输入证书编号" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO certificates (order_id, certificate_number, product_name, issue_date, expiry_date, status, notes) VALUES (?, ?, ?, ?, ?, 'valid', ?)"
  ).run(id, certificate_number, product_name || "", issue_date || "", expiry_date || "", notes || "");
  const cert = db.prepare("SELECT * FROM certificates WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(cert, { status: 201 });
}
