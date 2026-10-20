"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileText, Loader2, Wallet } from "lucide-react";
import { confirmOrderPayment, fetchOrderPayment, orderReceiptUrl, type OrderPayment } from "@/lib/api";
import { cn, toThaiTime } from "@/lib/utils";

const IMAGE = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

/**
 * 客户站账单和收款（2026-10-20 老板 1A）：看客户传的付款水单，管理员点「确认收款」，业务系统变「已付款」并通知客户。
 * 账单在业务系统，这里每次打开现取；连不上就提示，不影响订单其余部分。
 */
export function OrderPaymentCard({ orderId, isAdmin, awaitingConfirmation, onPreview }: {
  orderId: string;
  isAdmin: boolean;
  awaitingConfirmation: boolean;
  onPreview: (url: string) => void;
}) {
  const [data, setData] = useState<OrderPayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // 只认这张单的返回：切到别的单后，旧单的账单晚回来也不能贴到新单上（父页另按单号换新卡片）
  const load = useCallback(() => {
    let alive = true;
    fetchOrderPayment(orderId)
      .then(d => { if (alive) setData(d); })
      .catch((e) => { if (alive) setData({ available: false, reason: e instanceof Error ? e.message : "取客户的账单失败" }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [orderId]);
  useEffect(() => load(), [load]);

  const invoice = data?.invoice;
  const paid = invoice?.status === "paid";
  const receipts = data?.receipts || [];

  const confirm = async () => {
    if (!invoice) return;
    const ask = receipts.length
      ? `确认已经收到这张单的钱（${invoice.amount} ${invoice.currency}）？\n确认后客户那边账单变成「已付款」，客户会收到通知。`
      : `客户还没传付款水单。\n确定已经收到这张单的钱（${invoice.amount} ${invoice.currency}）了吗？确认后客户会收到通知。`;
    if (!window.confirm(ask)) return;
    setBusy(true); setMessage(null);
    try {
      const result = await confirmOrderPayment(orderId);
      setData((prev) => ({ ...(prev || { available: true }), ...result, available: true, can_confirm: prev?.can_confirm }));
      setMessage({ ok: true, text: result.already ? "这张单之前已经确认收款了" : "已确认收款，客户已收到通知" });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "确认收款失败" });
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <Wallet className="size-4 text-[var(--muted-foreground)]" />
        <h3 className="text-sm font-medium">客户付款</h3>
        {invoice && (
          <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[0.7rem] font-medium",
            paid ? "bg-[color-mix(in_oklch,var(--success),var(--background)_88%)] text-[var(--success)]" : "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]")}>
            {paid ? "已确认收款" : "未确认收款"}
          </span>
        )}
      </div>
      {loading ? (
        <p className="flex items-center gap-1 py-2 text-xs text-[var(--muted-foreground)]"><Loader2 className="size-3 animate-spin" />正在取业务系统的账单…</p>
      ) : !data?.available ? (
        <p className="py-1 text-xs text-[var(--muted-foreground)]">{data?.reason || "看不到客户的账单"}</p>
      ) : !invoice ? (
        <p className="py-1 text-xs text-[var(--muted-foreground)]">这张单在业务系统没有账单</p>
      ) : (
        <>
          <p className="text-xs text-[var(--muted-foreground)]">账单 {invoice.invoice_no} · <span className="font-mono text-[var(--foreground)]">{Number(invoice.amount).toLocaleString()} {invoice.currency}</span>
            {Number(invoice.discount) > 0 && ` · 折扣 ${invoice.discount_type === "percent" ? `${invoice.discount}%` : `${invoice.discount} ${invoice.currency}`}`}
            {Number(invoice.deposit) > 0 && ` · 定金 ${invoice.deposit} ${invoice.currency}`}
          </p>
          {paid && invoice.paid_at && <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">确认时间 {toThaiTime(invoice.paid_at)}</p>}
          <div className="mt-3">
            <p className="mb-1.5 text-xs font-medium">客户传的付款水单{receipts.length ? `（${receipts.length}）` : ""}</p>
            {receipts.length === 0 ? <p className="text-xs text-[var(--muted-foreground)]">客户还没传</p> : (
              <ul className="flex flex-wrap gap-2">
                {receipts.map((r) => {
                  const url = orderReceiptUrl(orderId, r.id);
                  return (
                    <li key={r.id} className="w-28">
                      {IMAGE.has(r.ext) ? (
                        // eslint-disable-next-line @next/next/no-img-element -- 业务系统的水单现取现看，不走图片优化
                        <img src={url} alt={r.name} className="h-20 w-28 cursor-pointer rounded border border-[var(--border)] object-cover hover:opacity-80" onClick={() => onPreview(url)} />
                      ) : (
                        <a href={url} target="_blank" rel="noreferrer" className="flex h-20 w-28 flex-col items-center justify-center gap-1 rounded border border-[var(--border)] text-xs hover:bg-[var(--muted)]">
                          <FileText className="size-5 text-[var(--muted-foreground)]" />打开
                        </a>
                      )}
                      <p className="mt-0.5 truncate text-[0.65rem] text-[var(--muted-foreground)]" title={r.name}>{toThaiTime(r.submitted_at)}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {!paid && (isAdmin ? (
            <div className="mt-3">
              <button type="button" onClick={confirm} disabled={busy || awaitingConfirmation}
                className="inline-flex items-center gap-1 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50">
                {busy ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}确认收款
              </button>
              {awaitingConfirmation && <p className="mt-1 text-xs text-[var(--muted-foreground)]">先点「确认订单」，才能确认收款</p>}
            </div>
          ) : <p className="mt-3 text-xs text-[var(--muted-foreground)]">收到钱后请管理员点「确认收款」</p>)}
          {message && <p className={cn("mt-2 text-xs", message.ok ? "text-[var(--success)]" : "text-[var(--destructive)]")}>{message.text}</p>}
        </>
      )}
    </div>
  );
}
