"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";

interface Project {
  id: number;
  name: string;
  description: string;
  assignee: string;
  current_phase: string;
  status: string;
  created_by: string;
  created_at: string;
  latest_progress_content?: string | null;
  latest_progress_by?: string | null;
  latest_progress_at?: string | null;
}

const STATUS_CLASS: Record<string, string> = {
  "孵化中": "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  "已孵化为业务线": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  "已搁置": "bg-[var(--muted)] text-[var(--muted-foreground)]",
};

const PHASES = ["构思", "执行", "里程碑", "收益"];

const PHASE_CLASS: Record<string, string> = {
  "构思": "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  "执行": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "里程碑": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  "收益": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
};

export default function ProjectsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", assignee: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [progressTarget, setProgressTarget] = useState<Project | null>(null);
  const [progressContent, setProgressContent] = useState("");
  const [savingProgress, setSavingProgress] = useState(false);
  const [summaryTarget, setSummaryTarget] = useState<Project | null>(null);
  const [summaryForm, setSummaryForm] = useState({ phase: "", conclusion: "", lesson: "", adjustment: "" });
  const [savingSummary, setSavingSummary] = useState(false);

  const load = useCallback(() => {
    fetchWithAuth("/api/projects", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setProjects(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // 负责人下拉
  useEffect(() => {
    if (!isAdmin) return;
    fetchWithAuth("/api/employees").then((r) => r.json()).then((d) => setEmployees(Array.isArray(d) ? d : [])).catch(() => {});
  }, [isAdmin]);

  const openForm = () => {
    setForm({ name: "", description: "", assignee: "" });
    setErr("");
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { setErr("请填写项目名称"); return; }
    setSaving(true);
    setErr("");
    try {
      const res = await fetchWithAuth("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowForm(false);
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        setErr(e.error || "提交失败");
      }
    } catch { setErr("提交失败"); }
    finally { setSaving(false); }
  };

  // 切换阶段：拨到下一个阶段（构思→执行→里程碑→收益）
  const handlePhaseChange = async (p: Project, nextPhase: string) => {
    try {
      const res = await fetchWithAuth(`/api/projects/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: nextPhase }),
      });
      if (res.ok) {
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "切换失败");
      }
    } catch { alert("切换失败"); }
  };

  const openProgress = (p: Project) => {
    setProgressTarget(p);
    setProgressContent("");
  };

  const handleProgress = async () => {
    if (!progressTarget) return;
    if (!progressContent.trim()) { alert("请填写进展内容"); return; }
    setSavingProgress(true);
    try {
      const res = await fetchWithAuth(`/api/projects/${progressTarget.id}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: progressContent.trim() }),
      });
      if (res.ok) {
        setProgressTarget(null);
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "提交失败");
      }
    } catch { alert("提交失败"); }
    finally { setSavingProgress(false); }
  };

  const openSummary = (p: Project) => {
    setSummaryTarget(p);
    setSummaryForm({ phase: p.current_phase || "构思", conclusion: "", lesson: "", adjustment: "" });
  };

  const handleSummary = async () => {
    if (!summaryTarget) return;
    if (!summaryForm.phase) { alert("请选择阶段"); return; }
    if (!summaryForm.conclusion.trim() && !summaryForm.lesson.trim() && !summaryForm.adjustment.trim()) { alert("请填写总结内容"); return; }
    setSavingSummary(true);
    try {
      const res = await fetchWithAuth(`/api/projects/${summaryTarget.id}/summaries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(summaryForm),
      });
      if (res.ok) {
        setSummaryTarget(null);
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "提交失败");
      }
    } catch { alert("提交失败"); }
    finally { setSavingSummary(false); }
  };

  // 升级为业务线：只有老板能点
  const handlePromote = async (p: Project) => {
    if (!confirm(`确认把「${p.name}」升级为业务线？升级后该项目标记为已孵化成型。`)) return;
    try {
      const res = await fetchWithAuth(`/api/projects/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "已孵化为业务线" }),
      });
      if (res.ok) {
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "升级失败");
      }
    } catch { alert("升级失败"); }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">我的项目</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">我的项目列表</p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={openForm} className="gap-1.5">
            <Plus className="size-3.5" />新建项目
          </Button>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</div>
      ) : projects.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无项目</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--secondary)]/50">
                <th className="py-3 px-5 text-left text-xs font-medium text-[var(--muted-foreground)]">项目名称</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">想法描述</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">负责人</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">阶段</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">状态</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">创建时间</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">操作</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b border-[var(--border)] hover:bg-[var(--secondary)]/30">
                  <td className="py-3 px-5">
                    <Link href={`/projects/${p.id}`} className="font-medium text-[var(--foreground)] hover:underline">{p.name}</Link>
                    {p.latest_progress_content && (
                      <div className="mt-1 text-xs text-[var(--muted-foreground)]">
                        最新：{p.latest_progress_content}
                        <span className="ml-1 text-[var(--muted-foreground)]/70">· {p.latest_progress_by} · {toThaiTime(p.latest_progress_at)}</span>
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-w-[240px] truncate">{p.description || "—"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)]">{p.assignee || "—"}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", PHASE_CLASS[p.current_phase] || "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>{p.current_phase || "构思"}</span>
                      {(() => {
                        const idx = PHASES.indexOf(p.current_phase);
                        const next = idx >= 0 && idx < PHASES.length - 1 ? PHASES[idx + 1] : null;
                        const canSwitch = isAdmin || user?.name === p.assignee;
                        return next && canSwitch ? (
                          <button onClick={() => handlePhaseChange(p, next)} className="text-xs text-[var(--primary)] hover:underline">→ {next}</button>
                        ) : null;
                      })()}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASS[p.status] || "bg-[var(--muted)] text-[var(--muted-foreground)]")}>{p.status}</span>
                  </td>
                  <td className="py-3 px-4 text-xs text-[var(--muted-foreground)]">{toThaiTime(p.created_at) || "—"}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      {(isAdmin || user?.name === p.assignee) && (
                        <>
                          <button onClick={() => openProgress(p)} className="text-xs text-[var(--primary)] hover:underline">写进展</button>
                          <button onClick={() => openSummary(p)} className="text-xs text-[var(--primary)] hover:underline">写总结</button>
                        </>
                      )}
                      {isAdmin && p.status === "孵化中" && (
                        <button onClick={() => handlePromote(p)} className="text-xs text-purple-600 hover:underline">升级为业务线</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 新建项目弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!saving) setShowForm(false); }}>
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">新建项目</h3>
              <button onClick={() => setShowForm(false)} disabled={saving} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">项目名称（必填）</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="项目叫什么"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">项目想法描述（选填）</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  rows={3}
                  placeholder="这个项目是做什么的"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">负责人</label>
                <select
                  value={form.assignee}
                  onChange={(e) => setForm((p) => ({ ...p, assignee: e.target.value }))}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                >
                  <option value="">请选择负责人</option>
                  {employees.map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
                </select>
              </div>

              {err && <p className="text-xs text-[var(--destructive)]">{err}</p>}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={saving}>取消</Button>
              <Button size="sm" onClick={handleSubmit} disabled={saving}>{saving ? "提交中…" : "提交"}</Button>
            </div>
          </div>
        </div>
      )}

      {/* 写进展弹窗 */}
      {progressTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!savingProgress) setProgressTarget(null); }}>
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">写进展</h3>
              <button onClick={() => setProgressTarget(null)} disabled={savingProgress} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">项目：{progressTarget.name}</p>
            <textarea
              value={progressContent}
              onChange={(e) => setProgressContent(e.target.value)}
              rows={4}
              placeholder="今天干了啥、进展到哪、遇到啥问题…"
              className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setProgressTarget(null)} disabled={savingProgress}>取消</Button>
              <Button size="sm" onClick={handleProgress} disabled={savingProgress}>{savingProgress ? "提交中…" : "提交进展"}</Button>
            </div>
          </div>
        </div>
      )}

      {/* 写总结弹窗 */}
      {summaryTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!savingSummary) setSummaryTarget(null); }}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">写总结</h3>
              <button onClick={() => setSummaryTarget(null)} disabled={savingSummary} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">项目：{summaryTarget.name}</p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">属于哪个阶段</label>
                <select
                  value={summaryForm.phase}
                  onChange={(e) => setSummaryForm((p) => ({ ...p, phase: e.target.value }))}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                >
                  {PHASES.map((ph) => <option key={ph} value={ph}>{ph}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">阶段结论</label>
                <textarea value={summaryForm.conclusion} onChange={(e) => setSummaryForm((p) => ({ ...p, conclusion: e.target.value }))} rows={2} placeholder="这个阶段得出了什么结论" className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">经验教训</label>
                <textarea value={summaryForm.lesson} onChange={(e) => setSummaryForm((p) => ({ ...p, lesson: e.target.value }))} rows={2} placeholder="踩了哪些坑、学到了什么" className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">方向调整</label>
                <textarea value={summaryForm.adjustment} onChange={(e) => setSummaryForm((p) => ({ ...p, adjustment: e.target.value }))} rows={2} placeholder="接下来方向怎么调整" className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setSummaryTarget(null)} disabled={savingSummary}>取消</Button>
              <Button size="sm" onClick={handleSummary} disabled={savingSummary}>{savingSummary ? "提交中…" : "提交总结"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
