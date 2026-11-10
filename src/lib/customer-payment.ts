import type Database from "better-sqlite3";
import { sourceOrderOf } from "./delivery-sync";

/**
 * 确认收款（2026-10-20 老板 1A）：客户站同步单的账单在客户站，内部管理员在订单里看客户传的水单、点「确认收款」，
 * 由客户站把账单标成已付款并通知客户；账单新版本照常同步回内部（订单上「客户站账单」跟着变）。
 * 这里只是去客户站取/改，当场要结果，不走发件箱；客户站连不上就直说，员工稍后再点。
 */
export type CustomerPayment = {
  source_order_no: string;
  order_status: string;
  invoice: { invoice_no: string; amount: number; currency: string; status: string; discount: number; discount_type: string; deposit: number; paid_at: string | null } | null;
  receipts: { id: string; name: string; submitted_at: string; ext: string }[];
};

export class CustomerPaymentError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

const TIMEOUT_MS = 15_000;

function base(): { url: string; secret: string } {
  const url = process.env.CUSTOMER_SYNC_URL, secret = process.env.SYNC_SECRET;
  if (!url || !secret) throw new CustomerPaymentError("没有配置业务系统地址，看不到客户的账单", 503);
  return { url: url.replace(/\/$/, ""), secret };
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const { url, secret } = base();
  try {
    return await fetch(`${url}${path}`, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new CustomerPaymentError("业务系统暂时连不上，请稍后再试");
  }
}

async function failure(resp: Response): Promise<CustomerPaymentError> {
  const body = await resp.json().catch(() => ({})) as { error?: string };
  return new CustomerPaymentError(body.error || `业务系统返回错误（${resp.status}）`, resp.status === 404 || resp.status === 409 ? resp.status : 502);
}

/** 这张内部单对应的客户站单号；不是客户站来的单返回 null */
export function paymentSourceOf(db: Database.Database, internalOrderId: string): string | null {
  return sourceOrderOf(db, internalOrderId);
}

export async function fetchCustomerPayment(sourceOrderNo: string): Promise<CustomerPayment> {
  const resp = await call(`/api/sync/payment?source_order_no=${encodeURIComponent(sourceOrderNo)}`);
  if (!resp.ok) throw await failure(resp);
  return await resp.json() as CustomerPayment;
}

export async function fetchCustomerReceipt(sourceOrderNo: string, receiptId: string): Promise<{ body: ArrayBuffer; type: string; name: string }> {
  const resp = await call(`/api/sync/payment/receipts/${encodeURIComponent(receiptId)}/file?source_order_no=${encodeURIComponent(sourceOrderNo)}`);
  if (!resp.ok) throw await failure(resp);
  let name = "";
  try { name = decodeURIComponent(resp.headers.get("x-file-name") || ""); } catch { /* 名字坏了不影响看文件 */ }
  return { body: await resp.arrayBuffer(), type: resp.headers.get("content-type") || "application/octet-stream", name };
}

export async function confirmCustomerPayment(sourceOrderNo: string, confirmedBy: string): Promise<CustomerPayment & { already?: boolean }> {
  const resp = await call("/api/sync/payment/confirm", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ source_order_no: sourceOrderNo, confirmed_by: confirmedBy }),
  });
  if (!resp.ok) throw await failure(resp);
  return await resp.json() as CustomerPayment & { already?: boolean };
}

/**
 * 内部改同步单金额（2026-11-09 老板：「要内部系统可以直接去改」）：先让业务系统把客户的账单改成同样的数，
 * 改成了内部再存；业务系统随后发来的账单新版本跟这里一致。expected 是内部现在的金额，业务系统那边对不上就不改。
 */
/** 改成了回业务系统这次账单新版本的版本号 */
export async function setCustomerOrderAmount(sourceOrderNo: string, amount: number, expected: number): Promise<number> {
  const url = process.env.CUSTOMER_SYNC_URL, secret = process.env.SYNC_SECRET;
  if (!url || !secret) throw new CustomerPaymentError("金额没改成：没有配置业务系统地址", 503);
  // 说不准改没改成的时候（回话超时、连接中途断、网关报错）不能说「没改成」：业务系统那边可能已经改了，
  // 改了的话账单新版本过一会儿会到内部，刷新就能看到；再改一次也安全（带着原金额，对不上会拦）
  const unsure = "业务系统没有给出明确回话，客户的账单可能已经改了，请过一会儿刷新页面看看再决定要不要再改";
  let resp: Response;
  try {
    resp = await fetch(`${url.replace(/\/$/, "")}/api/sync/order-amount`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ source_order_no: sourceOrderNo, amount, expected_amount: expected }), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // 连都没连上（拒绝连接、找不到地址）才肯定没改
    const code = (error as { cause?: { code?: string } } | null)?.cause?.code;
    const notReached = !!code && ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"].includes(code);
    throw new CustomerPaymentError(notReached ? "金额没改成：业务系统暂时连不上，请稍后再试" : unsure, 502);
  }
  const body = await resp.json().catch(() => null) as { ok?: boolean; error?: string; billing_revision?: unknown } | null;
  // 改成了但没带版本号：内部没法判断期间有没有更新的版本先到，不存，等账单新版本自己过来
  if (resp.ok && body?.ok === true) {
    if (Number.isSafeInteger(body.billing_revision) && (body.billing_revision as number) > 0) return body.billing_revision as number;
    throw new CustomerPaymentError(unsure, 502);
  }
  // 回了 200 却不是业务系统的回话：是网页（中间转发回的）就肯定没到接口；是读坏了的 JSON 就说不准
  if (resp.ok) throw new CustomerPaymentError(/json/i.test(resp.headers.get("content-type") || "") ? unsure : "金额没改成：业务系统版本不对，请联系管理员", 502);
  // 业务系统明确拒绝（4xx），或它自己回滚后回的 500 报错，才肯定没改；网关报错（502/504 等）说不准
  if (resp.status >= 400 && resp.status < 500) {
    throw new CustomerPaymentError(`金额没改成：${body?.error || `业务系统返回错误（${resp.status}）`}`, [400, 404, 409].includes(resp.status) ? resp.status : 502);
  }
  if (resp.status === 500 && body?.error) throw new CustomerPaymentError(`金额没改成：${body.error}`, 502);
  throw new CustomerPaymentError(unsure, 502);
}
