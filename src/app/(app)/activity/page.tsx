"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchWithAuth } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Users, Zap } from "lucide-react";

interface ActivityStats {
  today: string;
  total: number;
  active: number;
  employees: { name: string; count: number }[];
}

const RANGES = [
  { key: "today", label: "今天" },
  { key: "7d", label: "最近七天" },
  { key: "30d", label: "最近三十天" },
];

export default function ActivityPage() {
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("today");

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    q.set("range", range);
    fetchWithAuth(`/api/activity/stats?${q.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setStats(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">员工动态</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">全系统操作统计</p>
      </div>

      {/* 时间范围切换 */}
      <div className="flex w-fit gap-1 rounded-lg bg-[var(--muted)] p-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
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

          {/* 员工卡片矩阵 */}
          <div>
            <h2 className="mb-3 text-sm font-medium text-[var(--foreground)]">员工操作量</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {stats.employees.map((e) => (
                <div
                  key={e.name}
                  className={cn(
                    "rounded-xl border p-4",
                    e.count > 0 ? "border-[var(--border)] bg-[var(--card)]" : "border-[var(--border)] bg-[var(--muted)]/30 opacity-60"
                  )}
                >
                  <p className="truncate text-sm font-medium text-[var(--foreground)]">{e.name}</p>
                  <p className={cn("mt-1 font-display text-3xl font-light tabular-nums", e.count > 0 ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]")}>{e.count}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">次操作</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
