"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { fileUrl, toThaiTime } from "@/lib/utils";

export interface NoticeImplementation {
  printed: number; printed_at: string | null; photos: string; statement: string;
  submitted_at: string | null; review_status: string; boss_comment: string; reviewed_at: string | null;
}
interface Props { noticeId: number; record: NoticeImplementation; token: string | null; onSaved: () => Promise<void> }

export function NoticeRuleImplementation({ noticeId, record, token, onSaved }: Props) {
  const [photo, setPhoto] = useState<string>(() => { try { return JSON.parse(record.photos)[0] || ""; } catch { return ""; } });
  const [statement, setStatement] = useState(record.statement);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitted = !!record.submitted_at && record.review_status !== "打回";

  function printNotice() {
    const popup = window.open(`/notice-rules-print/${noticeId}`, "_blank");
    if (!popup) setError("打印窗口被拦截，请允许此站点弹出窗口后重试。");
    else { popup.opener = null; setError(""); }
  }
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) { setError("请上传照片（JPG、PNG、WebP 或 GIF）"); return; }
    setUploading(true);
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "照片上传失败");
      setPhoto(data.url);
    } catch (e) { setError(e instanceof Error ? e.message : "照片上传失败"); }
    finally { setUploading(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!photo) { setError("请上传打印纸的照片"); return; }
    if (!statement.trim()) { setError("请填写一句话说明"); return; }
    setSaving(true);
    try {
      const response = await fetch(`/api/notice-rules/${noticeId}/implementation`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ photo, statement }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "提交失败");
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "提交失败"); }
    finally { setSaving(false); }
  }
  return <section className="space-y-3 border-t border-[var(--border)] pt-4" aria-label="我的落实记录">
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" onClick={printNotice} className="min-h-11">打印</Button>
      <span className="text-sm text-[var(--muted-foreground)]">{record.printed ? `已打印 · ${toThaiTime(record.printed_at || "")}` : "第一步：打印通知/规则"}</span>
    </div>
    {submitted ? <p role="status" className="text-sm text-green-600">{record.review_status === "通过" ? "已通过" : "已提交、等老板验收"}</p> : record.review_status === "打回" ? <p role="status" className="text-sm text-red-600">已打回，请修改照片和说明后重新提交。</p> : <p className="text-sm text-[var(--muted-foreground)]">第二步：上传打印纸的照片，并填写一句话说明（均必填）。</p>}
    {(record.boss_comment || record.review_status === "打回") && <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{record.review_status === "打回" ? "打回原因" : "老板评论"}：{record.boss_comment || "未填写打回原因"}</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {photo && <a href={fileUrl(photo)} target="_blank" rel="noreferrer" className="block w-fit max-w-full"><img src={fileUrl(photo)} alt="打印纸照片" className="max-h-48 max-w-full rounded-lg border border-[var(--border)] object-contain" /></a>}
    {submitted ? <p className="whitespace-pre-wrap break-words text-sm">{record.statement}</p> : <form onSubmit={submit} className="space-y-3">
      <label className="block space-y-2 text-sm"><span>{uploading ? "照片上传中…" : photo ? "照片已上传，可重新选择" : "上传照片（必填，最大 10MB）"}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploading || saving} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }} className="block min-h-11 w-full min-w-0 max-w-full rounded-lg border border-[var(--border)] p-2 text-sm file:mr-2 file:rounded file:border-0 file:px-2 file:py-1" />
      </label>
      <label className="block space-y-2 text-sm"><span>一句话说明（必填）</span><textarea rows={2} value={statement} disabled={saving} onChange={e => setStatement(e.target.value)} placeholder="例如：已打印贴在办公桌" className="w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" /></label>
      <Button type="submit" disabled={uploading || saving} className="min-h-11 w-full sm:w-auto">{saving ? "提交中…" : "提交落实记录"}</Button>
      {!record.printed && <p className="text-sm text-[var(--muted-foreground)]">请先点击打印；完成后返回此页提交。</p>}
    </form>}
  </section>;
}
