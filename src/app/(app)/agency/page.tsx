"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Users, FileSignature, TrendingUp, Search, FlaskConical, PackageCheck, Send, UserPlus, Star, PenLine, Calendar, Filter, ChevronDown, ExternalLink, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchWithAuth } from "@/lib/api";

const STAFF = [
  { id: "ploy", label: "Ploy" },
  { id: "yuanli", label: "元丽" },
  { id: "pare", label: "Prae" },
  { id: "namcha", label: "Namcha" },
];
const STAFF_LABELS: Record<string, string> = Object.fromEntries(STAFF.map(s => [s.id, s.label]));

interface StaffRow {
  name: string; tasks: number; influencers: number; evaluations: number; contracts: number;
}

interface DashboardData {
  pipelineCounts: { discovery: number; completed_discovery: number; contract: number; incubation: number; completed_incubation: number };
  periodStats: { tasks: number; influencers: number; evaluations: number; contracts: number };
  comparison: { tasks: number; influencers: number; evaluations: number; contracts: number };
  overdueContracts: { id: number; created_at: string; payment_status: string; influencer_id: number; influencer_name: string }[];
  recentEvaluations: { id: number; rating: string; created_at: string; influencer_id: number; influencer_name: string; category: string }[];
  staffWorkload: StaffRow[];
}

interface StatsData {
  categories: { category: string; c: number }[];
}

const categoryColors = [
  "bg-pink-500", "bg-blue-500", "bg-amber-500", "bg-emerald-500",
  "bg-purple-500", "bg-cyan-500", "bg-rose-500", "bg-indigo-500",
];

const ratingColor = (r: string) => {
  const base = (r || "").replace("+", "");
  const map: Record<string, string> = { A: "bg-emerald-500", B: "bg-blue-500", C: "bg-amber-500", D: "bg-red-500" };
  return map[base] || "bg-slate-400";
};

const staffColors: Record<string, string> = {
  "ploy": "border-l-pink-400", "yuanli": "border-l-amber-400",
  "pare": "border-l-blue-400", "namcha": "border-l-emerald-400",
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z')).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return `${Math.floor(days / 30)}月前`;
}

function deltaStr(current: number, prev: number) {
  const d = current - prev;
  if (d > 0) return `↑${d}`;
  if (d < 0) return `↓${Math.abs(d)}`;
  return "—";
}

function deltaColor(current: number, prev: number) {
  if (current > prev) return "text-emerald-600 dark:text-emerald-400";
  if (current < prev) return "text-red-500";
  return "text-[var(--muted-foreground)]";
}

const quickRanges: { label: string; days: number | null }[] = [
  { label: "今天", days: 0 },
  { label: "最近 7 天", days: 7 },
  { label: "最近 30 天", days: 30 },
];

function formatDate(d: Date) {
  return d.toISOString().split("T")[0];
}

export default function AgencyPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);

  // ── Filters ──
  const [quickDays, setQuickDays] = useState<number | null>(7);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [employee, setEmployee] = useState("");

  const [wlModal, setWlModal] = useState<{ name: string; type: string; label: string } | null>(null);
  const [wlData, setWlData] = useState<any[]>([]);
  const [wlLoading, setWlLoading] = useState(false);
  const [wlErr, setWlErr] = useState<string | null>(null);
  const handleWlDetail = async (name: string, type: string, label: string) => {
    setWlModal({ name, type, label });
    setWlLoading(true);
    setWlData([]);
    setWlErr(null);
    try {
      let url = "/api/agency/workload-details?employee=" + encodeURIComponent(name) + "&type=" + type;
      // 传递当前日期筛选条件
      if (quickDays === 0) {
        const today = formatDate(new Date(Date.now() + 7*60*60*1000));
        url += "&from=" + today + "&to=" + today;
      } else if (quickDays != null) {
        const end = new Date(Date.now() + 7*60*60*1000);
        const start = new Date(end.getTime() - (quickDays - 1) * 86400000);
        url += "&from=" + formatDate(start) + "&to=" + formatDate(end);
      } else if (showCustom && customFrom) {
        url += "&from=" + customFrom + "&to=" + (customTo || customFrom);
      }
      const res = await fetchWithAuth(url, { cache: "no-store" });
      if (!res.ok) {
        setWlErr("请求失败(" + res.status + ")");
        return;
      }
      const json = await res.json();
      setWlData(json.data || []);
    } catch (e: any) {
      setWlErr(e?.message === "NO_TOKEN" ? "登录过期" : "网络错误");
    } finally {
      setWlLoading(false);
    }
  };

  useEffect(() => {
    // Compute date range
    let from = "", to = "";
    if (showCustom && customFrom) {
      from = customFrom;
      to = customTo || customFrom;
    } else if (quickDays === 0) {
      from = to = formatDate(new Date(Date.now() + 7*60*60*1000));
    } else if (quickDays != null) {
      const end = new Date(Date.now() + 7*60*60*1000);
      const start = new Date(end.getTime() - (quickDays - 1) * 86400000);
      from = formatDate(start);
      to = formatDate(end);
    }

    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (employee) params.set("employee", employee);

    fetchWithAuth(`/api/agency/dashboard?${params.toString()}`, { cache: "no-store" })
      .then(r => r.json()).then(setData).catch(() => {});
  }, [quickDays, showCustom, customFrom, customTo, employee]);

  useEffect(() => {
    fetchWithAuth("/api/agency/stats", { cache: "no-store" })
      .then(r => r.json()).then(setStats).catch(() => {});
  }, []);

  const maxCat = stats?.categories[0]?.c || 1;
  const { pipelineCounts: pc } = data || { pipelineCounts: { discovery: 0, completed_discovery: 0, contract: 0, incubation: 0, completed_incubation: 0 } };
  const ps = data?.periodStats || { tasks: 0, influencers: 0, evaluations: 0, contracts: 0 };
  const cmp = data?.comparison || { tasks: 0, influencers: 0, evaluations: 0, contracts: 0 };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">机构管理</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">达人孵化 · 签约跟进 · 品牌孵化</p>
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick date ranges */}
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted),var(--background)_60%)] p-0.5">
            {quickRanges.map(r => (
              <button
                key={r.label}
                onClick={() => { setQuickDays(r.days); setShowCustom(false); }}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  quickDays === r.days && !showCustom
                    ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                )}
              >
                {r.label}
              </button>
            ))}
            <button
              onClick={() => { setShowCustom(true); setQuickDays(null); }}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1",
                showCustom
                  ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              )}
            >
              <Calendar className="size-3" />自定义
            </button>
          </div>

          {showCustom && (
            <div className="flex items-center gap-1.5 text-xs">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                className="h-8 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--ring)]" />
              <span className="text-[var(--muted-foreground)]">至</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                className="h-8 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--ring)]" />
            </div>
          )}

          {/* Employee filter */}
          <div className="relative">
            <select
              value={employee}
              onChange={e => setEmployee(e.target.value)}
              className="appearance-none h-8 rounded border border-[var(--border)] bg-[var(--background)] pl-3 pr-7 text-xs outline-none focus:border-[var(--ring)] cursor-pointer"
            >
              <option value="">全部成员</option>
              {STAFF.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-3 pointer-events-none text-[var(--muted-foreground)]" />
          </div>
        </div>
      </div>

      {/* ── Phase pipeline (always total) ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Link href="/agency/influencers" className="rounded-xl border border-pink-200 dark:border-pink-800 bg-pink-50/40 dark:bg-pink-950/20 p-4 transition-all hover:shadow-md hover:border-pink-300">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-pink-500" />
            <p className="text-xs text-[var(--muted-foreground)]">达人发现</p>
          </div>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-pink-600 dark:text-pink-400">{pc.discovery}</p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">进行中</p>
        </Link>

        <Link href="/agency/influencers?tab=evaluating" className="rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/40 dark:bg-purple-950/20 p-4 transition-all hover:shadow-md hover:border-purple-300">
          <div className="flex items-center gap-2">
            <Search className="size-4 text-purple-500" />
            <p className="text-xs text-[var(--muted-foreground)]">已入池</p>
          </div>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-purple-600 dark:text-purple-400">{pc.completed_discovery}</p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">待签约/孵化</p>
        </Link>

        <Link href="/agency/contracts" className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 p-4 transition-all hover:shadow-md hover:border-blue-300">
          <div className="flex items-center gap-2">
            <FileSignature className="size-4 text-blue-500" />
            <p className="text-xs text-[var(--muted-foreground)]">签约中</p>
          </div>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-blue-600 dark:text-blue-400">{pc.contract}</p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">进行中</p>
        </Link>

        <Link href="/agency/incubation" className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 p-4 transition-all hover:shadow-md hover:border-amber-300">
          <div className="flex items-center gap-2">
            <FlaskConical className="size-4 text-amber-500" />
            <p className="text-xs text-[var(--muted-foreground)]">品牌孵化</p>
          </div>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">{pc.incubation}</p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">进行中</p>
        </Link>

        <Link href="/agency/incubation?tab=completed" className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 transition-all hover:shadow-md hover:border-emerald-300">
          <div className="flex items-center gap-2">
            <PackageCheck className="size-4 text-emerald-500" />
            <p className="text-xs text-[var(--muted-foreground)]">已完成</p>
          </div>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{pc.completed_incubation}</p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">孵化完成</p>
        </Link>
      </div>

      {/* ── Period workload totals ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "发现任务", value: ps.tasks, prev: cmp.tasks, icon: PenLine, color: "pink" },
          { label: "新收录达人", value: ps.influencers, prev: cmp.influencers, icon: UserPlus, color: "blue" },
          { label: "完成评估", value: ps.evaluations, prev: cmp.evaluations, icon: Star, color: "amber" },
          { label: "签订合同", value: ps.contracts, prev: cmp.contracts, icon: FileSignature, color: "emerald" },
        ].map(stat => (
          <div key={stat.label} className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="text-xs text-[var(--muted-foreground)]">{stat.label}</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-[var(--foreground)]">{stat.value}</span>
              <span className={cn("text-xs font-medium", deltaColor(stat.value, stat.prev))}>
                {deltaStr(stat.value, stat.prev)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">前一周期 {stat.prev}</p>
          </div>
        ))}
      </div>

      {/* ── Staff workload breakdown ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium text-[var(--foreground)] flex items-center gap-2">
            <Users className="size-4 text-[var(--muted-foreground)]" />
            团队成员工作量
            {employee && <span className="text-xs text-[var(--muted-foreground)] ml-1">（已筛选: {employee}）</span>}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-2.5 px-5 text-left text-xs font-medium text-[var(--muted-foreground)]">成员</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium text-[var(--muted-foreground)]">发现任务</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium text-[var(--muted-foreground)]">收录达人</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium text-[var(--muted-foreground)]">完成评估</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium text-[var(--muted-foreground)]">签订合同</th>
              </tr>
            </thead>
            <tbody>
              {(data?.staffWorkload || []).map((row: StaffRow) => (
                <tr key={row.name} className={cn(
                  "border-b border-[var(--border)] hover:bg-[var(--secondary)] transition-colors border-l-2",
                  staffColors[row.name] || "border-l-transparent",
                  employee && employee !== row.name && "opacity-40"
                )}>
                  <td className="py-2.5 px-5 font-medium text-[var(--foreground)]">{STAFF_LABELS[row.name] || row.name}</td>
                  <td className="py-2.5 px-4 text-center tabular-nums">
                    {row.tasks > 0 ? (
                      <button onClick={() => handleWlDetail(row.name, "tasks", row.name + " 的发现任务")} className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer">
                        {row.tasks}<ExternalLink className="size-2.5 opacity-60" />
                      </button>
                    ) : "0"}
                  </td>
                  <td className="py-2.5 px-4 text-center tabular-nums">
                    {row.influencers > 0 ? (
                      <button onClick={() => handleWlDetail(row.name, "influencers", row.name + " 的收录达人")} className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer">
                        {row.influencers}<ExternalLink className="size-2.5 opacity-60" />
                      </button>
                    ) : "0"}
                  </td>
                  <td className="py-2.5 px-4 text-center tabular-nums">
                    {row.evaluations > 0 ? (
                      <button onClick={() => handleWlDetail(row.name, "evaluations", row.name + " 的完成评估")} className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer">
                        {row.evaluations}<ExternalLink className="size-2.5 opacity-60" />
                      </button>
                    ) : "0"}
                  </td>
                  <td className="py-2.5 px-4 text-center tabular-nums">
                    {row.contracts > 0 ? (
                      <button onClick={() => handleWlDetail(row.name, "contracts", row.name + " 的签订合同")} className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer">
                        {row.contracts}<ExternalLink className="size-2.5 opacity-60" />
                      </button>
                    ) : "0"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Overdue contracts + Recent evaluations ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 签约超时提醒 */}
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/10 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-red-700 dark:text-red-400 flex items-center gap-2">
              <Calendar className="size-4" />签约超时提醒
            </h2>
          </div>
          {data && data.overdueContracts.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] mt-4 text-center py-4">暂无超时合同</p>
          ) : (
            <div className="mt-3 space-y-2 max-h-[260px] overflow-y-auto">
              {data?.overdueContracts?.map((c) => (
                <Link
                  key={c.id}
                  href={`/agency/influencers/${c.influencer_id}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-red-200 dark:border-red-800 bg-[var(--background)] hover:bg-red-50 dark:hover:bg-red-950/30 text-sm transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{c.influencer_name}</div>
                    <div className="text-xs text-[var(--muted-foreground)]">
                      {c.payment_status} · 创建于 {c.created_at?.split("T")[0]}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700">
                    {Math.floor((Date.now() - new Date(c.created_at + (c.created_at.includes('Z') ? '' : 'Z')).getTime()) / 86400000)}天
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* 最近评估 */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-4">最近评估结果</h2>
          {data && data.recentEvaluations.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] py-4 text-center">暂无评估记录</p>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {data?.recentEvaluations?.map((e) => (
                <Link
                  key={e.id}
                  href={`/agency/influencers/${e.influencer_id}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] hover:bg-[var(--accent)]/5 text-sm transition-all"
                >
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${ratingColor(e.rating)}`}>
                    {e.rating}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{e.influencer_name}</div>
                    <div className="text-xs text-[var(--muted-foreground)]">
                      {e.category || "未分类"} · {timeAgo(e.created_at)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 品类分布 + 快捷入口 ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 lg:col-span-2">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="size-4 text-[var(--muted-foreground)]" />
            品类分布
          </h3>
          {stats && stats.categories.length > 0 ? (
            <div className="mt-4 space-y-3">
              {stats.categories.map((cat, i) => (
                <div key={cat.category} className="flex items-center gap-3">
                  <span className="w-20 text-xs text-[var(--muted-foreground)] truncate">{cat.category}</span>
                  <div className="flex-1 h-5 rounded-full bg-[var(--muted)] overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", categoryColors[i % categoryColors.length])}
                      style={{ width: `${Math.round((cat.c / maxCat) * 100)}%` }} />
                  </div>
                  <span className="w-8 text-right text-xs font-medium tabular-nums text-[var(--foreground)]">{cat.c}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--muted-foreground)]">暂无品类数据</p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <Link href="/agency/influencers/tasks" className="group flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 transition-all hover:shadow-md hover:border-[var(--ring)]">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 to-rose-500">
              <Search className="size-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)]">达人发现</p>
              <p className="text-xs text-[var(--muted-foreground)] truncate">创建任务、收录达人、提交评估</p>
            </div>
          </Link>

          <Link href="/agency/contracts" className="group flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 transition-all hover:shadow-md hover:border-[var(--ring)]">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500">
              <FileSignature className="size-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)]">签约跟进</p>
              <p className="text-xs text-[var(--muted-foreground)] truncate">签约9步流程、合同佣金管理</p>
            </div>
          </Link>

          <Link href="/agency/incubation" className="group flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 transition-all hover:shadow-md hover:border-[var(--ring)]">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-500">
              <FlaskConical className="size-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)]">品牌孵化</p>
              <p className="text-xs text-[var(--muted-foreground)] truncate">孵化5步流程、工厂对接跟踪</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
