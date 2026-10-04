import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

/**
 * 补件要求与交付结果回传客户站（2026-10-03，规则 13「补件要求、交付结果」）。
 * 只对客户站同步过来的办理单生效；事件与业务写入同一事务进 sync_document_outbox，提交后由
 * progress-sync 的 flushDocumentReviews 按 payload.event 发往客户站。
 *
 * 「交付」沿用内部已有的对客公开口径：文档 direction=us_to_client + 已审核 + publication_verified=1，
 * 以及证书（内部自己的客户视角本来就整条可见）。同一交付号（doc-<id> / cert-<id>）的事件 seq 递增，
 * 客户站只接受更大的 seq；撤回（取消公开、删除）发 withdraw。
 */

/** 这张内部办理单来自哪张客户站订单；不是同步单返回 null。 */
export function sourceOrderOf(db: Database.Database, internalOrderId: string): string | null {
  const row = db.prepare("SELECT source_order_no FROM sync_inbox WHERE internal_order_id = ? LIMIT 1").get(internalOrderId) as { source_order_no: string } | undefined;
  return row?.source_order_no ?? null;
}

/** 发一条补件要求；不是同步单返回 null。 */
export function queueDocumentRequest(db: Database.Database, internalOrderId: string, name: string, description: string, createdBy: string) {
  const sourceOrderNo = sourceOrderOf(db, internalOrderId);
  if (!sourceOrderNo) return null;
  const id = randomUUID();
  db.prepare("INSERT INTO sync_document_requests (id, source_order_no, internal_order_id, name, description, created_by) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, sourceOrderNo, internalOrderId, name, description, createdBy);
  db.prepare("INSERT INTO sync_document_outbox (id, submission_id, payload) VALUES (?, ?, ?)").run(`DRQ-${randomUUID()}`, id,
    JSON.stringify({ event: "request", source_order_no: sourceOrderNo, request_id: id, name, description }));
  return db.prepare("SELECT * FROM sync_document_requests WHERE id = ?").get(id);
}

type DocumentRow = { id: number; name: string; status: string; direction: string; publication_verified: number; file_url: string };
type CertificateRow = { id: number; certificate_number: string; product_name: string; issue_date: string; expiry_date: string; status: string; file_url: string };

export function isPublishedDocument(doc: Pick<DocumentRow, "status" | "direction" | "publication_verified"> | undefined): boolean {
  return !!doc && doc.direction === "us_to_client" && doc.status === "已审核" && Number(doc.publication_verified) === 1;
}

function queueDelivery(db: Database.Database, internalOrderId: string, deliveryId: string, item: Record<string, unknown>): boolean {
  const sourceOrderNo = sourceOrderOf(db, internalOrderId);
  if (!sourceOrderNo) return false;
  // 发件箱从不删行，按同一交付号已有事件数递增即为单调版本
  const seq = (db.prepare("SELECT COUNT(*) AS n FROM sync_document_outbox WHERE submission_id = ?").get(deliveryId) as { n: number }).n + 1;
  db.prepare("INSERT INTO sync_document_outbox (id, submission_id, payload) VALUES (?, ?, ?)").run(`DLV-${randomUUID()}`, deliveryId,
    JSON.stringify({ event: "delivery", source_order_no: sourceOrderNo, delivery_id: deliveryId, seq, ...item }));
  return true;
}

/** 文档公开状态变化后调用：变成公开 → 交付；从公开变成不公开 → 撤回；其余不发。 */
export function syncDocumentDelivery(db: Database.Database, internalOrderId: string, before: DocumentRow | undefined, after: DocumentRow | undefined): boolean {
  const was = isPublishedDocument(before), now = isPublishedDocument(after);
  const id = (after ?? before)?.id;
  if (!id || was === now && !(now && before && after && (before.name !== after.name || before.file_url !== after.file_url))) return false;
  if (now && after) return queueDelivery(db, internalOrderId, `doc-${id}`, { action: "upsert", kind: "document", name: after.name, meta: {}, has_file: !!after.file_url });
  return queueDelivery(db, internalOrderId, `doc-${id}`, { action: "withdraw" });
}

/** 证书新增/修改后调用（交付），删除后传 null（撤回）。 */
export function syncCertificateDelivery(db: Database.Database, internalOrderId: string, certId: number, cert: CertificateRow | null): boolean {
  if (!cert) return queueDelivery(db, internalOrderId, `cert-${certId}`, { action: "withdraw" });
  return queueDelivery(db, internalOrderId, `cert-${cert.id}`, {
    action: "upsert", kind: "certificate",
    name: ["证书", cert.product_name, cert.certificate_number ? `编号 ${cert.certificate_number}` : ""].filter(Boolean).join(" · "),
    meta: { certificate_number: cert.certificate_number, product_name: cert.product_name, issue_date: cert.issue_date, expiry_date: cert.expiry_date, status: cert.status },
    has_file: !!cert.file_url,
  });
}

/** 客户站资料清单带回的 requirement_id 若是本站发出的补件要求（sreq-<id>），标记客户已交；只认同一张客户单发出的要求。 */
export function markRequestSubmitted(db: Database.Database, requirementId: unknown, sourceOrderNo: string): void {
  if (typeof requirementId !== "string" || !requirementId.startsWith("sreq-")) return;
  db.prepare("UPDATE sync_document_requests SET submitted_at = COALESCE(submitted_at, datetime('now')) WHERE id = ? AND source_order_no = ?").run(requirementId.slice(5), sourceOrderNo);
}
