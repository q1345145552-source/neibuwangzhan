"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { cn, fileUrl, toThaiTime } from "@/lib/utils";
import { X } from "lucide-react";

export interface ShopFeeRecord {
  id: number; fee_type: string; business_type: string; amount: number; currency: string;
  note: string; screenshot: string; status: string; reviewed_by: string; reviewed_at: string;
  review_note: string; created_by: string; created_at: string;
}
const BUSINESS_TYPES = ["卖店铺", "外购店铺", "SIM卡", "邮箱", "扫描验证", "注册"];
const control = "mt-1 min-h-11 w-full min-w-0 rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm";
const canReview = (fee: ShopFeeRecord) => fee.fee_type === "收入" && (fee.status === "待核对" || fee.status === "未到账");
async function jsonResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `操作失败（HTTP ${response.status}）`);
  return data;
}
function Screenshot({ url, small = false }: { url: string; small?: boolean }) {
  return url ? <a href={fileUrl(url)} target="_blank" rel="noopener noreferrer" aria-label="查看店铺收付款截图" className="inline-block max-w-full text-xs text-blue-600">
    <img src={fileUrl(url)} alt="店铺收付款截图" className={cn("rounded border border-[var(--border)] object-contain", small ? "h-12 w-12" : "max-h-48 max-w-full")} /><span className="mt-1 block">查看截图</span>
  </a> : <span>—</span>;
}
function statusClass(status: string) {
  return status === "已到账" ? "bg-emerald-500/15 text-emerald-600" : status === "未到账" ? "bg-red-500/15 text-red-600" : "bg-amber-500/15 text-amber-600";
}

export function ShopFeeEntryDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (fee: ShopFeeRecord) => void }) {
  const [form, setForm] = useState({ fee_type: "收入", business_type: "卖店铺", amount: "", currency: "CNY", note: "" });
  const [screenshot, setScreenshot] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const busy = uploading || saving;
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) { setError("请上传 JPG、PNG、WebP 或 GIF 图片截图"); return; }
    setUploading(true);
    try {
      const data = new FormData(); data.append("file", file);
      const uploaded = await jsonResponse(await fetchWithAuth("/api/upload", { method: "POST", body: data }));
      if (!uploaded.url) throw new Error("上传未返回截图地址，请重试");
      setScreenshot(uploaded.url);
    } catch (e) { setError(e instanceof Error ? e.message : "截图上传失败"); }
    finally { setUploading(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || uploading) return;
    setError("");
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setError("请填写有效金额"); return; }
    if (!screenshot) { setError("请上传截图"); return; }
    inFlight.current = true; setSaving(true);
    try {
      const fee = await jsonResponse(await fetchWithAuth("/api/shop-fees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, amount, screenshot }) }));
      onSaved(fee); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "录入失败"); }
    finally { inFlight.current = false; setSaving(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!busy) onClose(); }}>
    <form role="dialog" aria-modal="true" aria-labelledby="finance-shop-entry-title" onSubmit={submit} onClick={e => e.stopPropagation()} className="max-h-[calc(100dvh-2rem)] w-full min-w-0 max-w-md space-y-4 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl">
      <div className="flex items-center justify-between gap-3"><h3 id="finance-shop-entry-title" className="font-semibold">录入店铺收付款</h3><button type="button" disabled={busy} onClick={onClose} aria-label="关闭录入" className="flex size-11 shrink-0 items-center justify-center"><X className="size-5" /></button></div>
      <div><p className="text-xs font-medium">收入 / 支出</p><div className="mt-1 flex gap-2">{["收入", "支出"].map(type => <button key={type} type="button" disabled={busy} aria-pressed={form.fee_type === type} onClick={() => setForm(previous => ({ ...previous, fee_type: type }))} className={cn("min-h-11 flex-1 rounded border px-3 py-2 text-sm", form.fee_type === type ? "border-blue-500 bg-blue-500/10 text-blue-600" : "border-[var(--border)]")}>{type}</button>)}</div></div>
      <label className="block text-xs font-medium">业务类型<select value={form.business_type} disabled={busy} onChange={e => setForm(previous => ({ ...previous, business_type: e.target.value }))} className={control}>{BUSINESS_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
      <div className="grid min-w-0 grid-cols-2 gap-3">
        <label className="min-w-0 text-xs font-medium">金额<input type="number" inputMode="decimal" min="0" step="any" value={form.amount} disabled={busy} onChange={e => setForm(previous => ({ ...previous, amount: e.target.value }))} placeholder="0.00" className={control} /></label>
        <label className="min-w-0 text-xs font-medium">币种<select value={form.currency} disabled={busy} onChange={e => setForm(previous => ({ ...previous, currency: e.target.value }))} className={control}><option>CNY</option><option>THB</option></select></label>
      </div>
      <label className="block text-xs font-medium">说明<textarea rows={2} value={form.note} disabled={busy} onChange={e => setForm(previous => ({ ...previous, note: e.target.value }))} placeholder="补充说明" className={control} /></label>
      <div className="space-y-2 text-sm"><p className="text-xs font-medium">截图（必填）</p>
        {screenshot ? <div className="flex flex-wrap items-center gap-3"><Screenshot url={screenshot} small /><Button type="button" variant="ghost" disabled={busy} onClick={() => setScreenshot("")}>移除截图</Button></div> : <label className="flex min-h-20 cursor-pointer items-center justify-center rounded border border-dashed border-[var(--border)] p-3 text-sm">{uploading ? "上传中…" : "上传截图"}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="上传截图" disabled={busy} className="sr-only" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }} /></label>}
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy} className="min-h-11">{saving ? "保存中…" : "保存"}</Button><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>取消</Button></div>
    </form>
  </div>;
}

export function ShopFeeReviewDialog({ fee, onClose, onSaved }: { fee: ShopFeeRecord; onClose: () => void; onSaved: (fee: ShopFeeRecord) => void }) {
  const [result, setResult] = useState<"已到账" | "未到账">("已到账");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (inFlight.current) return;
    setError("");
    if (result === "未到账" && !note.trim()) { setError("标未到账必须填写原因"); return; }
    inFlight.current = true; setSaving(true);
    try {
      const updated = await jsonResponse(await fetchWithAuth(`/api/shop-fees/${fee.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review", result, note: note.trim() }) }));
      onSaved(updated); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "核对失败"); }
    finally { inFlight.current = false; setSaving(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!saving) onClose(); }}>
    <form role="dialog" aria-modal="true" aria-labelledby="finance-shop-review-title" onSubmit={submit} onClick={e => e.stopPropagation()} className="max-h-[calc(100dvh-2rem)] w-full min-w-0 max-w-sm space-y-4 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl">
      <div className="flex items-center justify-between gap-3"><h3 id="finance-shop-review-title" className="font-semibold">核对店铺收入</h3><button type="button" disabled={saving} onClick={onClose} aria-label="关闭核对" className="flex size-11 shrink-0 items-center justify-center"><X className="size-5" /></button></div>
      <p className="text-sm">{fee.business_type || "—"} · {fee.amount} {fee.currency}</p><Screenshot url={fee.screenshot} />
      <div className="flex gap-2">{(["已到账", "未到账"] as const).map(value => <button key={value} type="button" disabled={saving} aria-pressed={result === value} onClick={() => setResult(value)} className={cn("min-h-11 flex-1 rounded border px-3 py-2 text-sm", result === value ? "border-blue-500 bg-blue-500/10 text-blue-600" : "border-[var(--border)]")}>{value}</button>)}</div>
      <label className="block text-xs font-medium">{result === "未到账" ? "未到账原因（必填）" : "备注（可选）"}<textarea rows={3} value={note} disabled={saving} onChange={e => setNote(e.target.value)} placeholder={result === "未到账" ? "说明为什么没到账" : "可选"} className={control} /></label>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={saving} className="min-h-11">{saving ? "提交中…" : "确认"}</Button><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>取消</Button></div>
    </form>
  </div>;
}

export function ShopFeeDetails({ fees, isAdmin, onReview }: { fees: ShopFeeRecord[]; isAdmin: boolean; onReview: (fee: ShopFeeRecord) => void }) {
  if (!fees.length) return <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">暂无店铺管理费用</p>;
  return <>
    <div className="hidden overflow-x-auto md:block"><table className="w-full text-sm"><thead><tr className="border-b border-[var(--border)] text-left">
      {["类型", "业务类型", "金额", "状态", "说明", "截图", "录入 / 核对", ...(isAdmin ? ["操作"] : [])].map(label => <th key={label} className="whitespace-nowrap px-4 py-2.5 font-medium text-[var(--muted-foreground)]">{label}</th>)}
    </tr></thead><tbody>{fees.map(fee => <tr key={fee.id} className="border-b border-[var(--border)] last:border-0">
      <td className="whitespace-nowrap px-4 py-2.5">{fee.fee_type}</td><td className="whitespace-nowrap px-4 py-2.5">{fee.business_type || "—"}</td>
      <td className="whitespace-nowrap px-4 py-2.5 font-mono">{fee.currency === "THB" ? "฿" : "¥"}{Number(fee.amount).toLocaleString()}</td>
      <td className="px-4 py-2.5"><span className={cn("whitespace-nowrap rounded px-2 py-0.5 text-xs", statusClass(fee.status))}>{fee.status}</span>{fee.review_note && <p className="mt-1 max-w-56 text-xs text-[var(--muted-foreground)] [overflow-wrap:anywhere]">{fee.review_note}</p>}</td>
      <td className="max-w-64 px-4 py-2.5 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">{fee.note || "—"}</td><td className="px-4 py-2.5"><Screenshot url={fee.screenshot} small /></td>
      <td className="px-4 py-2.5 text-xs text-[var(--muted-foreground)]"><p>{fee.created_by || "—"} · {toThaiTime(fee.created_at)}</p>{fee.reviewed_by && <p>核对：{fee.reviewed_by} · {toThaiTime(fee.reviewed_at)}</p>}</td>
      {isAdmin && <td className="px-4 py-2.5">{canReview(fee) && <Button type="button" size="sm" onClick={() => onReview(fee)}>核对</Button>}</td>}
    </tr>)}</tbody></table></div>
    <div className="space-y-3 p-3 md:hidden">{fees.map(fee => <article key={fee.id} aria-label={`店铺收付款${fee.id}`} className="min-w-0 space-y-3 rounded-lg border border-[var(--border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{fee.fee_type} · {fee.business_type || "—"}</span><span className={cn("rounded px-2 py-0.5 text-xs", statusClass(fee.status))}>{fee.status}</span></div>
      <p className="font-mono text-lg">{fee.currency === "THB" ? "฿" : "¥"}{Number(fee.amount).toLocaleString()}</p>
      {fee.note && <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{fee.note}</p>}<Screenshot url={fee.screenshot} small />
      <div className="space-y-1 text-xs text-[var(--muted-foreground)]"><p>录入：{fee.created_by || "—"} · {toThaiTime(fee.created_at)}</p>{fee.reviewed_by && <p>核对：{fee.reviewed_by} · {toThaiTime(fee.reviewed_at)}</p>}{fee.review_note && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">核对说明：{fee.review_note}</p>}</div>
      {isAdmin && canReview(fee) && <Button type="button" onClick={() => onReview(fee)} className="min-h-11">核对</Button>}
    </article>)}</div>
  </>;
}
