import { publicDocument, isPublicDocument } from "@/lib/client-view";
import { getClientCustomerNames, customerNameFilter } from "@/lib/client-scope";
import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";
import { customerDocumentDeleteError, isLiveCustomerSubmission, syncDocumentDelivery } from "@/lib/delivery-sync";
import { requestProgressFlush } from "@/lib/progress-sync";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const business = searchParams.get("business");

  // live_submission：客户在客户站交来、客户还没撤回的资料（不能直接删，页面不显示删除按钮，2026-10-16）
  let sql = "SELECT d.*, o.customer_name, bt.name AS business_line, EXISTS (SELECT 1 FROM sync_documents sd WHERE sd.document_id = d.id AND sd.withdrawn = 0) AS live_submission FROM documents d LEFT JOIN orders o ON d.order_id = o.id LEFT JOIN business_types bt ON o.business_type_id = bt.id";
  const conditions: string[] = [];
  const params: string[] = [];
  if (auth.role === "client") {
    const { names } = getClientCustomerNames(auth.id, auth.name);
    const scope = customerNameFilter(names);
    conditions.push(scope.clause);
    params.push(...scope.params);
  }
  if (business) {
    conditions.push("bt.name = ?");
    params.push(business);
  }
  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY d.created_at DESC";
  const rows = db.prepare(sql).all(...params);
  const res = NextResponse.json(auth.role === "client" ? rows.filter(row => isPublicDocument(row, auth.id)).map(publicDocument) : rows);
  res.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res;
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const { name, file_type, file_url, order_id } = body;
  if (!name) return NextResponse.json({ error: "请提供文档名称" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO documents (order_id, name, file_type, status, direction, uploaded_by, file_url) VALUES (?, ?, ?, '已审核', 'client_to_us', ?, ?)"
  ).run(order_id || null, name, file_type || "", auth.name, file_url || "");
  logOperation(auth.name, "新增文档", "document", String(result.lastInsertRowid), name);
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(doc, { status: 201 });
}
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少文档ID" }, { status: 400 });

  const db = getDb();
  // 跟订单详情里的删除同一套（2026-10-16）：客户站交来的资料不能直接删（要退回）；已交付给客户的文件删了，客户站那边同时撤回
  const existing = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as (Parameters<typeof syncDocumentDelivery>[2] & { order_id?: string | null }) | undefined;
  if (!existing) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  if (isLiveCustomerSubmission(db, id)) return NextResponse.json({ error: customerDocumentDeleteError(existing.status) }, { status: 409 });
  const withdrawn = db.transaction(() => {
    db.prepare("DELETE FROM documents WHERE id = ?").run(id);
    return existing.order_id ? syncDocumentDelivery(db, existing.order_id, existing, undefined) : false;
  })();
  if (withdrawn) requestProgressFlush();
  logOperation(auth.name, "删除文档", "document", String(id));
  return NextResponse.json({ success: true });
}
