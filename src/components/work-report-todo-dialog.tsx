"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { fetchWithAuth } from "@/lib/api";
import { Button } from "@/components/ui/button";

type Report = { id: number; employee_name: string; report_date: string };
type Employee = { id: number; name: string; role: string };
const control = "mt-1 block min-h-11 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm";

/** 手动新建普通待办，不携带自动派单的来源标记。两个入口共用此表单。 */
export default function WorkReportTodoDialog({ report, onClose }: { report: Report; onClose: (created: boolean) => void }) {
  const [, month, day] = report.report_date.split("-").map(Number);
  const [content, setContent] = useState(`${month}月${day}日 工作记录相关事项`);
  const [assignee, setAssignee] = useState(report.employee_name);
  const [priority, setPriority] = useState("普通");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const [viewport, setViewport] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const locked = useRef(false), dialog = useRef<HTMLDivElement>(null), close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError("");
    fetchWithAuth("/api/employees", { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "员工列表加载失败");
      if (!Array.isArray(data)) throw Error("员工列表加载失败");
      if (!controller.signal.aborted) setEmployees(data.filter((item: Employee) => item.role === "employee" && item.name));
    }).catch(reason => { if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : "员工列表加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !locked.current) { event.preventDefault(); event.stopPropagation(); close.current(false); }
      if (event.key !== "Tab") return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)") || [])].filter(element => element.getClientRects().length);
      if (!controls.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);

  useEffect(() => {
    const current = window.visualViewport;
    if (!current) return;
    const update = () => setViewport({ left: current.offsetLeft, top: current.offsetTop, width: current.width, height: current.height });
    update(); current.addEventListener("resize", update); current.addEventListener("scroll", update);
    return () => { current.removeEventListener("resize", update); current.removeEventListener("scroll", update); };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (locked.current) return;
    if (!content.trim()) { setError("请填写待办内容"); return; }
    if (!assignee) { setError("请选择负责人"); return; }
    if (loading || loadError) return;
    locked.current = true; setSaving(true); setError("");
    try {
      const response = await fetchWithAuth("/api/todos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: content.trim(), assignee, priority }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "创建待办失败，请重试");
      close.current(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "创建待办失败，请重试"); }
    finally { locked.current = false; setSaving(false); }
  };

  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3" style={viewport ? { left: viewport.left, top: viewport.top, width: viewport.width, height: viewport.height, right: "auto", bottom: "auto" } : undefined} onClick={() => { if (!locked.current) onClose(false); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="report-todo-title" className="max-h-full w-full min-w-0 max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 shadow-xl sm:p-5" onClick={event => event.stopPropagation()}>
      <div className="flex items-center justify-between gap-3"><h2 id="report-todo-title" className="font-medium">工作记录转待办</h2><button type="button" aria-label="关闭转待办" disabled={saving} className="min-h-11 min-w-11" onClick={() => onClose(false)}>✕</button></div>
      <p className="text-xs text-[var(--muted-foreground)]">{report.employee_name} · {report.report_date}</p>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <label className="block text-sm">待办内容<textarea aria-label="待办内容" rows={4} value={content} disabled={saving} onChange={event => setContent(event.target.value)} className={control}/></label>
        <label className="block text-sm">负责人<select aria-label="负责人" value={assignee} disabled={saving || loading || !!loadError} onChange={event => setAssignee(event.target.value)} className={control}>
          {!employees.some(employee => employee.name === report.employee_name) && <option value={report.employee_name}>{report.employee_name}</option>}
          {employees.map(employee => <option key={employee.id} value={employee.name}>{employee.name}</option>)}
        </select></label>
        {loading && <p role="status" className="text-xs text-[var(--muted-foreground)]">加载员工列表…</p>}
        {loadError && <p role="alert" className="text-sm text-[var(--destructive)]">{loadError}<button type="button" className="ml-2 underline" onClick={() => setRetry(value => value + 1)}>重试</button></p>}
        <label className="block text-sm">优先级<select aria-label="优先级" value={priority} disabled={saving} onChange={event => setPriority(event.target.value)} className={control}><option value="普通">普通</option><option value="紧急">紧急</option></select></label>
        {error && <p role="alert" className="break-words text-sm text-[var(--destructive)]">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={() => onClose(false)}>取消</Button><Button type="submit" disabled={saving || loading || !!loadError}>{saving ? "创建中…" : "确认创建待办"}</Button></div>
      </form>
    </div>
  </div>;
}
