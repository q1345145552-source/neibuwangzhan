"use client";

import { useState, useEffect } from "react";
import { fetchWithAuth } from "@/lib/api";
import { apiCall } from "@/lib/api-call";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime, bangkokDateStr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, X, ClipboardList } from "lucide-react";

interface WorkReport {
  id: number;
  employee_name: string;
  report_date: string;
  completed_items: string;
  summary: string;
  tomorrow_plan: string;
  problems: string;
  status: string;
  is_backfill: number;
  submitted_at: string;
  created_at: string;
}

function parseItems(s: string): string[] {
  try { const a = JSON.parse(s || "[]"); return Array.isArray(a) ? a : []; } catch { return []; }
}

function bkkYesterday(): string {
  const d = new Date(bangkokDateStr() + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
}

export default function WorkReportsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [reports, setReports] = useState<WorkReport[]>([]);
  const [loading, setLoading] = useState(true);

  // 填写/重交表单
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "resubmit">("create");
  const [formId, setFormId] = useState<number | null>(null);
  const [formDate, setFormDate] = useState("");
  const [formItems, setFormItems] = useState<string[]>([""]);
  const [formSummary, setFormSummary] = useState("");
  const [formPlan, setFormPlan] = useState("");
  const [formProblems, setFormProblems] = useState("");
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);

  // 详情弹窗
  const [detail, setDetail] = useState<WorkReport | null>(null);

  const load = () => {
    setLoading(true);
    fetchWithAuth("/api/work-reports", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setReports(Array.isArray(d) ? d : []))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [user?.name]);

  const today = bangkokDateStr();
  const yesterday = bkkYesterday();
  const todayReport = reports.find((r) => r.report_date === today);
  const yesterdayReport = reports.find((r) => r.report_date === yesterday);

  const openCreate = (date: string) => {
    setFormMode("create");
    setFormId(null);
    setFormDate(date);
    setFormItems([""]);
    setFormSummary("");
    setFormPlan("");
    setFormProblems("");
    setFormErr("");
    setFormOpen(true);
  };

  const openResubmit = (r: WorkReport) => {
    setFormMode("resubmit");
    setFormId(r.id);
    setFormDate(r.report_date);
    setFormItems(parseItems(r.completed_items).length ? parseItems(r.completed_items) : [""]);
    setFormSummary(r.summary || "");
    setFormPlan(r.tomorrow_plan || "");
    setFormProblems(r.problems || "");
    setFormErr("");
    setFormOpen(true);
    setDetail(null);
  };

  const addItem = () => setFormItems((p) => [...p, ""]);
  const removeItem = (i: number) => setFormItems((p) => p.filter((_, idx) => idx !== i));
  const updateItem = (i: number, v: string) => setFormItems((p) => p.map((it, idx) => (idx === i ? v : it)));

  const submit = async () => {
    const items = formItems.map((s) => s.trim()).filter(Boolean);
    if (items.length === 0) { setFormErr("请至少填写一条今日已完成"); return; }
    setSaving(true);
    const body = { report_date: formDate, completed_items: items, summary: formSummary, tomorrow_plan: formPlan, problems: formProblems };
    const ok = formMode === "create"
      ? await apiCall("/api/work-reports", { method: "POST", body, onError: (m) => setFormErr(m) })
      : await apiCall(`/api/work-reports/${formId}`, { method: "PATCH", body, onError: (m) => setFormErr(m) });
    setSaving(false);
    if (ok) { setFormOpen(false); setFormErr(""); load(); }
  };

  const reject = async (r: WorkReport) => {
    if (!confirm(`确定退回 ${r.employee_name} ${r.report_date} 的工作记录？`)) return;
    const ok = await apiCall(`/api/work-reports/${r.id}`, { method: "PATCH", body: { action: "reject" } });
    if (ok) { setDetail(null); load(); }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">{isAdmin ? "工作记录" : "我的工作记录"}</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{isAdmin ? "查看所有员工的每日工作记录，可退回" : "每天填一份，记录今天做了什么"}</p>
      </div>

      {/* 员工：今日填写状态 */}
      {!isAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          {todayReport ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] px-3 py-1.5 text-sm font-medium text-[oklch(0.38_0.14_155)]">
              今日已提交
            </span>
          ) : (
            <Button size="sm" onClick={() => openCreate(today)} className="gap-1.5">
              <ClipboardList className="size-4" />填写今日工作记录
            </Button>
          )}
          {!yesterdayReport && (
            <Button size="sm" variant="outline" onClick={() => openCreate(yesterday)}>
              补交昨日工作记录
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
      ) : reports.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无工作记录</p>
      ) : (
        <div className="flex flex-col gap-2">
          {reports.map((r) => (
            <button
              key={r.id}
              onClick={() => setDetail(r)}
              className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 text-left transition-colors hover:border-[var(--primary)]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {isAdmin && <span className="truncate text-sm font-medium text-[var(--foreground)]">{r.employee_name}</span>}
                  <span className="text-sm text-[var(--foreground)]">{r.report_date}</span>
                  {r.is_backfill === 1 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">补交</span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
                  {parseItems(r.completed_items).slice(0, 2).join("、")}{parseItems(r.completed_items).length > 2 ? "…" : ""}
                </p>
              </div>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", r.status === "已提交" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300")}>
                {r.status}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 填写/重交弹窗 */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFormOpen(false)}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-[var(--foreground)]">
                {formMode === "create" ? (formDate === yesterday ? "补交昨日工作记录" : "填写今日工作记录") : "重新提交工作记录"}
              </h3>
              <button onClick={() => setFormOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">日期：{formDate}</p>

            <div className="mt-4">
              <label className="text-xs font-medium">今日已完成 <span className="text-[var(--destructive)]">*</span></label>
              <div className="mt-1.5 space-y-1.5">
                {formItems.map((item, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input value={item} onChange={(e) => updateItem(i, e.target.value)} placeholder={`工作项 ${i + 1}`} className="h-9 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                    <button type="button" onClick={() => removeItem(i)} className="flex size-9 shrink-0 items-center justify-center rounded border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]/40"><X className="size-3.5" /></button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addItem} className="mt-1.5 inline-flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"><Plus className="size-3.5" />添加工作项</button>
            </div>

            <div className="mt-3">
              <label className="text-xs font-medium">工作总结（可选）</label>
              <textarea value={formSummary} onChange={(e) => setFormSummary(e.target.value)} rows={3} placeholder="今天的工作总结" className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div className="mt-3">
              <label className="text-xs font-medium">明日计划（可选）</label>
              <textarea value={formPlan} onChange={(e) => setFormPlan(e.target.value)} rows={2} placeholder="明天打算做什么" className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div className="mt-3">
              <label className="text-xs font-medium">遇到的问题（可选）</label>
              <textarea value={formProblems} onChange={(e) => setFormProblems(e.target.value)} rows={2} placeholder="遇到什么问题需要协调" className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
            </div>

            {formErr && <p className="mt-2 text-xs text-[var(--destructive)]">{formErr}</p>}
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={submit} disabled={saving}>{saving ? "提交中…" : "提交"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>取消</Button>
            </div>
          </div>
        </div>
      )}

      {/* 详情弹窗 */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-[var(--foreground)]">
                  {isAdmin ? `${detail.employee_name} 的工作记录` : "工作记录"}
                </h3>
                <div className="mt-1 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  <span>{detail.report_date}</span>
                  {detail.is_backfill === 1 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">补交</span>}
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", detail.status === "已提交" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300")}>{detail.status}</span>
                </div>
              </div>
              <button onClick={() => setDetail(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <div>
                <p className="text-xs font-medium text-[var(--muted-foreground)]">今日已完成</p>
                <ul className="mt-1 space-y-1">
                  {parseItems(detail.completed_items).map((it, i) => (
                    <li key={i} className="flex gap-2"><span className="text-[var(--muted-foreground)]">{i + 1}.</span><span className="break-words">{it}</span></li>
                  ))}
                </ul>
              </div>
              {detail.summary && (
                <div>
                  <p className="text-xs font-medium text-[var(--muted-foreground)]">工作总结</p>
                  <p className="mt-1 whitespace-pre-wrap break-words">{detail.summary}</p>
                </div>
              )}
              {detail.tomorrow_plan && (
                <div>
                  <p className="text-xs font-medium text-[var(--muted-foreground)]">明日计划</p>
                  <p className="mt-1 whitespace-pre-wrap break-words">{detail.tomorrow_plan}</p>
                </div>
              )}
              {detail.problems && (
                <div>
                  <p className="text-xs font-medium text-[var(--muted-foreground)]">遇到的问题</p>
                  <p className="mt-1 whitespace-pre-wrap break-words">{detail.problems}</p>
                </div>
              )}
              <p className="text-xs text-[var(--muted-foreground)]">提交时间：{toThaiTime(detail.submitted_at) || "—"}</p>
            </div>

            {isAdmin && detail.status === "已提交" && (
              <div className="mt-4 border-t border-[var(--border)] pt-3">
                <Button size="sm" variant="destructive" onClick={() => reject(detail)}>退回</Button>
              </div>
            )}
            {!isAdmin && detail.status === "退回" && detail.employee_name === user?.name && (
              <div className="mt-4 border-t border-[var(--border)] pt-3">
                <Button size="sm" onClick={() => openResubmit(detail)}>修改重交</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
