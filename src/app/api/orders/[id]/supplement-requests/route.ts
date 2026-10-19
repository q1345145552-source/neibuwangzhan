import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";
import { requestProgressFlush } from "@/lib/progress-sync";
import { queueDocumentRequest } from "@/lib/delivery-sync";
import { AWAITING_CONFIRMATION_ERROR, isAwaitingConfirmation } from "@/lib/order-confirm";

// 补件要求（2026-10-03，规则 13）：员工给客户站客户发「还要补什么」，客户在业务网站的资料待办里看到并按它交。

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const { id } = await params;
  // latest_status：客户按这条补件交的、这张单上最近一份资料的审核状态（已退回 → 页面显示「已退回，等客户重交」，2026-10-16）
  return NextResponse.json(getDb().prepare(`SELECT r.*, (SELECT d.status FROM sync_documents sd JOIN documents d ON d.id = sd.document_id
      WHERE sd.requirement_id = 'sreq-' || r.id AND sd.internal_order_id = r.internal_order_id AND sd.withdrawn = 0 ORDER BY sd.id DESC LIMIT 1) AS latest_status
    FROM sync_document_requests r WHERE r.internal_order_id = ? ORDER BY r.created_at DESC, r.rowid DESC`).all(id));
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
  // 客户确认前传不了资料，补件发了也交不上：先确认订单（2026-10-19）
  if (isAwaitingConfirmation(db, id)) return NextResponse.json({ error: AWAITING_CONFIRMATION_ERROR }, { status: 409 });
  const created = db.transaction(() => queueDocumentRequest(db, id, name.trim(), String(description || "").trim(), auth.name))();
  if (!created) return NextResponse.json({ error: "只有客户网站同步过来的单能发补件要求" }, { status: 409 });
  logOperation(auth.name, "发补件要求", "order", id, name.trim());
  requestProgressFlush();
  return NextResponse.json(created, { status: 201 });
}
