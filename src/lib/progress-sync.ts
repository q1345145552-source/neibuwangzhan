import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "./db";

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
export function queueProgressEventsForOrder(orderId: string, db: Database.Database = getDb()): number {
  return db.transaction(() => {
    const rows = db.prepare(
      "SELECT id, source_order_no, line_no, copy_no, progress_seq FROM sync_inbox WHERE internal_order_id = ?"
    ).all(orderId) as InboxRow[];
    if (rows.length === 0) return 0;

    const order = db.prepare("SELECT status FROM orders WHERE id = ?").get(orderId) as { status: string } | undefined;
    if (!order) return 0;
    // 白名单：禁止 SELECT * 或带入备注、负责人、费用、内部描述。
    const steps = db.prepare(
      "SELECT step_order, step_name, status FROM order_steps WHERE order_id = ? ORDER BY step_order"
    ).all(orderId);
    const insert = db.prepare("INSERT INTO sync_progress_outbox (id, inbox_id, payload) VALUES (?, ?, ?)");
    const bump = db.prepare("UPDATE sync_inbox SET progress_seq = progress_seq + 1 WHERE id = ?");
    for (const row of rows) {
      bump.run(row.id);
      insert.run(`PGR-${randomUUID()}`, row.id, JSON.stringify({
        source_order_no: row.source_order_no,
        line_no: row.line_no,
        copy_no: row.copy_no,
        seq: row.progress_seq + 1,
        status: order.status,
        steps,
      }));
    }
    return rows.length;
  })();
}

interface FlushResult { sent: number; failed: number; skipped: boolean }
interface PendingProgress { id: string; payload: string; attempts: number }
interface WorkerState {
  flushing: boolean;
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
      }
    }
    return { sent, failed, skipped: false };
  } finally {
    state.flushing = false;
  }
}

/** 仅在业务提交后调用；包含读库失败等异步异常，避免 unhandled rejection。 */
export function requestProgressFlush(): void {
  void flushProgress().catch((error) => {
    console.error("[progress] 队列扫描失败，等待下一轮重试:", error);
  });
}

/** 由 Node 服务启动入口调用，启动即补传已有积压，不等待下一次员工操作。 */
export function ensureProgressWorker(): void {
  // 关闭时不占据启动标记，后续启用配置仍可正常启动。
  if (!process.env.CUSTOMER_SYNC_URL || !process.env.SYNC_SECRET) return;
  const state = workerState();
  if (state.timer) return;
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
