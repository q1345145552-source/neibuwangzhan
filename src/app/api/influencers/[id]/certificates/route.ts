import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(_req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM influencer_certificates WHERE influencer_id = ? ORDER BY created_at DESC"
  ).all(id);
  const res = NextResponse.json(rows);
  res.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  return res;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { certificate_number, product_name, issue_date, expiry_date, notes, file_url } = body;
  if (!certificate_number) return NextResponse.json({ error: "请输入证书编号" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO influencer_certificates (influencer_id, certificate_number, product_name, issue_date, expiry_date, status, notes, file_url) VALUES (?, ?, ?, ?, ?, 'valid', ?, ?)"
  ).run(id, certificate_number, product_name || "", issue_date || "", expiry_date || "", notes || "", file_url || "");
  const cert = db.prepare("SELECT * FROM influencer_certificates WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(cert, { status: 201 });
}
