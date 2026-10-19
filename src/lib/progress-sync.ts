import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "./db";
import { customerStepView } from "./step-public-copy";
import { notifySyncBackFailure } from "./order-alerts";
import { isAwaitingConfirmation } from "./order-confirm";

/**
 * 内部 → 客户站：业务写入与 seq/outbox 必须在同一数据库事务中提交；
 * 网络只在提交之后异步发送，客户站离线不阻塞员工保存。
 * 事件仅包含公开状态/步骤，按每份订单的递增 seq 抵御重放与乱序。
 */
interface InboxRow {
  id: string;
  source_order_no: string;
  line_no: number;
  copy_no: number;
  progress_seq: number;
}

/**
 * 传入业务事务所用连接；嵌套调用使用 savepoint，独立调用也保证 seq/outbox 原子。
 * 入队错误必须向外抛出，由业务事务回滚，禁止吞掉后继续返回成功。
 */
export function queueProgressEventsForOrder(orderId: string, db: Database.Database = getDb(), options: { textOnly?: boolean } = {}): number {
  return db.transaction(() => {
    const rows = db.prepare(
      "SELECT id, source_order_no, line_no, copy_no, progress_seq FROM sync_inbox WHERE internal_order_id = ?"
    ).all(orderId) as InboxRow[];
    if (rows.length === 0) return 0;

    const order = db.prepare("SELECT status, business_type_id, sub_service_type, address_type FROM orders WHERE id = ?").get(orderId) as
      { status: string; business_type_id: number; sub_service_type: string | null; address_type: string | null } | undefined;
    if (!order) return 0;
    // 已确认、还没开始办（2026-10-19）：内部状态仍是「待处理」，回传「已确认」，客户站据此从「待确认」变「已确认」。
    // 还在等确认的照旧回传「待处理」。老版客户站不认识「已确认」只会不改整单状态，不会改错。
    const status = order.status === "待处理" && !isAwaitingConfirmation(db, orderId) ? "已确认" : order.status;
    // 白名单：禁止 SELECT * 或带入备注、负责人、费用、内部描述。
    // 内部步骤名本身就带员工名和内部费用，只回传客户可见名（见 orderPublicStepNames：建单时记下的，老单按对照表）。
    // 有统一子标题的步骤（2026-10-20 老板 1A）：客户看到子标题，多带一段说明；没有的照旧，不带 description（老版客户站只认三个字段，多的会丢掉）。
    const internalSteps = db.prepare(
      "SELECT step_order, step_name, status, public_name FROM order_steps WHERE order_id = ? ORDER BY step_order"
    ).all(orderId) as { step_order: number; step_name: string; status: string; public_name: string | null }[];
    const view = customerStepView(order, internalSteps);
    const steps = internalSteps.map((step, i) => view[i].description
      ? { step_order: step.step_order, step_name: view[i].name, status: step.status, description: view[i].description }
      : { step_order: step.step_order, step_name: view[i].name, status: step.status });
    const insert = db.prepare("INSERT INTO sync_progress_outbox (id, inbox_id, payload) VALUES (?, ?, ?)");
    const bump = db.prepare("UPDATE sync_inbox SET progress_seq = progress_seq + 1 WHERE id = ?");
    const latest = db.prepare("SELECT payload FROM sync_progress_outbox WHERE inbox_id = ? ORDER BY rowid DESC LIMIT 1");
    const publicState = JSON.stringify({ status, steps });
    let queued = 0;
    for (const row of rows) {
      // 客户看得到的内容（状态、步骤名、步骤状态）没变就不发：客户站每收到一次都会给客户发「办理进度更新」通知，
      // 员工只改备注/负责人/提交次数时不能让客户收到空通知。上一条解析不了就照发，不拦员工保存。
      const last = latest.get(row.id) as { payload: string } | undefined;
      if (last) {
        try {
          const previous = JSON.parse(last.payload) as { status?: unknown; steps?: unknown };
          if (JSON.stringify({ status: previous.status, steps: previous.steps }) === publicState) continue;
          // 只补发名字/说明变了的（textOnly）：状态或哪一步办到哪变了却没发过，不归这里管，不顺手推给客户
          if (options.textOnly && JSON.stringify({ status: previous.status, steps: statusesOf(previous.steps) }) !== JSON.stringify({ status, steps: statusesOf(steps) })) continue;
        } catch { if (options.textOnly) continue; /* 照发 */ }
      } else if (options.textOnly) continue;
      queued++;
      bump.run(row.id);
      insert.run(`PGR-${randomUUID()}`, row.id, JSON.stringify({
        source_order_no: row.source_order_no,
        line_no: row.line_no,
        copy_no: row.copy_no,
        seq: row.progress_seq + 1,
        status,
        steps,
      }));
    }
    return queued;
  })();
}

/** 每一步办到哪（不看名字、说明）：用来分辨「只是名字/说明变了」 */
function statusesOf(steps: unknown): unknown {
  return Array.isArray(steps) ? steps.map(step => [(step as { step_order?: unknown })?.step_order, (step as { status?: unknown })?.status]) : steps;
}

/**
 * 客户看到的步骤名字/说明改了（程序里的子标题改了、2A 老单换子标题），客户站存的还是旧的：
 * 每次启动给已经回传过进度的客户站单补发一次，只补「名字/说明变了、状态没变」的；没变的不发，所以只会补一次。
 * 客户站收到这种只改字的进度不给客户发通知（客户站 progress.ts）。
 */
export function resendChangedPublicText(db: Database.Database = getDb()): number {
  const ids = db.prepare(
    "SELECT DISTINCT internal_order_id AS id FROM sync_inbox si WHERE internal_order_id IS NOT NULL AND internal_order_id <> '' AND EXISTS (SELECT 1 FROM sync_progress_outbox o WHERE o.inbox_id = si.id)"
  ).all() as { id: string }[];
  let queued = 0;
  for (const { id } of ids) {
    try { queued += queueProgressEventsForOrder(id, db, { textOnly: true }); }
    catch (error) { console.error("[sync] 补发客户看到的步骤名失败:", id, error); }
  }
  return queued;
}

interface FlushResult { sent: number; failed: number; skipped: boolean }
interface PendingProgress { id: string; payload: string; attempts: number }
interface WorkerState {
  flushing: boolean;
  docFlushing?: boolean;
  timer?: ReturnType<typeof setInterval>;
}

// Next 的 instrumentation、route bundle 和热重载可能有不同模块实例。
// 定时器与单飞锁都必须是同一进程的全局状态，而非模块局部布尔值。
function workerState(): WorkerState {
  const global = globalThis as typeof globalThis & { __xtProgressSyncState?: WorkerState };
  return global.__xtProgressSyncState ??= { flushing: false };
}

export async function flushProgress(): Promise<FlushResult> {
  const state = workerState();
  if (state.flushing) return { sent: 0, failed: 0, skipped: true };
  const url = process.env.CUSTOMER_SYNC_URL;
  const secret = process.env.SYNC_SECRET;
  if (!url || !secret) return { sent: 0, failed: 0, skipped: true };
  state.flushing = true;
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT id, payload, attempts FROM sync_progress_outbox WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now')) ORDER BY next_attempt_at, created_at, rowid LIMIT 100"
    ).all() as PendingProgress[];
    let sent = 0, failed = 0;
    const stuck: StuckItem[] = [];
    for (const row of rows) {
      try {
        const resp = await fetch(`${url.replace(/\/$/, "")}/api/sync/progress`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
          body: row.payload,
          signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const ack = await resp.json() as Record<string, unknown>;
        const event = JSON.parse(row.payload);
        if (ack.ok !== true || ack.ignored !== undefined || ack.source_order_no !== event.source_order_no ||
          ack.line_no !== event.line_no || ack.copy_no !== event.copy_no || !Number.isSafeInteger(ack.seq) || Number(ack.seq) < event.seq) {
          throw new Error('客户站未确认对应订单行和进度版本');
        }
        db.prepare("UPDATE sync_progress_outbox SET status = 'sent', sent_at = datetime('now'),last_error=NULL WHERE id = ?").run(row.id);
        sent++;
      } catch (error) {
        failed++;
        const attempts = Number(row.attempts || 0) + 1;
        const delay = Math.min(2 ** Math.min(attempts, 16) * 5, 600);
        db.prepare("UPDATE sync_progress_outbox SET attempts=?,next_attempt_at=datetime('now','+' || ? || ' seconds'),last_error=? WHERE id=?")
          .run(attempts,delay,String(error).slice(0,500),row.id);
        console.error("[progress] 推送失败，退避后重试:", error);
        if (attempts === ALERT_ATTEMPTS) stuck.push({ sourceOrderNo: sourceOrderOfPayload(db, row.payload), what: "办理进度", error: String(error) });
      }
    }
    alertStuck(db, stuck);
    return { sent, failed, skipped: false };
  } finally {
    state.flushing = false;
  }
}

/**
 * 资料审核结果入队（资料打通，2026-10-03）：必须与审核写入同一事务。
 * 同一份客户站资料的版本号 +1，所有副本记同一版本；客户站只接受更大的版本，迟到的旧结果不覆盖新结果。
 */
export function queueDocumentReview(db: Database.Database, submissionId: string, status: string, note: string): boolean {
  const result = ({ "已审核": "approved", "已退回": "rejected", "待审核": "pending" } as Record<string, string>)[status];
  if (!result) return false;
  const seq = ((db.prepare("SELECT MAX(review_seq) AS n FROM sync_documents WHERE submission_id = ?").get(submissionId) as { n: number | null }).n ?? 0) + 1;
  db.prepare("UPDATE sync_documents SET review_seq = ? WHERE submission_id = ?").run(seq, submissionId);
  db.prepare("INSERT INTO sync_document_outbox (id, submission_id, payload) VALUES (?, ?, ?)").run(`DRV-${randomUUID()}`, submissionId,
    // decided_at：内部做决定的时刻（UTC，与 SQLite datetime('now') 同格式）。客户站按它判断同一需求多份资料谁的结果更新，
    // 不按到达先后——回传失败重试会让旧结果晚到（2026-10-03）
    JSON.stringify({ submission_id: submissionId, seq, status: result, note: result === "rejected" ? note.slice(0, 500) : "",
      decided_at: new Date().toISOString().replace("T", " ").slice(0, 19) }));
  return true;
}

/**
 * 回传客户站一直失败时提醒管理员（2026-10-15）。原来只打日志：补件、交付、取消结果没送到客户那边，谁都不知道。
 * 每条事件只在第 ALERT_ATTEMPTS 次失败时算一次（约 5 分钟连续失败），之后照常退避重试、不再重复提醒；
 * 同一轮扫到的合成一条，客户站整个连不上时不会一单一条刷屏。不改表结构。
 */
const ALERT_ATTEMPTS = 6;
type StuckItem = { sourceOrderNo: string; what: string; error: string };

function sourceOrderOfPayload(db: Database.Database, payload: string): string {
  try {
    const event = JSON.parse(payload) as { source_order_no?: unknown; submission_id?: unknown };
    if (typeof event.source_order_no === "string" && event.source_order_no) return event.source_order_no;
    if (typeof event.submission_id === "string") {
      const row = db.prepare("SELECT source_order_no FROM sync_documents WHERE submission_id = ? LIMIT 1").get(event.submission_id) as { source_order_no: string } | undefined;
      if (row?.source_order_no) return row.source_order_no;
    }
  } catch { /* 坏数据就不带单号 */ }
  return "";
}

function documentEventLabel(payload: string): string {
  try {
    const kind = (JSON.parse(payload) as { event?: string }).event;
    return kind === "request" ? "补件要求" : kind === "delivery" ? "交付文件" : kind === "cancel" ? "取消申请结果" : "资料审核结果";
  } catch { return "资料审核结果"; }
}

function alertStuck(db: Database.Database, stuck: StuckItem[]): void {
  if (!stuck.length) return;
  try {
    const orders = [...new Set(stuck.map(x => x.sourceOrderNo).filter(Boolean))];
    const what = [...new Set(stuck.map(x => x.what))].join("、");
    const lastError = stuck[stuck.length - 1].error.slice(0, 200);
    const detail = orders.length <= 1
      ? `客户站订单 ${orders[0] || "（单号不明）"} 的${what}连续 ${ALERT_ATTEMPTS} 次没送到客户站，系统会继续重试。客户那边暂时看不到这次更新。最近错误：${lastError}`
      : `${orders.length} 张客户站订单的${what}连续 ${ALERT_ATTEMPTS} 次没送到客户站（可能是客户站连不上），系统会继续重试：${orders.slice(0, 5).join("、")}${orders.length > 5 ? " 等" : ""}。最近错误：${lastError}`;
    notifySyncBackFailure(db, orders[0] || "", detail);
  } catch (error) {
    console.error("[progress] 失败提醒写入失败:", error);
  }
}

export async function flushDocumentReviews(): Promise<FlushResult> {
  const state = workerState();
  if (state.docFlushing) return { sent: 0, failed: 0, skipped: true };
  const url = process.env.CUSTOMER_SYNC_URL;
  const secret = process.env.SYNC_SECRET;
  if (!url || !secret) return { sent: 0, failed: 0, skipped: true };
  state.docFlushing = true;
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT id, payload, attempts FROM sync_document_outbox WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now')) ORDER BY created_at, rowid LIMIT 100"
    ).all() as PendingProgress[];
    let sent = 0, failed = 0;
    const stuck: StuckItem[] = [];
    for (const row of rows) {
      try {
        // 同一个发件箱四类事件：资料审核结果（旧行无 event）、补件要求、交付文件、取消申请结果（2026-10-03）
        const event = JSON.parse(row.payload);
        const kind = event.event === "request" ? "request" : event.event === "delivery" ? "delivery" : event.event === "cancel" ? "cancel" : "review";
        const path = kind === "cancel" ? "/api/sync/cancel-requests/result" : `/api/sync/documents/${kind}`;
        const resp = await fetch(`${url.replace(/\/$/, "")}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
          body: row.payload,
          // 交付要等客户站回拉文件，给足时间
          signal: AbortSignal.timeout(kind === "delivery" ? 90_000 : 15_000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const ack = await resp.json() as Record<string, unknown>;
        const confirmed = ack.ok === true && (
          kind === "request" || kind === "cancel" ? ack.request_id === event.request_id
          : kind === "delivery" ? ack.delivery_id === event.delivery_id && Number.isSafeInteger(ack.seq) && Number(ack.seq) >= event.seq
          : ack.submission_id === event.submission_id && Number.isSafeInteger(ack.seq) && Number(ack.seq) >= event.seq);
        if (!confirmed) throw new Error(`客户站未确认（${kind}）`);
        db.prepare("UPDATE sync_document_outbox SET status = 'sent', sent_at = datetime('now'), last_error = NULL WHERE id = ?").run(row.id);
        sent++;
      } catch (error) {
        failed++;
        const attempts = Number(row.attempts || 0) + 1;
        const delay = Math.min(2 ** Math.min(attempts, 16) * 5, 600);
        db.prepare("UPDATE sync_document_outbox SET attempts=?,next_attempt_at=datetime('now','+' || ? || ' seconds'),last_error=? WHERE id=?")
          .run(attempts, delay, String(error).slice(0, 500), row.id);
        console.error("[documents] 资料审核/补件/交付/取消结果回传失败，退避后重试:", error);
        if (attempts === ALERT_ATTEMPTS) stuck.push({ sourceOrderNo: sourceOrderOfPayload(db, row.payload), what: documentEventLabel(row.payload), error: String(error) });
      }
    }
    alertStuck(db, stuck);
    return { sent, failed, skipped: false };
  } finally {
    state.docFlushing = false;
  }
}

/** 仅在业务提交后调用；包含读库失败等异步异常，避免 unhandled rejection。 */
export function requestProgressFlush(): void {
  void flushProgress().catch((error) => {
    console.error("[progress] 队列扫描失败，等待下一轮重试:", error);
  });
  void flushDocumentReviews().catch((error) => {
    console.error("[documents] 审核结果队列扫描失败，等待下一轮重试:", error);
  });
}

/** 由 Node 服务启动入口调用，启动即补传已有积压，不等待下一次员工操作。 */
export function ensureProgressWorker(): void {
  // 关闭时不占据启动标记，后续启用配置仍可正常启动。
  if (!process.env.CUSTOMER_SYNC_URL || !process.env.SYNC_SECRET) return;
  const state = workerState();
  if (state.timer) return;
  try {
    const queued = resendChangedPublicText();
    if (queued > 0) console.log(`[sync] 客户看到的步骤名/说明有更新，补发 ${queued} 条进度`);
  } catch (error) { console.error("[sync] 补发客户看到的步骤名失败:", error); }
  state.timer = setInterval(requestProgressFlush, 15_000);
  state.timer.unref?.();
  requestProgressFlush();
}

/** 进程生命周期/隔离测试清理；不会清掉尚在执行的发送锁。 */
export function stopProgressWorker(): void {
  const state = workerState();
  if (state.timer) clearInterval(state.timer);
  state.timer = undefined;
}
