import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb, logOperation } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const rows = db.prepare("SELECT * FROM certificates WHERE order_id = ? ORDER BY created_at DESC").all(id);
  return NextResponse.json(rows);
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
    "INSERT INTO certificates (order_id, certificate_number, product_name, issue_date, expiry_date, status, notes, file_url) VALUES (?, ?, ?, ?, ?, 'valid', ?, ?)"
  ).run(id, certificate_number, product_name || "", issue_date || "", expiry_date || "", notes || "", file_url || "");
  const cert = db.prepare("SELECT * FROM certificates WHERE id = ?").get(result.lastInsertRowid) as { id: number };
  logOperation("系统", "添加证书", "certificate", String(cert.id), `订单:${id}`);
  return NextResponse.json(cert, { status: 201 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { cert_id, certificate_number, product_name, issue_date, expiry_date, status, nsw_registration, nsw_download_status, notes, file_url } = body;
  if (!cert_id) return NextResponse.json({ error: "缺少 cert_id" }, { status: 400 });

  const fields: string[] = [];
  const values: unknown[] = [];
  if (certificate_number !== undefined) { fields.push("certificate_number = ?"); values.push(certificate_number); }
  if (product_name !== undefined) { fields.push("product_name = ?"); values.push(product_name); }
  if (issue_date !== undefined) { fields.push("issue_date = ?"); values.push(issue_date); }
  if (expiry_date !== undefined) { fields.push("expiry_date = ?"); values.push(expiry_date); }
  if (nsw_registration !== undefined) { fields.push("nsw_registration = ?"); values.push(nsw_registration); }
  if (nsw_download_status !== undefined) { fields.push("nsw_download_status = ?"); values.push(nsw_download_status); }
  if (notes !== undefined) { fields.push("notes = ?"); values.push(notes); }
  if (file_url !== undefined) { fields.push("file_url = ?"); values.push(file_url); }

  // Auto-calculate status based on expiry_date (unless explicitly provided)
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
  values.push(cert_id);
  db.prepare(`UPDATE certificates SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  const cert = db.prepare("SELECT * FROM certificates WHERE id = ?").get(cert_id);
  return NextResponse.json(cert);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { cert_id } = body;

  if (!cert_id) return NextResponse.json({ error: "缺少 cert_id" }, { status: 400 });

  const existing = db.prepare("SELECT * FROM certificates WHERE id = ? AND order_id = ?").get(cert_id, id);
  if (!existing) return NextResponse.json({ error: "证书不存在" }, { status: 404 });

  db.prepare("DELETE FROM certificates WHERE id = ?").run(cert_id);
  logOperation("系统", "删除证书", "certificate", String(cert_id), `订单:${id}`);
  return NextResponse.json({ success: true });
}
