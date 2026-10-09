"use client";

import { useState, useEffect } from "react";
import { fetchWithAuth } from "@/lib/api";
import { apiCall } from "@/lib/api-call";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { X, History } from "lucide-react";

interface Rule {
  id: number;
  title: string;
  content: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  pending?: { announcement_id: number; title: string; deadline: string; confirmed: number; total: number } | null;
}
interface HistoryItem {
  id: number;
  title: string;
  content: string;
  changed_by: string;
  changed_at: string;
}

export default function RulesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [rules, setRules] = useState<Rule[]>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [detail, setDetail] = useState<Rule | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [updateTarget, setUpdateTarget] = useState<Rule | null>(null);
  const [updateForm, setUpdateForm] = useState({ title: "", body: "", deadline: "" });
  const [updateSendAll, setUpdateSendAll] = useState(true);
  const [updateSelected, setUpdateSelected] = useState<string[]>([]);
  const [updateSaving, setUpdateSaving] = useState(false);
  const [updateErr, setUpdateErr] = useState("");

  const [applying, setApplying] = useState(false);

  const load = () => {
    setLoading(true);
    fetchWithAuth("/api/rules", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRules(Array.isArray(d) ? d : []))
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  };

  const loadEmployees = () => {
    if (!isAdmin) return;
    fetchWithAuth("/api/employees", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setEmployees((Array.isArray(d) ? d : []).filter((e: any) => e.role === "employee" && e.status === "在职")))
      .catch(() => {});
  };

  useEffect(() => { load(); loadEmployees(); }, [isAdmin]);

  // 刷新某条规则的最新数据 + 历史
  const refreshRule = async (id: number) => {
    const res = await fetchWithAuth("/api/rules", { cache: "no-store" });
    const d = await res.json();
    const list = Array.isArray(d) ? d : [];
    setRules(list);
    const fresh = list.find((x: any) => x.id === id);
    if (fresh) setDetail(fresh);
    if (isAdmin) {
      try {
        const hres = await fetchWithAuth(`/api/rules/${id}/history`, { cache: "no-store" });
        const hd = await hres.json();
        if (hres.ok) setHistory(Array.isArray(hd.history) ? hd.history : []);
      } catch {}
    }
  };

  const openDetail = async (r: Rule) => {
    setDetail(r);
    setHistory([]);
    if (isAdmin) {
      setHistoryLoading(true);
      try {
        const res = await fetchWithAuth(`/api/rules/${r.id}/history`, { cache: "no-store" });
        const d = await res.json();
        if (res.ok) setHistory(Array.isArray(d.history) ? d.history : []);
      } catch {}
      setHistoryLoading(false);
    }
  };

  const openUpdate = (r: Rule) => {
    setUpdateTarget(r);
    setUpdateForm({ title: r.title, body: "", deadline: "" });
    setUpdateSendAll(true);
    setUpdateSelected([]);
    setUpdateErr("");
  };

  const toggleUpdateEmployee = (name: string) => setUpdateSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  const submitUpdate = async () => {
    if (!updateTarget) return;
    if (!updateForm.body.trim()) { setUpdateErr("请填写新规则内容"); return; }
    if (!updateForm.deadline) { setUpdateErr("请填写截止时间"); return; }
    if (!updateSendAll && updateSelected.length === 0) { setUpdateErr("请选择接收人"); return; }
    setUpdateSaving(true);
    const ok = await apiCall(`/api/rules/${updateTarget.id}/update`, {
      method: "POST",
      body: { title: updateForm.title.trim(), body: updateForm.body, recipients: updateSendAll ? "all" : updateSelected, deadline: updateForm.deadline },
      onError: (m) => setUpdateErr(m),
    });
    setUpdateSaving(false);
    if (ok) { setUpdateTarget(null); setUpdateErr(""); refreshRule(updateTarget.id); }
  };

  const applyUpdate = async (r: Rule) => {
    if (!confirm(`确认用新规则覆盖「${r.title}」？旧内容会存成历史记录。`)) return;
    setApplying(true);
    const ok = await apiCall(`/api/rules/${r.id}/apply`, { method: "POST" });
    setApplying(false);
    if (ok) refreshRule(r.id);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">规则库</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{isAdmin ? "长通知可转成规则，规则可更新覆盖（旧内容存历史）" : "公司规章制度，员工只读"}</p>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
      ) : rules.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无规则</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rules.map((r) => (
            <button key={r.id} onClick={() => openDetail(r)} className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 text-left transition-colors hover:border-[var(--primary)]">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--foreground)]">{r.title}</p>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">更新于 {toThaiTime(r.updated_at)}</p>
                </div>
                {isAdmin && r.pending && (
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", r.pending.confirmed >= r.pending.total ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300")}>
                    更新待确认 {r.pending.confirmed}/{r.pending.total}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 规则详情弹窗 */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-[var(--foreground)]">{detail.title}</h3>
              <button onClick={() => setDetail(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">更新于 {toThaiTime(detail.updated_at)}</p>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--foreground)]">{detail.content}</p>

            {isAdmin && (
              <div className="mt-4 border-t border-[var(--border)] pt-4">
                {detail.pending && (
                  <div className="mb-3 rounded-md border border-[var(--border)] bg-[var(--muted)]/20 p-3">
                    <p className="text-sm">
                      更新待确认：<span className="font-medium">{detail.pending.confirmed}/{detail.pending.total}</span> 人已确认
                      <span className="ml-1 text-xs text-[var(--muted-foreground)]">（截止 {detail.pending.deadline?.replace("T", " ").slice(0, 16)}）</span>
                    </p>
                    <Button
                      size="sm"
                      className="mt-2"
                      onClick={() => applyUpdate(detail)}
                      disabled={applying || detail.pending!.confirmed < detail.pending!.total || detail.pending!.total === 0}
                    >
                      {detail.pending.confirmed < detail.pending.total ? `更新覆盖（还有 ${detail.pending.total - detail.pending.confirmed} 人未确认）` : "更新覆盖"}
                    </Button>
                  </div>
                )}
                <Button size="sm" variant="outline" onClick={() => openUpdate(detail)}>更新规则</Button>
              </div>
            )}

            {isAdmin && (
              <div className="mt-4 border-t border-[var(--border)] pt-4">
                <h4 className="flex items-center gap-1.5 text-sm font-medium"><History className="size-4" />更新历史</h4>
                {historyLoading ? (
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">加载中…</p>
                ) : history.length === 0 ? (
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">暂无历史记录</p>
                ) : (
                  <div className="mt-2 flex flex-col gap-2">
                    {history.map((h) => (
                      <div key={h.id} className="rounded-md border border-[var(--border)] bg-[var(--muted)]/20 p-3">
                        <p className="text-xs text-[var(--muted-foreground)]">{toThaiTime(h.changed_at)} · {h.changed_by} 覆盖前内容</p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--foreground)]">{h.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 更新规则弹窗 */}
      {updateTarget && isAdmin && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setUpdateTarget(null)}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-[var(--foreground)]">更新规则：{updateTarget.title}</h3>
              <button onClick={() => setUpdateTarget(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-xs font-medium">标题</label>
                <input value={updateForm.title} onChange={(e) => setUpdateForm((p) => ({ ...p, title: e.target.value }))} placeholder="规则标题" className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium">新规则内容 <span className="text-[var(--destructive)]">*</span></label>
                <textarea value={updateForm.body} onChange={(e) => setUpdateForm((p) => ({ ...p, body: e.target.value }))} rows={6} placeholder="新的规则内容" className="mt-1 w-full rounded border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
              <div>
                <label className="text-xs font-medium">截止时间 <span className="text-[var(--destructive)]">*</span></label>
                <input type="datetime-local" value={updateForm.deadline} onChange={(e) => setUpdateForm((p) => ({ ...p, deadline: e.target.value }))} className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium">接收人 <span className="text-[var(--destructive)]">*</span></label>
                <label className="mt-1 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={updateSendAll} onChange={(e) => { setUpdateSendAll(e.target.checked); if (e.target.checked) setUpdateSelected([]); }} className="size-4" />
                  发送给全体在职员工
                </label>
                {!updateSendAll && (
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-[var(--border)] p-2">
                    {employees.length === 0 ? (
                      <p className="py-3 text-center text-xs text-[var(--muted-foreground)]">暂无在职员工</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {employees.map((e) => (
                          <label key={e.id} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-sm hover:bg-[var(--muted)]/30">
                            <input type="checkbox" checked={updateSelected.includes(e.name)} onChange={() => toggleUpdateEmployee(e.name)} className="size-4" />
                            <span className="truncate">{e.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs text-[var(--muted-foreground)]">保存后相当于发一条长通知给接收人，员工复述确认后，回到规则库点「更新覆盖」才会真正覆盖旧规则。</p>
            {updateErr && <p className="mt-2 text-xs text-[var(--destructive)]">{updateErr}</p>}
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={submitUpdate} disabled={updateSaving}>{updateSaving ? "发送中…" : "发送更新通知"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setUpdateTarget(null)}>取消</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
