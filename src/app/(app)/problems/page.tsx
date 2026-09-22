"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchWithAuth } from "@/lib/api";
import { cn } from "@/lib/utils";
import { bangkokToday } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";

interface Problem {
  id: number;
  problem_number: string;
  company_name: string;
  problem_type: string;
  status: string;
  assignee: string;
  priority: string;
  source: string;
  description: string;
  customer_requirement: string;
  deadline: string;
  created_by: string;
  created_at: string;
}

const PROBLEM_TYPES = ["税务问题", "证件问题", "地址变更问题", "年审问题", "代持问题", "合同问题", "金额问题"];
const PRIORITIES = ["普通", "紧急", "不急"];
const SOURCES = ["客户反馈", "内部发现"];

const STATUS_CLASS: Record<string, string> = {
  "待处理": "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  "跟进中": "bg-[color-mix(in_oklch,var(--info),var(--background)_85%)] text-[oklch(0.38_0.10_240)]",
  "已解决": "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  "老板验收": "bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] text-[var(--primary)]",
  "搁置": "bg-[var(--muted)] text-[var(--muted-foreground)]",
};

const ALL_STATUSES = ["待处理", "跟进中", "已解决", "老板验收", "搁置"];

interface ProblemStats {
  total: number;
  resolved: number;
  by_type: { type: string; count: number }[];
  by_assignee_unresolved: { name: string; count: number }[];
}

// 截止日期预警：未解决的问题，已超期标红、3 天内到期标黄
function deadlineState(deadline: string | undefined | null, status: string): "overdue" | "soon" | null {
  if (!deadline || status === "已解决") return null;
  const today = bangkokToday();
  if (deadline < today) return "overdue";
  const diff = Math.round((Date.parse(deadline) - Date.parse(today)) / 86400000);
  if (diff <= 3) return "soon";
  return null;
}

const EMPTY_FORM = {
  company_name: "",
  description: "",
  problem_type: "税务问题",
  source: "客户反馈",
  customer_requirement: "",
  assignee: "",
  priority: "普通",
  deadline: "",
};

export default function ProblemsPage() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [customers, setCustomers] = useState<{ id: number; company_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [filters, setFilters] = useState({ status: "", problem_type: "", priority: "", assignee: "" });
  const [stats, setStats] = useState<ProblemStats | null>(null);

  const loadStats = useCallback(() => {
    fetchWithAuth("/api/problems/stats", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setStats(d); })
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (filters.status) q.set("status", filters.status);
    if (filters.problem_type) q.set("problem_type", filters.problem_type);
    if (filters.priority) q.set("priority", filters.priority);
    if (filters.assignee) q.set("assignee", filters.assignee);
    const qs = q.toString();
    fetchWithAuth(`/api/problems${qs ? "?" + qs : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setProblems(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // 拉员工（负责人）+ 客户池（公司名）+ 统计看板
    fetchWithAuth("/api/employees").then((r) => r.json()).then((d) => setEmployees(Array.isArray(d) ? d : [])).catch(() => {});
    fetchWithAuth("/api/customers").then((r) => r.json()).then((d) => setCustomers(Array.isArray(d) ? d : [])).catch(() => {});
    loadStats();
  }, [loadStats]);

  const setField = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    setErr("");
    if (!form.company_name.trim()) return setErr("请填写公司名");
    if (!form.description.trim()) return setErr("请填写问题描述");
    if (!form.assignee) return setErr("请选择负责人");
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/problems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowForm(false);
        setForm(EMPTY_FORM);
        load();
        loadStats();
      } else {
        const e = await res.json().catch(() => ({}));
        setErr(e.error || "提交失败");
      }
    } catch {
      setErr("提交失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">问题跟踪</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">跟踪客户各类问题，紧急问题优先处理</p>
        </div>
        <Button size="sm" onClick={() => { setShowForm(true); setErr(""); }} className="gap-1.5">
          <Plus className="size-3.5" />新建问题
        </Button>
      </div>

      {/* 统计看板 */}
      {stats && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="grid gap-5 lg:grid-cols-3">
            <div>
              <h3 className="text-xs font-medium text-[var(--muted-foreground)]">总体进度</h3>
              <div className="mt-2 flex items-end gap-2">
                <span className="font-display text-3xl font-light leading-none text-[var(--foreground)]">{stats.total}</span>
                <span className="text-xs text-[var(--muted-foreground)]">个问题</span>
              </div>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                已解决 <span className="font-medium text-[oklch(0.38_0.14_155)]">{stats.resolved}</span> 个
                {stats.total > 0 && <> · 解决率 <span className="font-medium text-[var(--foreground)]">{Math.round((stats.resolved / stats.total) * 100)}%</span></>}
              </p>
            </div>
            <div>
              <h3 className="text-xs font-medium text-[var(--muted-foreground)]">各类型问题</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {stats.by_type.length === 0 ? (
                  <span className="text-sm text-[var(--muted-foreground)]">暂无</span>
                ) : stats.by_type.map((t) => (
                  <span key={t.type} className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs text-[var(--foreground)]">
                    {t.type} <span className="font-medium">{t.count}</span>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-medium text-[var(--muted-foreground)]">负责人未解决</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {stats.by_assignee_unresolved.length === 0 ? (
                  <span className="text-sm text-[var(--muted-foreground)]">暂无</span>
                ) : stats.by_assignee_unresolved.map((a) => (
                  <span key={a.name} className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] px-2 py-0.5 text-xs text-[var(--foreground)]">
                    {a.name} <span className="font-medium">{a.count}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 筛选栏：状态/问题类型/紧急程度/负责人，可组合 */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <span className="text-sm text-[var(--muted-foreground)]">筛选</span>
        <select
          value={filters.status}
          onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
          className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
        >
          <option value="">全部状态</option>
          {ALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={filters.problem_type}
          onChange={(e) => setFilters((p) => ({ ...p, problem_type: e.target.value }))}
          className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
        >
          <option value="">全部类型</option>
          {PROBLEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={filters.priority}
          onChange={(e) => setFilters((p) => ({ ...p, priority: e.target.value }))}
          className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
        >
          <option value="">全部紧急程度</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          value={filters.assignee}
          onChange={(e) => setFilters((p) => ({ ...p, assignee: e.target.value }))}
          className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
        >
          <option value="">全部负责人</option>
          {employees.map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
        </select>
        {(filters.status || filters.problem_type || filters.priority || filters.assignee) && (
          <Button size="sm" variant="outline" onClick={() => setFilters({ status: "", problem_type: "", priority: "", assignee: "" })}>清除</Button>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</div>
      ) : problems.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无问题</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--secondary)]/50">
                <th className="py-3 px-5 text-left text-xs font-medium text-[var(--muted-foreground)]">问题编号</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">公司名</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">问题类型</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">状态</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">负责人</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">紧急程度</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">截止日期</th>
              </tr>
            </thead>
            <tbody>
              {problems.map((p) => {
                const dl = deadlineState(p.deadline, p.status);
                return (
                <tr key={p.id} className={cn("border-b border-[var(--border)]", p.priority === "紧急" && "bg-red-50/60 dark:bg-red-950/20")}>
                  <td className="py-3 px-5 font-mono font-medium">
                    <Link href={`/problems/${p.id}`} className="text-[var(--primary)] hover:underline">{p.problem_number}</Link>
                  </td>
                  <td className="py-3 px-4 text-[var(--foreground)]">{p.company_name}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)]">{p.problem_type}</td>
                  <td className="py-3 px-4">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASS[p.status] || "bg-[var(--muted)] text-[var(--muted-foreground)]")}>{p.status}</span>
                  </td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)]">{p.assignee || "—"}</td>
                  <td className="py-3 px-4">
                    {p.priority === "紧急" ? (
                      <span className="inline-flex rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">紧急</span>
                    ) : p.priority === "不急" ? (
                      <span className="text-xs text-[var(--muted-foreground)]">不急</span>
                    ) : (
                      <span className="text-xs text-[var(--muted-foreground)]">普通</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {p.deadline ? (
                      <span className={cn(
                        "text-xs",
                        dl === "overdue" && "font-medium text-red-600 dark:text-red-400",
                        dl === "soon" && "font-medium text-amber-600 dark:text-amber-400"
                      )}>
                        {dl === "overdue" ? "已超期 " : ""}{p.deadline}
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--muted-foreground)]">—</span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 新建问题弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!saving) setShowForm(false); }}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">新建问题</h3>
              <button onClick={() => setShowForm(false)} disabled={saving} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mt-4 space-y-4">
              {/* 公司名：客户池下拉 + 手动输入 */}
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">公司名 <span className="text-red-500">*</span></label>
                <input
                  list="customer-names"
                  value={form.company_name}
                  onChange={(e) => setField("company_name", e.target.value)}
                  placeholder="从客户池选择，或手动输入"
                  className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
                <datalist id="customer-names">
                  {customers.map((c) => <option key={c.id} value={c.company_name} />)}
                </datalist>
              </div>

              {/* 问题描述 */}
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">问题描述 <span className="text-red-500">*</span></label>
                <textarea
                  value={form.description}
                  onChange={(e) => setField("description", e.target.value)}
                  rows={3}
                  placeholder="描述问题情况"
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
              </div>

              {/* 问题类型 */}
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">问题类型 <span className="text-red-500">*</span></label>
                <select value={form.problem_type} onChange={(e) => setField("problem_type", e.target.value)} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]">
                  {PROBLEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* 来源 */}
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">来源 <span className="text-red-500">*</span></label>
                <select value={form.source} onChange={(e) => setField("source", e.target.value)} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]">
                  {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* 客户需求（选填） */}
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">客户需求（选填）</label>
                <textarea
                  value={form.customer_requirement}
                  onChange={(e) => setField("customer_requirement", e.target.value)}
                  rows={2}
                  placeholder="客户有什么具体需求"
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
              </div>

              {/* 负责人 */}
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">负责人 <span className="text-red-500">*</span></label>
                <select value={form.assignee} onChange={(e) => setField("assignee", e.target.value)} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]">
                  <option value="">请选择负责人</option>
                  {employees.map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
                </select>
              </div>

              {/* 紧急程度 */}
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">紧急程度</label>
                <select value={form.priority} onChange={(e) => setField("priority", e.target.value)} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]">
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              {/* 截止日期（选填） */}
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">截止日期（选填）</label>
                <input type="date" value={form.deadline} onChange={(e) => setField("deadline", e.target.value)} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
              </div>

              {err && <p className="rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-3 py-2 text-xs text-[var(--destructive)]">{err}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={saving}>取消</Button>
                <Button size="sm" onClick={handleSubmit} disabled={saving}>{saving ? "提交中…" : "提交"}</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
