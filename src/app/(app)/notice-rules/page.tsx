"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { toThaiTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NoticeRuleImplementation, type NoticeImplementation } from "@/components/notice-rule-implementation";

import { NoticeRuleReview } from "@/components/notice-rule-review";

interface Notice {
  implementation?: NoticeImplementation;
  id: number; title: string; body: string; type: "通知" | "规则";
  publisher_name: string; published_at: string; recipient_count: number; implemented_count: number;
}
interface Employee { id: number; name: string }

export default function NoticeRulesPage() {
  const { user, token } = useAuth();
  const implementationParam = useSearchParams().get("implementation");
  const [reviewTarget, setReviewTarget] = useState<{ id: number; notice_id: number } | null>(null);
  const [ownHighlightId, setOwnHighlightId] = useState<number | null>(null);
  const [jumpError, setJumpError] = useState("");
  const [listError, setListError] = useState("");
  const openedImplementation = useRef<number | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [reviewNoticeId, setReviewNoticeId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<"通知" | "规则">("通知");
  const [mode, setMode] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState<number[]>([]);
  const isAdmin = user?.role === "admin";
  const request = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "请求失败，请重试");
    return data;
  }, [token]);
  const load = useCallback(async () => {
    setNotices(await request("/api/notice-rules"));
  }, [request]);
  useEffect(() => {
    if (!token || user?.role === "client") return;
    let active = true;
    setLoading(true); setListError("");
    Promise.all([request("/api/notice-rules"), isAdmin ? request("/api/notice-rules/recipients") : Promise.resolve([])])
      .then(([rows, people]) => { if (active) { setNotices(rows); setEmployees(people); } })
      .catch(e => { if (active) { setError(e.message); setListError(e.message); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, user?.role, isAdmin, request]);

  useEffect(() => {
    let active = true;
    openedImplementation.current = null;
    setReviewTarget(null); setOwnHighlightId(null); setJumpError("");
    if (implementationParam === null) return;
    setReviewNoticeId(null);
    if (!token || !user) return;
    if (user.role !== "admin" && user.role !== "employee") { setJumpError("无权查看落实记录。"); return; }
    const id = Number(implementationParam);
    if (!/^\d+$/.test(implementationParam) || !Number.isSafeInteger(id) || id <= 0) {
      setJumpError("落实记录编号无效。"); return;
    }
    request(`/api/notice-rules/implementations/${id}`)
      .then((record: { id: number; notice_id: number }) => {
        if (!active) return;
        if (record.id !== id || !Number.isSafeInteger(record.notice_id) || record.notice_id <= 0) throw new Error("落实记录加载失败，请刷新后重试。");
        setReviewTarget(record);
      })
      .catch(e => { if (active) setJumpError(e.message || "落实记录加载失败，请刷新后重试。"); });
    return () => { active = false; };
  }, [implementationParam, token, user, isAdmin, request]);

  useEffect(() => {
    if (!reviewTarget || openedImplementation.current === reviewTarget.id || loading) return;
    if (listError) { setJumpError("通知列表加载失败，请刷新后重试。"); return; }
    const targetNotice = notices.find(notice => notice.id === reviewTarget.notice_id);
    if (!targetNotice) {
      setJumpError("落实记录所属通知不存在或你无权查看。"); return;
    }
    if (!isAdmin && targetNotice.implementation?.id !== reviewTarget.id) {
      setJumpError("落实记录不存在或你无权查看。"); return;
    }
    openedImplementation.current = reviewTarget.id;
    if (isAdmin) setReviewNoticeId(reviewTarget.notice_id);
    else setOwnHighlightId(reviewTarget.id);
  }, [reviewTarget, loading, listError, notices, isAdmin]);

  useEffect(() => {
    if (ownHighlightId === null) return;
    let frame: number;
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = performance.now() + 5000;
    const locate = () => {
      const target = document.querySelector<HTMLElement>(`[data-notice-implementation-id="${ownHighlightId}"]`);
      if (target?.getClientRects().length) {
        target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        clearTimer = setTimeout(() => setOwnHighlightId(null), 3000);
      } else if (performance.now() < deadline) frame = requestAnimationFrame(locate);
      else { setOwnHighlightId(null); setJumpError("暂时无法定位该落实记录，请刷新后重试。"); }
    };
    frame = requestAnimationFrame(locate);
    return () => { cancelAnimationFrame(frame); clearTimeout(clearTimer); };
  }, [ownHighlightId]);

  // 从独立打印页返回时刷新本人的打印时间，不清除尚未提交的照片/说明。
  useEffect(() => {
    if (!token || user?.role !== "employee") return;
    const refresh = () => { void load().catch(e => setError(e.message)); };
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, user?.role, load]);

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      const result = await request("/api/notice-rules", { method: "POST", body: JSON.stringify({ title, body, type, recipient_mode: mode, recipient_ids: selected }) });
      setOpen(false); setTitle(""); setBody(""); setType("通知"); setMode("all"); setSelected([]);
      setSuccess(`发布成功，已为 ${result.recipient_count} 位员工生成落实记录。`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "发布失败，请重试"); }
    finally { setSaving(false); }
  }

  if (user?.role === "client") return <p>无权查看通知/规则。</p>;
  const inputClass = "w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm";
  return <div className="space-y-5 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">通知/规则</h1>
      {isAdmin && <Button onClick={() => { setOpen(!open); setError(""); }}>{open ? "收起发布表单" : "发布通知/规则"}</Button>}
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-600">{error}</p>}
    {jumpError && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-600">{jumpError}</p>}
    {success && <p role="status" className="rounded-lg bg-green-500/10 p-3 text-sm text-green-600">{success}</p>}
    {isAdmin && open && <form onSubmit={publish} className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-6">
      <label className="block space-y-2"><span>标题</span><input required value={title} onChange={e => setTitle(e.target.value)} className={inputClass} /></label>
      <label className="block space-y-2"><span>正文</span><textarea required rows={7} value={body} onChange={e => setBody(e.target.value)} className={inputClass} /></label>
      <label className="block space-y-2"><span>类型</span><select value={type} onChange={e => setType(e.target.value as typeof type)} className={inputClass}><option>通知</option><option>规则</option></select></label>
      <fieldset className="space-y-3"><legend className="mb-2">发送对象</legend>
        <div className="flex flex-wrap gap-3">
          <label className="flex min-h-11 items-center gap-2"><input type="radio" name="recipient_mode" checked={mode === "all"} onChange={() => setMode("all")} />全体员工（{employees.length} 人）</label>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" name="recipient_mode" checked={mode === "selected"} onChange={() => setMode("selected")} />指定员工（可多选）</label>
        </div>
        {mode === "selected" && <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {employees.map(employee => <label key={employee.id} className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-[var(--border)] p-3">
            <input type="checkbox" checked={selected.includes(employee.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev, employee.id] : prev.filter(id => id !== employee.id))} /><span className="break-all">{employee.name}</span>
          </label>)}
        </div>}
        {!employees.length && <p className="text-sm text-[var(--muted-foreground)]">暂无可接收的员工。</p>}
      </fieldset>
      <Button type="submit" disabled={saving || !employees.length || (mode === "selected" && !selected.length)} className="min-h-11 w-full sm:w-auto">{saving ? "发布中…" : "确认发布"}</Button>
    </form>}
    {loading ? <p>加载中…</p> : notices.length === 0 ? <p className="text-sm text-[var(--muted-foreground)]">暂无通知/规则。</p> : <div className="space-y-3">
      {notices.map(notice => <article key={notice.id} className="min-w-0 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-2"><span className="shrink-0 rounded-full bg-blue-500/10 px-2 py-1 text-xs text-blue-600">{notice.type}</span><h2 className="min-w-0 break-words text-lg font-semibold [overflow-wrap:anywhere]">{notice.title}</h2></div>
        <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{notice.body}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-[var(--muted-foreground)]"><span>{toThaiTime(notice.published_at)}</span><span>发布人：{notice.publisher_name}</span><span>发给 {notice.recipient_count} 人</span><span>已落实 {notice.implemented_count} 人</span></div>
        {isAdmin && <Button type="button" className="min-h-11" aria-expanded={reviewNoticeId === notice.id} onClick={() => setReviewNoticeId(current => current === notice.id ? null : notice.id)}>{reviewNoticeId === notice.id ? "收起员工清单" : "查看员工落实"}</Button>}
        {isAdmin && reviewNoticeId === notice.id && <NoticeRuleReview key={notice.id} noticeId={notice.id} token={token} onReviewed={load} targetImplementationId={reviewTarget?.notice_id === notice.id ? reviewTarget.id : null} />}
        {user?.role === "employee" && notice.implementation && <NoticeRuleImplementation key={`${notice.id}:${notice.implementation.submitted_at}:${notice.implementation.review_status}`} noticeId={notice.id} record={notice.implementation} token={token} onSaved={load} readOnly={implementationParam !== null} highlighted={ownHighlightId === notice.implementation.id} />}
      </article>)}
    </div>}
  </div>;
}
