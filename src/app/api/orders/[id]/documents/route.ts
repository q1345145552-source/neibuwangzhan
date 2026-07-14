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
  const rows = db.prepare("SELECT * FROM documents WHERE order_id = ? ORDER BY created_at DESC").all(id);
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
  const { name, file_type, uploaded_by, direction, file_url, status } = body;
  if (!name) return NextResponse.json({ error: "请提供文档名称" }, { status: 400 });

  const docStatus = status || "已审核";
  const result = db.prepare(
    "INSERT INTO documents (order_id, name, file_type, status, direction, uploaded_by, file_url) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, name, file_type || "", docStatus, direction || "client_to_us", uploaded_by || auth.name, file_url || "");
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(result.lastInsertRowid);
  // 审计日志操作人以登录身份为准，不信任请求体
  logOperation(auth.name, "添加文档", "document", id);
    return NextResponse.json(doc, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const { document_id } = body;

  if (!document_id) return NextResponse.json({ error: "缺少 document_id" }, { status: 400 });

  const existing = db.prepare("SELECT * FROM documents WHERE id = ? AND order_id = ?").get(document_id, id);
  if (!existing) return NextResponse.json({ error: "文档不存在" }, { status: 404 });

  db.prepare("DELETE FROM documents WHERE id = ?").run(document_id);
  logOperation(auth.name, "删除文档", "document", String(document_id), `订单:${id}`);
  return NextResponse.json({ success: true });
}
