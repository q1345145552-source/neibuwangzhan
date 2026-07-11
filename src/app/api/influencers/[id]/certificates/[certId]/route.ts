import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; certId: string }> }
) {
  const { id, certId } = await params;
  const db = getDb();
  const body = await req.json();
  const { certificate_number, product_name, issue_date, expiry_date, status, notes, file_url } = body;

  const existing = db.prepare("SELECT * FROM influencer_certificates WHERE id = ? AND influencer_id = ?").get(certId, id);
  if (!existing) return NextResponse.json({ error: "证书不存在" }, { status: 404 });

  const fields: string[] = [];
  const values: unknown[] = [];
  if (certificate_number !== undefined) { fields.push("certificate_number = ?"); values.push(certificate_number); }
  if (product_name !== undefined) { fields.push("product_name = ?"); values.push(product_name); }
  if (issue_date !== undefined) { fields.push("issue_date = ?"); values.push(issue_date); }
  if (expiry_date !== undefined) { fields.push("expiry_date = ?"); values.push(expiry_date); }
  if (notes !== undefined) { fields.push("notes = ?"); values.push(notes); }
  if (file_url !== undefined) { fields.push("file_url = ?"); values.push(file_url); }

  if (status !== undefined) {
    fields.push("status = ?"); values.push(status);
  } else if (expiry_date) {
    const expDate = new Date(expiry_date);
    const now = new Date();
    const diffDays = Math.floor((expDate.getTime() - now.getTime()) / 86400000);
    const calcStatus = diffDays < 0 ? "expired" : diffDays <= 30 ? "expiring" : "valid";
    fields.push("status = ?"); values.push(calcStatus);
  }

  if (fields.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  values.push(certId);
  db.prepare(`UPDATE influencer_certificates SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  const cert = db.prepare("SELECT * FROM influencer_certificates WHERE id = ?").get(certId);
  return NextResponse.json(cert);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; certId: string }> }
) {
  const { id, certId } = await params;
  const db = getDb();

  const existing = db.prepare("SELECT * FROM influencer_certificates WHERE id = ? AND influencer_id = ?").get(certId, id);
  if (!existing) return NextResponse.json({ error: "证书不存在" }, { status: 404 });

  db.prepare("DELETE FROM influencer_certificates WHERE id = ?").run(certId);
  return NextResponse.json({ success: true });
}
