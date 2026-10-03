import { canClientAttachFile } from "@/lib/client-scope";
import { publicDocument, isPublicDocument } from "@/lib/client-view";
import { isClientDocumentOrderVisible as isClientOrderVisible } from "@/lib/client-scope";
import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";
import { queueDocumentReview, requestProgressFlush } from "@/lib/progress-sync";
import { syncDocumentDelivery } from "@/lib/delivery-sync";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  if (auth.role === "client" && !isClientOrderVisible(auth.id, auth.name, id)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  const db = getDb();
  const rows = db.prepare("SELECT * FROM documents WHERE order_id = ? ORDER BY created_at DESC").all(id);
  return NextResponse.json(auth.role === "client" ? rows.filter(row => isPublicDocument(row, auth.id)).map(publicDocument) : rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  if (auth.role === "client" && !isClientOrderVisible(auth.id, auth.name, id)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  const db = getDb();
  const body = await readJson(req);
  const { name, file_type, direction, file_url, status } = body;
  if (!name) return NextResponse.json({ error: "请提供文档名称" }, { status: 400 });

  if (!db.prepare("SELECT 1 FROM orders WHERE id = ?").get(id)) return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  if (auth.role === "client" && file_url && !canClientAttachFile(auth.id, auth.name, file_url)) {
    return NextResponse.json({ error: "请上传自己的文件，或选择已公开且有权查看的资料" }, { status: 403 });
  }
  const docStatus = auth.role === "client" ? "待审核" : status || "已审核";
  const { doc, delivered } = db.transaction(() => {
    const result = db.prepare(
      "INSERT INTO documents (order_id, name, file_type, status, direction, uploaded_by, file_url, client_author_id, publication_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, name, file_type || "", docStatus, auth.role === "client" ? "client_to_us" : direction || "client_to_us", auth.name, file_url || "", auth.role === "client" ? auth.id : null, isStaff(auth) && direction === "us_to_client" && docStatus === "已审核" ? 1 : 0);
    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(result.lastInsertRowid) as Parameters<typeof syncDocumentDelivery>[3];
    // 员工直接加的已核对公开文件：客户站同步单同时交付给客户（2026-10-03）
    return { doc, delivered: syncDocumentDelivery(db, id, undefined, doc) };
  })();
  if (delivered) requestProgressFlush();
  // 审计日志操作人以登录身份为准，不信任请求体
  logOperation(auth.name, "添加文档", "document", id);
    return NextResponse.json(auth.role === "client" ? publicDocument(doc) : doc, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  if (auth.role === "client" && !isClientOrderVisible(auth.id, auth.name, id)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  const db = getDb();
  const body = await readJson(req);
  const { document_id } = body;

  if (!document_id) return NextResponse.json({ error: "缺少 document_id" }, { status: 400 });

  const existing = db.prepare("SELECT * FROM documents WHERE id = ? AND order_id = ?").get(document_id, id) as Parameters<typeof syncDocumentDelivery>[2];
  if (!existing) return NextResponse.json({ error: "文档不存在" }, { status: 404 });

  // 已交付给客户站客户的文件被删：同时撤回（2026-10-03）
  const withdrawn = db.transaction(() => {
    db.prepare("DELETE FROM documents WHERE id = ?").run(document_id);
    return syncDocumentDelivery(db, id, existing, undefined);
  })();
  if (withdrawn) requestProgressFlush();
  logOperation(auth.name, "删除文档", "document", String(document_id), `订单:${id}`);
  return NextResponse.json({ success: true });
}

/** Review/publication is an explicit staff action, never inferred from a historical text author. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const { id } = await params;
  const { document_id, status, direction, review_note } = await readJson(req);
  if (!document_id || (status === undefined && direction === undefined)) return NextResponse.json({ error: "请提供文档及审核动作" }, { status: 400 });
  if (review_note !== undefined && (typeof review_note !== "string" || review_note.length > 500)) return NextResponse.json({ error: "退回原因最多 500 字" }, { status: 400 });
  if (status !== undefined && !['待审核', '已审核', '已退回'].includes(status)) return NextResponse.json({ error: "审核状态无效" }, { status: 400 });
  if (direction !== undefined && !['client_to_us', 'us_to_client'].includes(direction)) return NextResponse.json({ error: "资料方向无效" }, { status: 400 });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM documents WHERE id = ? AND order_id = ?').get(document_id, id) as (Parameters<typeof syncDocumentDelivery>[2] & { status: string; direction: string; publication_verified: number }) | undefined;
  if (!existing) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  const nextStatus = status ?? existing.status;
  const nextDirection = direction ?? existing.direction;
  const queued = db.transaction(() => {
    db.prepare('UPDATE documents SET status = ?, direction = ?, publication_verified = ? WHERE id = ? AND order_id = ?')
      .run(nextStatus, nextDirection, nextStatus === '已审核' && nextDirection === 'us_to_client' && (direction === 'us_to_client' || existing.publication_verified === 1) ? 1 : 0, document_id, id);
    // 资料打通（2026-10-03）：客户站送来的资料审核后，同一份的其他副本跟着变，结果（含退回原因）回传客户站
    const link = db.prepare("SELECT submission_id FROM sync_documents WHERE document_id = ? LIMIT 1").get(document_id) as { submission_id: string } | undefined;
    let review = false;
    if (link && status !== undefined && nextStatus !== existing.status) {
      db.prepare("UPDATE documents SET status = ? WHERE id IN (SELECT document_id FROM sync_documents WHERE submission_id = ?) AND id <> ?").run(nextStatus, link.submission_id, document_id);
      review = queueDocumentReview(db, link.submission_id, nextStatus, String(review_note || ""));
    }
    // 对客公开状态变化：客户站同步单交付或撤回（2026-10-03）
    const after = db.prepare("SELECT * FROM documents WHERE id = ? AND order_id = ?").get(document_id, id) as Parameters<typeof syncDocumentDelivery>[3];
    if (syncDocumentDelivery(db, id, existing, after)) review = true;
    logOperation(auth.name, "审核资料", "document", String(document_id), `订单:${id} 状态:${nextStatus} 方向:${nextDirection}${review_note ? ` 原因:${String(review_note).slice(0, 100)}` : ""}`);
    return review;
  })();
  if (queued) requestProgressFlush();
  return NextResponse.json(db.prepare('SELECT * FROM documents WHERE id = ? AND order_id = ?').get(document_id, id));
}
