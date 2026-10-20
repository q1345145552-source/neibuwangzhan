"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn, fileUrl, toThaiTime } from "@/lib/utils";
import type { AdminReviewRecord, ReviewDetails } from "@/lib/notice-rule-review";

interface Props { noticeId: number; token: string | null; onReviewed: () => Promise<void>; targetImplementationId?: number | null }
const labels = { total: "总人数", passed: "已通过", returned: "已打回", pending: "已提交等验收", not_submitted: "还没提交", untouched: "完全没动" } as const;

export function NoticeRuleReview({ noticeId, token, onReviewed, targetImplementationId = null }: Props) {
  const [data, setData] = useState<ReviewDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [comments, setComments] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [jumpError, setJumpError] = useState("");
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const locatedId = useRef<number | null>(null);
  const request = useCallback(async (url: string, init?: RequestInit): Promise<ReviewDetails> => {
    const response = await fetch(url, { ...init, cache: "no-store", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "请求失败，请重试");
    return body;
  }, [token]);
  useEffect(() => {
    let active = true;
    request(`/api/notice-rules/${noticeId}/implementations`)
      .then(result => { if (active) setData(result); })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [noticeId, request]);

  useEffect(() => {
    locatedId.current = null; setHighlightId(null); setJumpError("");
  }, [targetImplementationId]);
  useEffect(() => {
    if (targetImplementationId === null || locatedId.current === targetImplementationId || loading || error || !data) return;
    if (!data.records.some(record => record.id === targetImplementationId && record.notice_id === noticeId)) {
      setJumpError("落实记录不存在或你无权查看。"); return;
    }
    locatedId.current = targetImplementationId;
    setJumpError("");
    setHighlightId(targetImplementationId);
  }, [targetImplementationId, noticeId, loading, error, data]);
  useEffect(() => {
    if (highlightId === null) return;
    let frame: number;
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = performance.now() + 5000;
    const locate = () => {
      const target = [...document.querySelectorAll<HTMLElement>(`[data-notice-implementation-id="${highlightId}"]`)]
        .find(element => element.getClientRects().length > 0);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        clearTimer = setTimeout(() => setHighlightId(null), 3000);
      } else if (performance.now() < deadline) frame = requestAnimationFrame(locate);
      else { setHighlightId(null); setJumpError("暂时无法定位该落实记录，请刷新后重试。"); }
    };
    frame = requestAnimationFrame(locate);
    return () => { cancelAnimationFrame(frame); clearTimeout(clearTimer); };
  }, [highlightId]);

  async function refresh() {
    setLoading(true); setError(""); setSuccess("");
    try { setData(await request(`/api/notice-rules/${noticeId}/implementations`)); setComments({}); }
    catch (e) { setError(e instanceof Error ? e.message : "刷新失败"); }
    finally { setLoading(false); }
  }
  async function review(record: AdminReviewRecord, decision: "通过" | "打回") {
    if (savingId !== null) return;
    setSavingId(record.id); setError(""); setSuccess("");
    try {
      const result = await request(`/api/notice-rules/${noticeId}/implementations/${record.id}/review`, {
        method: "POST", body: JSON.stringify({ decision, comment: comments[record.id] ?? "", submission_token: record.submission_token }),
      });
      setData(result);
      setComments(previous => { const next = { ...previous }; delete next[record.id]; return next; });
      setSuccess(`${record.employee_name}：已${decision}`);
      try { await onReviewed(); } catch { setError("验收已保存，通知列表刷新失败，请稍后刷新页面。"); }
    } catch (e) { setError(e instanceof Error ? e.message : "验收失败"); }
    finally { setSavingId(null); }
  }
  return <section aria-label="员工落实清单" className="min-w-0 space-y-4 border-t border-[var(--border)] pt-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">员工落实清单</h3><Button type="button" onClick={refresh} disabled={loading || savingId !== null} className="min-h-11">刷新清单</Button></div>
    {error && <p role="alert" className="break-words text-sm text-red-600">{error}</p>}
    {jumpError && <p role="alert" className="break-words text-sm text-red-600">{jumpError}</p>}
    {success && <p role="status" className="text-sm text-green-600">{success}</p>}
    {loading && <p className="text-sm">正在加载清单…</p>}
    {data && <>
      <div aria-label="落实统计" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {(Object.keys(labels) as (keyof typeof labels)[]).map(key => <div key={key} className="min-w-0 rounded-lg border border-[var(--border)] bg-blue-500/5 p-3"><p className="text-xs text-[var(--muted-foreground)]">{labels[key]}</p><p className="mt-1 text-xl font-semibold">{data.statistics[key]}<span className="ml-1 text-xs font-normal">人</span></p></div>)}
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">“完全没动”指未打印且未提交，包含在“还没提交”中。</p>
      <div className="space-y-3">{data.records.map(record => <article key={record.id} id={`notice-implementation-${record.id}`} data-notice-implementation-id={record.id} aria-label={`${record.employee_name}的落实记录`} className={cn("min-w-0 scroll-mt-20 space-y-3 rounded-lg border border-[var(--border)] p-3 sm:p-4", record.id === highlightId && "bg-amber-100 ring-2 ring-amber-400 dark:bg-amber-900/30")}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">{record.employee_name}</h4><span className={`rounded-full px-2 py-1 text-xs ${record.status === "已通过" ? "bg-green-500/10 text-green-600" : record.status === "已打回" ? "bg-red-500/10 text-red-600" : "bg-blue-500/10 text-blue-600"}`}>{record.status}</span></div>
        <p className="text-sm text-[var(--muted-foreground)]">{record.printed ? `已打印 · ${toThaiTime(record.printed_at || "")}` : "未打印"}</p>
        {record.submitted_at ? <>
          <p className="text-sm text-[var(--muted-foreground)]">提交时间：{toThaiTime(record.submitted_at)}</p>
          <div className="flex flex-wrap gap-3">{record.photos.map(photo => <a key={photo} href={fileUrl(photo)} target="_blank" rel="noreferrer" className="block max-w-full text-sm text-blue-600" aria-label={`查看${record.employee_name}的照片大图`}>
            <img src={fileUrl(photo)} alt={`${record.employee_name}上传的打印纸照片`} className="max-h-40 max-w-full rounded-lg border border-[var(--border)] object-contain" /><span className="mt-1 block">查看照片大图</span>
          </a>)}</div>
          <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">员工说明：{record.statement}</p>
        </> : <p className="text-sm text-[var(--muted-foreground)]">未提交</p>}
        {record.reviewed_at && <p className="text-sm text-[var(--muted-foreground)]">验收时间：{toThaiTime(record.reviewed_at)}</p>}
        {(record.boss_comment || record.review_status === "打回") && <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{record.review_status === "打回" ? "打回原因" : "老板评论"}：{record.boss_comment || "未填写打回原因"}</p>}
        {record.submitted_at && record.review_status === "还没处理" && <div className="space-y-3">
          <label className="block space-y-2 text-sm"><span>验收评论（{record.employee_name}，可选）</span><textarea rows={2} value={comments[record.id] ?? ""} disabled={savingId !== null || loading} onChange={e => setComments(previous => ({ ...previous, [record.id]: e.target.value }))} className="w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2" placeholder="填写评论；打回时会作为原因显示给员工" /></label>
          <div className="flex flex-wrap gap-3"><Button type="button" className="min-h-11 bg-green-600 text-white hover:bg-green-700" disabled={savingId !== null || loading} onClick={() => review(record, "通过")}>通过</Button><Button type="button" className="min-h-11 bg-red-600 text-white hover:bg-red-700" disabled={savingId !== null || loading} onClick={() => review(record, "打回")}>打回</Button>{savingId === record.id && <span className="self-center text-sm">正在保存…</span>}</div>
        </div>}
      </article>)}</div>
    </>}
  </section>;
}
