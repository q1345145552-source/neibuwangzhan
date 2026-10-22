"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";

const control = "mt-1 min-h-11 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]";

export function MessageIssueDialog({ content, createdBy, onClose }: { content: string; createdBy: string; onClose: () => void }) {
  const [description, setDescription] = useState(content);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [status, setStatus] = useState("待处理");
  const [staff, setStaff] = useState<string[]>([]);
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
        // 与工单页相同：包含老板和员工，排除客户；员工接口沿用原有在岗筛选。
        const names = [...new Set<string>(data.filter(row => row.role !== "client" && typeof row.name === "string" && row.name.trim()).map(row => row.name))];
        if (!cancelled) setStaff(names);
      })
      .catch(e => { if (!cancelled) setLoadError(e instanceof Error ? e.message : "加载员工失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || loading || loadError) return;
    setError("");
    if (!description.trim()) { setError("请填写问题描述"); return; }
    if (!assignees.length) { setError("请至少指定一个解决人"); return; }
    inFlight.current = true; setSaving(true);
    try {
      const response = await fetchWithAuth("/api/issues", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim(), assignee: assignees, status, created_by: createdBy }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "创建工单失败，请重试");
      onClose();
      alert("工单创建成功");
    } catch (e) { setError(e instanceof Error ? e.message : "创建工单失败，请重试"); }
    finally { inFlight.current = false; setSaving(false); }
  }

  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!saving) onClose(); }}>
    <form role="dialog" aria-modal="true" aria-labelledby="message-issue-title" onSubmit={submit} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Escape" && !saving) onClose(); }} className="max-h-[calc(100dvh-2rem)] w-full min-w-0 max-w-md space-y-4 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl">
      <div className="flex items-center justify-between gap-3"><h3 id="message-issue-title" className="text-sm font-semibold">转工单</h3><button type="button" disabled={saving} onClick={onClose} aria-label="关闭转工单" className="flex size-11 shrink-0 items-center justify-center"><X className="size-5" /></button></div>
      <label className="block text-xs font-medium">问题描述<textarea value={description} onChange={e => setDescription(e.target.value)} disabled={saving} rows={4} className={control} /></label>
      <fieldset disabled={saving || loading} className="min-w-0"><legend className="text-xs font-medium">负责人（可多选）</legend>
        {loading ? <p role="status" className="mt-2 text-sm text-[var(--muted-foreground)]">加载员工中…</p> : loadError ? <div className="mt-2"><p role="alert" className="text-sm text-red-600">{loadError}</p><Button type="button" variant="outline" onClick={() => setLoadAttempt(attempt => attempt + 1)} className="mt-2 min-h-11">重新加载员工</Button></div> : <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-[var(--border)] p-2">
          {staff.length ? <div className="grid grid-cols-2 gap-1">{staff.map(name => <label key={name} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-[var(--muted)]"><input type="checkbox" checked={assignees.includes(name)} onChange={() => setAssignees(previous => previous.includes(name) ? previous.filter(value => value !== name) : [...previous, name])} className="size-4 shrink-0" /><span className="min-w-0 [overflow-wrap:anywhere]">{name}</span></label>)}</div> : <p className="p-2 text-sm text-[var(--muted-foreground)]">暂无可选员工</p>}
        </div>}
      </fieldset>
      <label className="block text-xs font-medium">状态<select value={status} disabled={saving} onChange={e => setStatus(e.target.value)} className={control}>{["待处理", "处理中", "已解决"].map(value => <option key={value}>{value}</option>)}</select></label>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={onClose} className="min-h-11">取消</Button><Button type="submit" disabled={saving || loading || !!loadError || !staff.length} className="min-h-11">{saving ? "创建中…" : "确认"}</Button></div>
    </form>
  </div>;
}
