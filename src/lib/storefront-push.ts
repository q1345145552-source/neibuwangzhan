import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { logOperation } from "./db";
import { subServices } from "./constants";
import { parseSyncOrder } from "./sync-order-parse";
import { queueProgressEventsForOrder } from "./progress-sync";
import { recordConfirmation, sourceOrderNoOf } from "./order-confirm";
import { renumberOrder, SAFE_ORDER_ID, uploadNamesContaining } from "./order-renumber";

/**
 * 线下单推到业务系统（2026-10-22 老板选 B：线下单照旧在内部录，推到客户在业务系统的账号下；
 * 金额和账单客户看得到、能传付款水单）。推单、替客户建账号只给管理员。
 *
 * 推过去以后，这张单就跟客户网上下的单一样：编号换成业务系统的单号（两边一模一样），
 * 记成客户站同步单、已确认；办理进度自动回传，账单、水单、确认收款、取消申请、打分都走原来那套。
 * 业务系统只收人民币：泰铢的单由员工推的时候换算好人民币金额填进去，内部这张单的金额跟着变成那个人民币金额。
 */
export class StorefrontPushError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export type StorefrontAccount = { id: string; name: string; phone: string; email: string; created_at?: string };

const TIMEOUT_MS = 15_000;

function base(): { url: string; secret: string } {
  const url = process.env.CUSTOMER_SYNC_URL, secret = process.env.SYNC_SECRET;
  if (!url || !secret) throw new StorefrontPushError("没有配置业务系统地址，推不了单", 503);
  return { url: url.replace(/\/$/, ""), secret };
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const { url, secret } = base();
  try {
    return await fetch(`${url}${path}`, { ...init, headers: { ...(init.headers || {}), "content-type": "application/json", authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new StorefrontPushError("业务系统暂时连不上，请稍后再试", 502);
  }
}

async function json<T>(resp: Response): Promise<T> {
  const body = await resp.json().catch(() => null) as (T & { error?: string }) | null;
  if (!resp.ok || !body) {
    const status = [400, 404, 409].includes(resp.status) ? resp.status : 502;
    throw new StorefrontPushError(body?.error || `业务系统返回错误（${resp.status}）`, status);
  }
  return body;
}

/** 客户打开就能直接进这张单的链接（业务系统 /o/单号，没登录会先登录） */
export function customerOrderLink(sourceOrderNo: string): string | null {
  const url = process.env.CUSTOMER_SYNC_URL;
  return url ? `${url.replace(/\/$/, "")}/o/${encodeURIComponent(sourceOrderNo)}` : null;
}

export async function searchStorefrontCustomers(q: string): Promise<StorefrontAccount[]> {
  const body = await json<{ customers: StorefrontAccount[] }>(await call(`/api/sync/customers?q=${encodeURIComponent(q.slice(0, 50))}`));
  return body.customers;
}

export async function createStorefrontCustomer(input: { name?: unknown; phone?: unknown; email?: unknown; password?: unknown }): Promise<StorefrontAccount> {
  return json<StorefrontAccount>(await call("/api/sync/customers", { method: "POST",
    body: JSON.stringify({ name: input.name, phone: input.phone, email: input.email, password: input.password }) }));
}

type PushableOrder = { id: string; status: string; total_amount: number; currency: string; business_type_id: number; sub_service_type: string | null; business_type_name: string };

/** 能不能推：员工在内部自己建的、没取消、已分好业务线、还没在业务系统里的单 */
export function pushBlocker(db: Database.Database, orderId: string): { order: PushableOrder | null; reason: string | null } {
  const order = db.prepare(`SELECT o.id, o.status, o.total_amount, o.currency, o.business_type_id, o.sub_service_type, COALESCE(o.source_system, '') AS source_system,
      bt.name AS business_type_name FROM orders o LEFT JOIN business_types bt ON bt.id = o.business_type_id WHERE o.id = ?`).get(orderId) as (PushableOrder & { source_system: string }) | undefined;
  if (!order) return { order: null, reason: "订单不存在" };
  if (sourceOrderNoOf(db, orderId)) return { order, reason: "这张单已经在业务系统里了" };
  if (order.source_system) return { order, reason: "只有员工在内部建的单才能推到业务系统" };
  if (order.status === "客户取消") return { order, reason: "已取消的单不能推" };
  if (!order.business_type_name || order.business_type_name === "待分类") return { order, reason: "先分好业务线再推" };
  if (!SAFE_ORDER_ID.test(orderId)) return { order, reason: "这张单的编号里有特殊字符，推不了，请联系管理员" };
  return { order, reason: null };
}

/** 客户在业务系统里看到的服务名，默认「业务线 · 子类型」 */
export function defaultServiceTitle(order: Pick<PushableOrder, "business_type_id" | "sub_service_type" | "business_type_name">): { serviceName: string; subCategory: string; title: string } {
  const sub = (subServices[order.business_type_id] || []).find(o => o.key === order.sub_service_type)?.label || "";
  return { serviceName: order.business_type_name, subCategory: sub, title: sub ? `${order.business_type_name} · ${sub}` : order.business_type_name };
}

type OfflineOrderResult = { order_id: string; order_no: string; customer_id: string; payload: unknown };

/**
 * 推单：先在业务系统建好订单（同一张内部单重推只会拿回同一张），再在本地一个事务里改编号、记成同步单、记确认、排进度回传。
 * 本地这一步失败就请业务系统撤回刚建的单；撤不回（客户已经动过）就照实说，等管理员再点一次推送（会接着用那张单）。
 */
export async function pushOrderToStorefront(db: Database.Database, orderId: string, input: { customer_id?: unknown; amount?: unknown; title?: unknown }, actor: string):
  Promise<{ id: string; source_order_no: string; link: string | null; renumbered: Record<string, number> }> {
  const { order, reason } = pushBlocker(db, orderId);
  if (reason || !order) throw new StorefrontPushError(reason || "订单不存在", order ? 409 : 404);
  const customerId = String(input.customer_id ?? "").trim();
  if (!customerId) throw new StorefrontPushError("请选客户在业务系统的账号");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) throw new StorefrontPushError("金额要填大于 0 的人民币金额，最多两位小数");
  const names = defaultServiceTitle(order);
  const title = String(input.title ?? "").trim() || names.title;
  if (title.length > 100) throw new StorefrontPushError("客户看到的服务名最多 100 个字");
  const inUpload = uploadNamesContaining(orderId);
  if (inUpload) throw new StorefrontPushError("这张单有文件名里带着单号，推了会找不到文件，请联系管理员", 409);

  // 连不上或没回话时业务系统可能已经建好了：同一张内部单再推只会拿回同一张，所以让员工放心再点
  const created = await (async () => json<OfflineOrderResult>(await call("/api/sync/offline-orders", { method: "POST", body: JSON.stringify({
    internal_order_id: orderId, customer_id: customerId, service_name: names.serviceName, sub_category: names.subCategory, sku_name: title, amount,
  }) })))().catch((error: unknown) => {
    if (error instanceof StorefrontPushError && error.status === 502) throw new StorefrontPushError("业务系统没有回话，不确定单子建好没有。请稍后再点一次「推到业务系统」（同一个客户账号），不会重复建单", 502);
    throw error;
  });

  try {
    const sourceOrderNo = created.order_no;
    const parsed = parseSyncOrder(created.payload);
    if (parsed.sourceOrderNo !== sourceOrderNo || !SAFE_ORDER_ID.test(sourceOrderNo)) throw new Error("业务系统回的单号对不上");
    if (parsed.customerId !== customerId || parsed.currency !== "CNY" || parsed.lines.length !== 1 || parsed.lines[0].quantity !== 1) throw new Error("业务系统回的订单内容对不上");
    const renumbered = db.transaction(() => {
      const again = pushBlocker(db, orderId);
      if (again.reason) throw new StorefrontPushError(again.reason, 409);
      const changed = renumberOrder(db, orderId, sourceOrderNo);
      const line = parsed.lines[0];
      db.prepare(`INSERT INTO sync_orders(source_order_no,source_customer_id,source,currency,billing_revision,total_cents,discount_cents,net_cents,identity_json,financial_json,payload) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(sourceOrderNo, parsed.customerId, parsed.source, parsed.currency, parsed.revision, parsed.totalCents, parsed.discountCents, parsed.netCents, parsed.identityJson, parsed.financialJson, parsed.payload);
      db.prepare(`INSERT INTO sync_inbox(id,source_order_no,line_no,copy_no,sku_code,internal_order_id,note,payload,allocated_cents,allocated_amount,billing_revision) VALUES (?,?,?,1,?,?,?,?,?,?,?)`)
        .run(randomUUID(), sourceOrderNo, line.line_no, line.sku_code, sourceOrderNo, `线下单推送（原内部编号 ${orderId}）`, JSON.stringify(line.raw), parsed.netCents, parsed.netCents / 100, parsed.revision);
      db.prepare("UPDATE orders SET source_system = 'storefront', source_customer_id = ?, total_amount = ?, currency = ?, updated_at = ? WHERE id = ?")
        .run(parsed.customerId, parsed.netCents / 100, parsed.currency, new Date().toISOString(), sourceOrderNo);
      recordConfirmation(db, sourceOrderNo, actor);
      queueProgressEventsForOrder(sourceOrderNo, db);
      logOperation(actor, "推到业务系统", "order", sourceOrderNo,
        `原内部编号 ${orderId} → 业务系统单号 ${sourceOrderNo}；客户账号 ${parsed.customerName || parsed.customerEmail || parsed.customerId}；金额 ${parsed.netCents / 100} CNY（原 ${order.total_amount} ${order.currency}）`);
      return changed;
    })();
    return { id: sourceOrderNo, source_order_no: sourceOrderNo, link: customerOrderLink(sourceOrderNo), renumbered };
  } catch (error) {
    // 两个人同时点推送：业务系统给两边回的是同一张单，先记上的那个算数，后到的不能去撤回
    if (db.prepare("SELECT 1 FROM sync_inbox WHERE source_order_no = ?").get(created.order_no))
      throw new StorefrontPushError(`这张单刚刚已经推到业务系统了（单号 ${created.order_no}），请刷新页面`, 409);
    console.error("[storefront-push] 本地记推单失败，请业务系统撤回:", error);
    const withdrawn = await call(`/api/sync/offline-orders/${encodeURIComponent(orderId)}`, { method: "DELETE" }).then(r => r.ok).catch(() => false);
    const why = error instanceof StorefrontPushError ? error.message : "内部记推单失败";
    throw new StorefrontPushError(withdrawn ? `${why}，业务系统那边已撤回，这张单没推出去` : `${why}；业务系统那边已建好订单 ${created.order_no}，请再点一次「推到业务系统」接着完成`, 500);
  }
}
