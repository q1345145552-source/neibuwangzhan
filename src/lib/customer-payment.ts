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
