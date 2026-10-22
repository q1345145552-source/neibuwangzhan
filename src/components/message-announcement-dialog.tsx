"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";

const control = "mt-1 min-h-11 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]";

export function MessageAnnouncementDialog({ content, onClose }: { content: string; onClose: () => void }) {
  const [title, setTitle] = useState(() => Array.from(content.trim().replace(/\s+/g, " ")).slice(0, 20).join(""));
  const [body, setBody] = useState(content);
  const [deadline, setDeadline] = useState("");
  const [sendAll, setSendAll] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [employees, setEmployees] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadError("");
    fetchWithAuth("/api/employees", { cache: "no-store" })
      .then(async response => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "加载员工失败");
        if (!Array.isArray(data)) throw new Error("加载员工失败，请重试");
        const names = [...new Set<string>(data.filter(row => row.role === "employee" && row.status === "在职" && typeof row.name === "string" && row.name.trim()).map(row => row.name))];
        if (!cancelled) setEmployees(names);
      })
      .catch(e => { if (!cancelled) setLoadError(e instanceof Error ? e.message : "加载员工失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || loading || loadError) return;
    setError("");
    if (!title.trim()) { setError("请填写标题"); return; }
    if (!body.trim()) { setError("请填写正文"); return; }
    if (!deadline) { setError("请填写截止时间"); return; }
    if (!sendAll && !selected.length) { setError("请选择接收人"); return; }
    inFlight.current = true; setSaving(true);
    try {
      const response = await fetchWithAuth("/api/announcements", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body, recipients: sendAll ? "all" : selected, deadline }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "通知发送失败，请重试");
      onClose(); alert("通知发送成功");
    } catch (e) { setError(e instanceof Error ? e.message : "通知发送失败，请重试"); }
    finally { inFlight.current = false; setSaving(false); }
  }

  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!saving) onClose(); }}>
    <form role="dialog" aria-modal="true" aria-labelledby="message-announcement-title" onSubmit={submit} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Escape" && !saving) onClose(); }} className="max-h-[calc(100dvh-2rem)] w-full min-w-0 max-w-md space-y-4 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl">
      <div className="flex items-center justify-between gap-3"><h3 id="message-announcement-title" className="text-sm font-semibold">转老板通知</h3><button type="button" disabled={saving} onClick={onClose} aria-label="关闭转老板通知" className="flex size-11 shrink-0 items-center justify-center"><X className="size-5" /></button></div>
      <label className="block text-xs font-medium">标题（必填）<input value={title} onChange={e => setTitle(e.target.value)} disabled={saving} className={control} /></label>
      <label className="block text-xs font-medium">正文<textarea value={body} onChange={e => setBody(e.target.value)} disabled={saving} rows={4} className={control} /></label>
      <fieldset disabled={saving || loading} className="min-w-0"><legend className="text-xs font-medium">接收人</legend>
        <div className="mt-1 flex flex-wrap gap-x-4"><label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="announcement-recipients" checked={sendAll} onChange={() => { setSendAll(true); setSelected([]); }} />全体在职员工</label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="announcement-recipients" checked={!sendAll} onChange={() => setSendAll(false)} />指定员工</label></div>
        {loading ? <p role="status" className="text-sm text-[var(--muted-foreground)]">加载员工中…</p> : loadError ? <div><p role="alert" className="text-sm text-red-600">{loadError}</p><Button type="button" variant="outline" onClick={() => setLoadAttempt(attempt => attempt + 1)} className="mt-2 min-h-11">重新加载员工</Button></div> : !employees.length ? <p className="text-sm text-[var(--muted-foreground)]">暂无在职员工</p> : !sendAll && <div className="max-h-40 overflow-y-auto rounded-md border border-[var(--border)] p-2"><div className="grid grid-cols-2 gap-1">{employees.map(name => <label key={name} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-[var(--muted)]"><input type="checkbox" checked={selected.includes(name)} onChange={() => setSelected(previous => previous.includes(name) ? previous.filter(value => value !== name) : [...previous, name])} className="size-4 shrink-0" /><span className="min-w-0 [overflow-wrap:anywhere]">{name}</span></label>)}</div></div>}
      </fieldset>
      <label className="block text-xs font-medium">截止时间（泰国时间，必填）<input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} disabled={saving} className={control} /></label>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={onClose} className="min-h-11">取消</Button><Button type="submit" disabled={saving || loading || !!loadError || !employees.length} className="min-h-11">{saving ? "发送中…" : "确认"}</Button></div>
    </form>
  </div>;
}
