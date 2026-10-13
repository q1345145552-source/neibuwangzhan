"use client";

import { useState, useEffect } from "react";
import { apiCall } from "@/lib/api-call";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, fileUrl, toThaiTime } from "@/lib/utils";
import { Plus, X, ImagePlus } from "lucide-react";

interface ShopFee {
  id: number;
  fee_type: string;
  business_type: string;
  amount: number;
  currency: string;
  note: string;
  screenshot: string;
  status: string;
  reviewed_by: string;
  reviewed_at: string;
  review_note: string;
  created_by: string;
  created_at: string;
}

const BUSINESS_TYPES = ["卖店铺", "外购店铺", "SIM卡", "邮箱", "扫描验证", "注册"] as const;

const STATUS_BADGE: Record<string, string> = {
  "待核对": "bg-amber-500/15 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300",
  "待处理": "bg-blue-500/15 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300",
  "已到账": "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300",
  "未到账": "bg-red-500/15 text-red-600 dark:bg-red-900/40 dark:text-red-300",
};

export function BillingTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [fees, setFees] = useState<ShopFee[]>([]);
  const [loading, setLoading] = useState(true);

  // 录入表单
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ fee_type: "收入", business_type: "卖店铺", amount: "", currency: "CNY", note: "" });
  const [screenshot, setScreenshot] = useState("");
  const [uploading, setUploading] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);

  // 核对
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [reviewResult, setReviewResult] = useState<"已到账" | "未到账">("已到账");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewErr, setReviewErr] = useState("");
  const [reviewing, setReviewing] = useState(false);

  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchWithAuth("/api/shop-fees", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setFees(Array.isArray(d) ? d : []))
      .catch(() => setFees([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const setField = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }));

  const openCreate = () => {
    setForm({ fee_type: "收入", business_type: "卖店铺", amount: "", currency: "CNY", note: "" });
    setScreenshot("");
    setFormErr("");
    setFormOpen(true);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
      if (res.ok) {
        const data = await res.json();
        if (data.url) setScreenshot(data.url);
      } else {
        setFormErr("截图上传失败");
      }
    } catch { setFormErr("截图上传失败"); }
    finally { setUploading(false); }
  };

  const submit = async () => {
    const amt = Number(form.amount);
    if (!form.fee_type) { setFormErr("请选择收入或支出"); return; }
    if (!form.business_type) { setFormErr("请选择业务类型"); return; }
    if (!Number.isFinite(amt) || amt <= 0) { setFormErr("请填写有效金额"); return; }
    if (!screenshot) { setFormErr("请上传截图"); return; }
    setSaving(true);
    const ok = await apiCall("/api/shop-fees", {
      method: "POST",
      body: { fee_type: form.fee_type, business_type: form.business_type, amount: amt, currency: form.currency, note: form.note, screenshot },
      onError: (m) => setFormErr(m),
    });
    setSaving(false);
    if (ok) { setFormOpen(false); setFormErr(""); load(); }
  };

  const openReview = (f: ShopFee) => {
    setReviewId(f.id);
    setReviewResult("已到账");
    setReviewNote("");
    setReviewErr("");
  };

  const submitReview = async () => {
    if (reviewId == null) return;
    if (reviewResult === "未到账" && !reviewNote.trim()) { setReviewErr("标未到账必须填写原因"); return; }
    setReviewing(true);
    const ok = await apiCall(`/api/shop-fees/${reviewId}`, {
      method: "PATCH",
      body: { action: "review", result: reviewResult, note: reviewNote },
      onError: (m) => setReviewErr(m),
    });
    setReviewing(false);
    if (ok) { setReviewId(null); setReviewErr(""); load(); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--muted-foreground)]">统一记录店铺相关的收入和支出</p>
        <Button size="sm" onClick={openCreate} className="gap-1.5"><Plus className="size-4" />录入</Button>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
      ) : fees.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无收付款记录</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)]">类型</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)]">业务</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-[var(--muted-foreground)]">金额</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)]">状态</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)] max-md:hidden">说明</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)]">截图</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)] max-lg:hidden">录入/核对</th>
                {isAdmin && <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)]">操作</th>}
              </tr>
            </thead>
            <tbody>
              {fees.map((f) => (
                <tr key={f.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/20">
                  <td className="px-3 py-2.5">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", f.fee_type === "收入" ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600")}>{f.fee_type}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--foreground)]">{f.business_type}</td>
                  <td className={cn("px-3 py-2.5 text-right font-mono whitespace-nowrap", f.fee_type === "收入" ? "text-emerald-600" : "text-[var(--destructive)]")}>
                    {f.fee_type === "收入" ? "+" : "-"}{f.amount} {f.currency}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_BADGE[f.status] || "")}>{f.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--muted-foreground)] max-md:hidden max-w-[200px] truncate">{f.note || "—"}</td>
                  <td className="px-3 py-2.5">
                    {f.screenshot ? (
                      <img src={fileUrl(f.screenshot)} alt="截图" className="h-10 w-10 cursor-pointer rounded border border-[var(--border)] object-cover hover:opacity-80" onClick={() => setLightbox(f.screenshot)} />
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--muted-foreground)] max-lg:hidden">
                    <span>{f.created_by} · {toThaiTime(f.created_at)}</span>
                    {f.reviewed_by && <span className="block">核对：{f.reviewed_by}{f.review_note ? `（${f.review_note}）` : ""}</span>}
                  </td>
                  {isAdmin && (
                    <td className="px-3 py-2.5">
                      {f.fee_type === "收入" && (f.status === "待核对" || f.status === "未到账") && (
                        <Button size="xs" variant="outline" onClick={() => openReview(f)}>核对</Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 录入弹窗 */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFormOpen(false)}>
          <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-[var(--foreground)]">录入收付款</h3>
              <button onClick={() => setFormOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium">收入 / 支出</label>
                <div className="mt-1 flex gap-2">
                  {["收入", "支出"].map((t) => (
                    <button key={t} type="button" onClick={() => setField("fee_type", t)} className={cn("flex-1 rounded border px-3 py-2 text-sm font-medium", form.fee_type === t ? (t === "收入" ? "border-emerald-400 bg-emerald-500/10 text-emerald-600" : "border-red-400 bg-red-500/10 text-red-600") : "border-[var(--border)] text-[var(--muted-foreground)]")}>{t}</button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium">业务类型</label>
                <select value={form.business_type} onChange={(e) => setField("business_type", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 text-sm outline-none focus:border-[var(--ring)]">
                  {BUSINESS_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">金额</label>
                  <input type="number" value={form.amount} onChange={(e) => setField("amount", e.target.value)} placeholder="0.00" className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
                <div>
                  <label className="text-xs font-medium">币种</label>
                  <select value={form.currency} onChange={(e) => setField("currency", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 text-sm outline-none focus:border-[var(--ring)]">
                    <option value="CNY">CNY</option>
                    <option value="THB">THB</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium">说明</label>
                <textarea value={form.note} onChange={(e) => setField("note", e.target.value)} rows={2} placeholder="补充说明" className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
              </div>

              <div>
                <label className="text-xs font-medium">截图 <span className="text-[var(--destructive)]">*</span></label>
                {screenshot ? (
                  <div className="mt-1.5 flex items-center gap-2">
                    <img src={fileUrl(screenshot)} alt="截图" className="h-16 w-16 rounded border border-[var(--border)] object-cover" />
                    <button type="button" onClick={() => setScreenshot("")} className="text-xs text-[var(--destructive)] hover:underline">移除</button>
                  </div>
                ) : (
                  <label className="mt-1.5 flex h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed border-[var(--border)] text-xs text-[var(--muted-foreground)] hover:border-[var(--ring)]">
                    <ImagePlus className="size-5" />{uploading ? "上传中…" : "上传截图"}
                    <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
                  </label>
                )}
              </div>
            </div>

            {formErr && <p className="mt-2 text-xs text-[var(--destructive)]">{formErr}</p>}
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={submit} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>取消</Button>
            </div>
          </div>
        </div>
      )}

      {/* 核对弹窗 */}
      {reviewId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setReviewId(null)}>
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-[var(--foreground)]">核对收入</h3>
              <button onClick={() => setReviewId(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium">核对结果</label>
                <div className="mt-1 flex gap-2">
                  {(["已到账", "未到账"] as const).map((r) => (
                    <button key={r} type="button" onClick={() => setReviewResult(r)} className={cn("flex-1 rounded border px-3 py-2 text-sm font-medium", reviewResult === r ? (r === "已到账" ? "border-emerald-400 bg-emerald-500/10 text-emerald-600" : "border-red-400 bg-red-500/10 text-red-600") : "border-[var(--border)] text-[var(--muted-foreground)]")}>{r}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium">{reviewResult === "未到账" ? "未到账原因" : "备注"} {reviewResult === "未到账" && <span className="text-[var(--destructive)]">*</span>}</label>
                <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} rows={2} placeholder={reviewResult === "未到账" ? "必填，说明为什么没到账" : "可选"} className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
            </div>

            {reviewErr && <p className="mt-2 text-xs text-[var(--destructive)]">{reviewErr}</p>}
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={submitReview} disabled={reviewing}>{reviewing ? "提交中…" : "确认"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setReviewId(null)}>取消</Button>
            </div>
          </div>
        </div>
      )}

      {/* 截图灯箱 */}
      {lightbox && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4" onClick={() => setLightbox(null)}>
          <img src={fileUrl(lightbox)} alt="截图放大" className="max-h-full max-w-full rounded-md object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
