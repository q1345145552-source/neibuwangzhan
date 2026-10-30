import type Database from "better-sqlite3";
import { queueProgressEventsForOrder } from "@/lib/progress-sync";
import { notifyCancelRequest, notifyUnconfirmedOrderCancelled } from "@/lib/order-alerts";
import { isAwaitingConfirmation, siblingOrderIds } from "@/lib/order-confirm";

/**
 * 客户站内申请取消（2026-10-03，规则 19/20）。
 * 客户在业务网站按「第几项服务第几份」申请，这里对应到一张办理单；申请本身不改办理状态（照常办理），
 * 只有管理员同意后才走原有取消（状态客户取消），结果经 sync_document_outbox（payload.event='cancel'）回传客户站。
 * 不涉及退款：退款另行确认。
 */

export type CancelRequestRow = {
  id: string; source_order_no: string; internal_order_id: string; line_no: number; copy_no: number;
  reason: string; status: "pending" | "approved" | "rejected"; decision_note: string; decided_by: string | null; decided_at: string | null; created_at: string;
};
export class CancelRequestError extends Error {
  constructor(message: string, public status = 400, public code = "") { super(message); }
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,80}$/;
const positiveInt = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;

/** 这一份当前的进度版本：结果随带它，客户站据此判断「同意之后的进度到了没有」（不能拿两站各自的收到时间比先后）。 */
function progressSeqOf(db: Database.Database, internalOrderId: string, lineNo: number, copyNo: number): number {
  const row = db.prepare("SELECT progress_seq FROM sync_inbox WHERE internal_order_id = ? AND line_no = ? AND copy_no = ?").get(internalOrderId, lineNo, copyNo) as { progress_seq: number } | undefined;
  return row?.progress_seq ?? 0;
}

function queueResult(db: Database.Database, row: Pick<CancelRequestRow, "id" | "source_order_no" | "internal_order_id" | "line_no" | "copy_no">, status: "approved" | "rejected", note: string): void {
  db.prepare("INSERT INTO sync_document_outbox (id, submission_id, payload) VALUES (?, ?, ?)").run(`CNL-${row.id}-${status}`, row.id,
    JSON.stringify({ event: "cancel", source_order_no: row.source_order_no, request_id: row.id, line_no: row.line_no, copy_no: row.copy_no, status, note,
      progress_seq: progressSeqOf(db, row.internal_order_id, row.line_no, row.copy_no) }));
}

/** 客户站送来的申请：幂等（同一申请号重发只回现状）。办理单已是客户取消的，直接记同意。 */
export function receiveCancelRequest(db: Database.Database, body: unknown, customerName = ""): { request_id: string; status: string; note: string; progress_seq: number } {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const { source_order_no, request_id, line_no, copy_no, reason } = b;
  if (typeof source_order_no !== "string" || !source_order_no || source_order_no.length > 64 || typeof request_id !== "string" || !REQUEST_ID.test(request_id) ||
    !positiveInt(line_no) || !positiveInt(copy_no) || typeof reason !== "string" || !reason.trim() || reason.length > 500) throw new CancelRequestError("取消申请字段非法");
  return db.transaction(() => {
    const existing = db.prepare("SELECT status, decision_note, internal_order_id FROM sync_cancel_requests WHERE id = ?").get(request_id) as { status: string; decision_note: string; internal_order_id: string } | undefined;
    if (existing) return { request_id, status: existing.status, note: existing.decision_note, progress_seq: progressSeqOf(db, existing.internal_order_id, line_no, copy_no) };
    const target = db.prepare(`SELECT i.internal_order_id, o.status FROM sync_inbox i JOIN orders o ON o.id = i.internal_order_id
      WHERE i.source_order_no = ? AND i.line_no = ? AND i.copy_no = ? AND i.internal_order_id IS NOT NULL LIMIT 1`).get(source_order_no, line_no, copy_no) as { internal_order_id: string; status: string } | undefined;
    if (!target) throw new CancelRequestError("找不到这项服务对应的办理单，稍后重试", 409);
    const already = target.status === "客户取消";
    db.prepare(`INSERT INTO sync_cancel_requests (id, source_order_no, internal_order_id, line_no, copy_no, reason, status, decision_note, decided_by, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${already ? "datetime('now')" : "NULL"})`)
      .run(request_id, source_order_no, target.internal_order_id, line_no, copy_no, reason.trim(), already ? "approved" : "pending", already ? "该服务已取消" : "", already ? "系统" : null);
    if (!already) notifyCancelRequest(db, target.internal_order_id,
      `客户站订单 ${source_order_no}（${customerName || "客户"}）申请取消第 ${line_no} 项服务第 ${copy_no} 份（办理单 ${target.internal_order_id}），原因：${reason.trim().slice(0, 200)}。请管理员到该订单页处理；处理前照常办理。`);
    return { request_id, status: already ? "approved" : "pending", note: already ? "该服务已取消" : "", progress_seq: progressSeqOf(db, target.internal_order_id, line_no, copy_no) };
  }).immediate();
}

/**
 * 管理员处理申请。同意 = 原有取消（状态客户取消、原因记「客户申请取消：…」）+ 进度事件 + 结果事件；
 * 不同意必须写原因。返回入队的进度事件数（>0 时调用方要 requestProgressFlush）。
 */
export function decideCancelRequest(db: Database.Database, orderId: string, requestId: string, decision: "approve" | "reject", note: string, by: string): number {
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM sync_cancel_requests WHERE id = ? AND internal_order_id = ?").get(requestId, orderId) as CancelRequestRow | undefined;
    if (!row) throw new CancelRequestError("取消申请不存在", 404);
    if (row.status !== "pending") throw new CancelRequestError("这条申请已经处理过了，请刷新页面", 409);
    if (decision === "reject") {
      if (!note) throw new CancelRequestError("请填写不同意的原因（客户能看到）");
      db.prepare("UPDATE sync_cancel_requests SET status = 'rejected', decision_note = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(note, by, row.id);
      queueResult(db, row, "rejected", note);
      return 0;
    }
    const order = db.prepare("SELECT status FROM orders WHERE id = ?").get(orderId) as { status: string } | undefined;
    if (!order) throw new CancelRequestError("订单不存在", 404);
    let queued = 0;
    if (order.status !== "客户取消") {
      db.prepare("UPDATE orders SET status = '客户取消', cancel_reason = ?, updated_at = ? WHERE id = ?").run(`客户申请取消：${row.reason}`.slice(0, 500), new Date().toISOString(), orderId);
      queued = queueProgressEventsForOrder(orderId, db);
    }
    approvePending(db, orderId, by, note);
    return queued;
  }).immediate();
}

/** 管理员同意，或直接用「取消订单」取消了这张单：这张单上待处理的申请一并记同意并回传。在调用方事务内执行。 */
export function approvePending(db: Database.Database, orderId: string, by: string, note = ""): number {
  const rows = db.prepare("SELECT * FROM sync_cancel_requests WHERE internal_order_id = ? AND status = 'pending'").all(orderId) as CancelRequestRow[];
  for (const row of rows) {
    db.prepare("UPDATE sync_cancel_requests SET status = 'approved', decision_note = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(note, by, row.id);
    queueResult(db, row, "approved", note);
  }
  return rows.length;
}

export function listCancelRequests(db: Database.Database, orderId: string): CancelRequestRow[] {
  return db.prepare("SELECT * FROM sync_cancel_requests WHERE internal_order_id = ? ORDER BY created_at DESC, rowid DESC").all(orderId) as CancelRequestRow[];
}

/**
 * 还没确认的单客户直接取消（2026-10-30 老板：「没确认的单直接取消」）。
 * 客户在业务网站点「取消订单」时当场来问：这笔客户订单还没人点「确认订单」、拆出的办理单一步都没办，就一起改成客户取消，
 * 不用等管理员；已确认或已开始办的不动，客户那边照旧在办理进度里按服务申请取消。
 * 回执带上每一份最新的进度事件（跟推回客户站的是同一份、同一个版本号），客户站当场照着改；随后推过去的同一份按版本号自动跳过。
 * 上次回执丢了客户再点：都已经是客户取消就照样回成功和最新进度。
 */
export function cancelUnconfirmedOrder(db: Database.Database, body: unknown, customerName = ""): { source_order_no: string; order_ids: string[]; already: boolean; events: unknown[]; queued: number } {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const sourceOrderNo = b.source_order_no;
  if (typeof sourceOrderNo !== "string" || !sourceOrderNo || sourceOrderNo.length > 64) throw new CancelRequestError("取消请求字段非法");
  return db.transaction(() => {
    const synced = db.prepare("SELECT source, financial_json FROM sync_orders WHERE source_order_no = ?").get(sourceOrderNo) as { source: string; financial_json: string } | undefined;
    if (!synced) throw new CancelRequestError("办理系统还没收到这张单", 409, "NOT_RECEIVED");
    // 月费单没有「确认订单」这一说，不归这里取消
    if (synced.source === "recurring") throw new CancelRequestError("月费账单不能直接取消", 409, "NOT_CANCELLABLE");
    // 收过钱（已付款或记了定金）的要人工处理，客户站先拦，这里按收到的账单再兜一次；账单读不出来也不让直接取消
    let money: { depositCents?: unknown; billingStatus?: unknown } | null = null;
    try { money = JSON.parse(synced.financial_json); } catch { /* 当作收过钱 */ }
    if (!money || money.billingStatus === "paid" || Number(money.depositCents || 0) > 0) throw new CancelRequestError("这张单已经收过钱", 409, "PAID");
    const orderIds = siblingOrderIds(db, sourceOrderNo);
    if (!orderIds.length) throw new CancelRequestError("这张单没有对应的办理单", 409, "NOT_CANCELLABLE");
    const statusOf = db.prepare("SELECT status FROM orders WHERE id = ?");
    const open = orderIds.filter(id => (statusOf.get(id) as { status: string } | undefined)?.status !== "客户取消");
    if (open.length) {
      if (db.prepare("SELECT 1 FROM sync_order_confirmations WHERE source_order_no = ?").get(sourceOrderNo)) throw new CancelRequestError("这张单已经确认了", 409, "ORDER_CONFIRMED");
      if (open.some(id => !isAwaitingConfirmation(db, id))) throw new CancelRequestError("这张单已经开始办理了", 409, "ORDER_STARTED");
    }
    let queued = 0;
    const now = new Date().toISOString();
    for (const id of open) {
      db.prepare("UPDATE orders SET status = '客户取消', cancel_reason = ?, updated_at = ? WHERE id = ?").run("客户在业务网站取消（订单还没确认）", now, id);
      queued += queueProgressEventsForOrder(id, db);
      // 客户之前点过「申请取消」还没人处理的，一并记同意（结果放在进度入队之后，带的才是这次取消的版本）
      queued += approvePending(db, id, "客户自己取消");
    }
    if (open.length) notifyUnconfirmedOrderCancelled(db, open[0],
      `客户站订单 ${sourceOrderNo}（${customerName || "客户"}）还没确认，客户在业务网站自己取消了，办理单 ${open.join("、")} 已改为「客户取消」，不用再确认。`);
    const latest = db.prepare("SELECT payload FROM sync_progress_outbox WHERE inbox_id = ? ORDER BY rowid DESC LIMIT 1");
    const inbox = db.prepare(`SELECT id FROM sync_inbox WHERE source_order_no = ? AND internal_order_id IS NOT NULL AND internal_order_id <> ''
      ORDER BY line_no, copy_no`).all(sourceOrderNo) as { id: string }[];
    const events = inbox.map(row => latest.get(row.id) as { payload: string } | undefined).filter(Boolean).map(row => JSON.parse(row!.payload) as unknown);
    return { source_order_no: sourceOrderNo, order_ids: orderIds, already: open.length === 0, events, queued };
  }).immediate();
}
