import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";
import { requestProgressFlush } from "@/lib/progress-sync";
import { queueDocumentRequest } from "@/lib/delivery-sync";

// 补件要求（2026-10-03，规则 13）：员工给客户站客户发「还要补什么」，客户在业务网站的资料待办里看到并按它交。

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const { id } = await params;
  return NextResponse.json(getDb().prepare("SELECT * FROM sync_document_requests WHERE internal_order_id = ? ORDER BY created_at DESC, rowid DESC").all(id));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const { id } = await params;
  const { name, description } = await readJson(req);
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100) return NextResponse.json({ error: "请填写要补的资料名称（100 字以内）" }, { status: 400 });
  if (description !== undefined && (typeof description !== "string" || description.length > 500)) return NextResponse.json({ error: "说明最多 500 字" }, { status: 400 });
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM orders WHERE id = ?").get(id)) return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  const created = db.transaction(() => queueDocumentRequest(db, id, name.trim(), String(description || "").trim(), auth.name))();
  if (!created) return NextResponse.json({ error: "只有客户网站同步过来的单能发补件要求" }, { status: 409 });
  logOperation(auth.name, "发补件要求", "order", id, name.trim());
  requestProgressFlush();
  return NextResponse.json(created, { status: 201 });
}
