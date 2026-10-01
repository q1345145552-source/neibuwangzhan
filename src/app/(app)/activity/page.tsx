"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchWithAuth } from "@/lib/api";
import { cn, toThaiTime } from "@/lib/utils";
import { Activity, Users, Zap, Trophy } from "lucide-react";

interface TimelineItem {
  id: number;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  created_at: string;
}

interface ActivityStats {
  today: string;
  total: number;
  active: number;
  ranking: { actor: string; count: number }[];
  categories: string[];
  timeline: TimelineItem[];
}

const CATEGORY_LABELS: Record<string, string> = {
  step: "订单步骤",
  document: "文档",
  order: "订单",
  finance: "费用",
  certificate: "证书",
  todo: "待办",
  employee: "员工",
  problem: "问题",
  influencer: "达人",
};

const RANGES = [
  { key: "today", label: "今天" },
  { key: "7d", label: "最近七天" },
  { key: "30d", label: "最近三十天" },
];

const rankColor = (i: number) => {
  if (i === 0) return "text-amber-500";
  if (i === 1) return "text-slate-400";
  if (i === 2) return "text-orange-400";
  return "text-[var(--muted-foreground)]";
};

export default function ActivityPage() {
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("today");
  const [employee, setEmployee] = useState("");
  const [category, setCategory] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    q.set("range", range);
    if (employee) q.set("employee", employee);
    if (category) q.set("category", category);
    fetchWithAuth(`/api/activity/stats?${q.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setStats(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [range, employee, category]);

  useEffect(() => { load(); }, [load]);

  const maxCount = Math.max(1, ...(stats?.ranking.map((r) => r.count) || [1]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">员工动态</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">全系统操作统计与时间线</p>
      </div>

      {/* 时间范围切换 */}
      <div className="flex w-fit gap-1 rounded-lg bg-[var(--muted)] p-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => { setRange(r.key); setEmployee(""); setCategory(""); }}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
              range === r.key ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</div>
      ) : !stats ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无数据</div>
      ) : (
        <>
          {/* 统计卡片 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-blue-500" />
                <span className="text-xs text-[var(--muted-foreground)]">总操作数</span>
              </div>
              <p className="mt-2 font-display text-3xl font-light tabular-nums text-[var(--foreground)]">{stats.total}</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="flex items-center gap-2">
                <Users className="size-4 text-emerald-500" />
                <span className="text-xs text-[var(--muted-foreground)]">活跃员工数</span>
              </div>
              <p className="mt-2 font-display text-3xl font-light tabular-nums text-[var(--foreground)]">{stats.active}</p>
            </div>
          </div>

          {/* 员工操作量排行 */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
              <Activity className="size-4 text-[var(--muted-foreground)]" />
              员工操作量排行
            </h2>
            {stats.ranking.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">该时间段还没有操作记录</p>
            ) : (
              <div className="mt-4 space-y-2">
                {stats.ranking.map((r, i) => (
                  <div key={r.actor} className="flex items-center gap-3">
                    <span className={cn("w-6 text-center text-sm font-semibold", rankColor(i))}>
                      {i === 0 ? <Trophy className="mx-auto size-4" /> : i + 1}
                    </span>
                    <span className="w-20 truncate text-sm text-[var(--foreground)]">{r.actor}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--muted)]">
                      <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.round((r.count / maxCount) * 100)}%` }} />
                    </div>
                    <span className="w-10 text-right text-sm tabular-nums text-[var(--foreground)]">{r.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 时间线 + 筛选 */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
              <Activity className="size-4 text-[var(--muted-foreground)]" />
              操作时间线
            </h2>

            {/* 筛选 */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={employee}
                onChange={(e) => setEmployee(e.target.value)}
                className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
              >
                <option value="">全部员工</option>
                {stats.ranking.map((r) => <option key={r.actor} value={r.actor}>{r.actor}</option>)}
              </select>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
              >
                <option value="">全部分类</option>
                {stats.categories.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
              </select>
              {(employee || category) && (
                <button onClick={() => { setEmployee(""); setCategory(""); }} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">清除筛选</button>
              )}
            </div>

            {/* 时间线列表 */}
            {stats.timeline.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无操作记录</p>
            ) : (
              <div className="mt-4 space-y-1">
                {stats.timeline.map((t) => (
                  <div key={t.id} className="flex items-start gap-3 border-b border-[var(--border)] py-2 last:border-0">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--muted)] text-xs font-medium text-[var(--foreground)]">
                      {t.actor.charAt(0)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--foreground)]">{t.actor}</span>
                        <span className="inline-flex rounded-full bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] px-2 py-0.5 text-[0.65rem] text-[var(--primary)]">
                          {CATEGORY_LABELS[t.target_type] || t.target_type}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-[var(--foreground)]">{t.action}</p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{toThaiTime(t.created_at) || "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
