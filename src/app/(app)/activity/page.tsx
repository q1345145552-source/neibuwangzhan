"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchWithAuth } from "@/lib/api";
import { cn, toThaiTime } from "@/lib/utils";
import { Users, Zap, X } from "lucide-react";

interface ActivityStats {
  today: string;
  total: number;
  active: number;
  employees: { name: string; count: number; yesterday: number; types: Record<string, number> }[];
}

interface TimelineItem {
  id: number;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  created_at: string;
}

const RANGES = [
  { key: "today", label: "今天" },
  { key: "yesterday", label: "昨天" },
  { key: "7d", label: "最近七天" },
  { key: "30d", label: "最近三十天" },
];

const TYPE_ORDER = ["订单更新", "待办跟进", "问题处理", "打卡", "请假"];

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
  issue: "工单",
  customer: "客户",
  logistics: "物流",
  logistics_step: "物流步骤",
  points: "积分",
  attendance: "考勤",
  attendance_request: "补签",
  leave: "请假",
  project: "项目",
};

export default function ActivityPage() {
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("today");

  const [detailName, setDetailName] = useState<string | null>(null);
  const [detailTimeline, setDetailTimeline] = useState<TimelineItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailCategory, setDetailCategory] = useState("");
  const [trendPoints, setTrendPoints] = useState<{ date: string; count: number }[]>([]);
  const [trendDays, setTrendDays] = useState<7 | 30>(7);

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

  // 点卡片：拉该员工的操作记录（倒序）+ 趋势数据
  const openDetail = (name: string) => {
    setDetailName(name);
    setDetailCategory("");
    setDetailTimeline([]);
    setDetailLoading(true);
    setTrendDays(7);
    setTrendPoints([]);
    const q = new URLSearchParams();
    q.set("range", range);
    q.set("employee", name);
    fetchWithAuth(`/api/activity/stats?${q.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setDetailTimeline(Array.isArray(d.timeline) ? d.timeline : []); })
      .catch(() => {})
      .finally(() => setDetailLoading(false));
    loadTrend(name, 7);
  };

  const loadTrend = (name: string, days: 7 | 30) => {
    fetchWithAuth(`/api/activity/trend?employee=${encodeURIComponent(name)}&days=${days}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setTrendPoints(Array.isArray(d.points) ? d.points : []); })
      .catch(() => {});
  };

  const detailCategories = Array.from(new Set(detailTimeline.map((t) => t.target_type).filter(Boolean)));
  const filteredTimeline = detailCategory ? detailTimeline.filter((t) => t.target_type === detailCategory) : detailTimeline;

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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {stats.employees.map((e) => {
                const up = e.count > e.yesterday;
                const down = e.count < e.yesterday;
                return (
                  <button
                    key={e.name}
                    onClick={() => openDetail(e.name)}
                    className={cn(
                      "rounded-xl border p-4 text-left transition-colors hover:border-[var(--primary)]",
                      e.count > 0 ? "border-[var(--border)] bg-[var(--card)]" : "border-[var(--border)] bg-[var(--muted)]/30 opacity-70"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">{e.name}</p>
                      {up && <span className="shrink-0 text-xs font-medium text-emerald-600">↑</span>}
                      {down && <span className="shrink-0 text-xs font-medium text-red-500">↓</span>}
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <p className={cn("font-display text-3xl font-light tabular-nums", e.count > 0 ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]")}>{e.count}</p>
                      <span className="text-xs text-[var(--muted-foreground)]">昨天 {e.yesterday}</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {TYPE_ORDER.filter((t) => (e.types[t] || 0) > 0).map((t) => (
                        <div key={t} className="flex items-center justify-between text-xs">
                          <span className="text-[var(--muted-foreground)]">{t}</span>
                          <span className="tabular-nums text-[var(--foreground)]">{e.types[t]}</span>
                        </div>
                      ))}
                      {TYPE_ORDER.every((t) => !(e.types[t] || 0)) && (
                        <p className="text-xs text-[var(--muted-foreground)]">暂无操作</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* 员工详情弹窗 */}
      {detailName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetailName(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">{detailName} 的操作记录</h3>
              <button onClick={() => setDetailName(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            {/* 操作趋势图 */}
            <div className="mb-4 rounded-md border border-[var(--border)] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--muted-foreground)]">操作趋势</span>
                <div className="flex gap-1">
                  {([7, 30] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => { setTrendDays(d); loadTrend(detailName, d); }}
                      className={cn(
                        "rounded px-2 py-0.5 text-xs transition-colors",
                        trendDays === d ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      )}
                    >
                      {d}天
                    </button>
                  ))}
                </div>
              </div>
              {trendPoints.length > 0 ? (
                <svg viewBox="0 0 600 160" className="w-full" preserveAspectRatio="none">
                  {(() => {
                    const maxCount = Math.max(1, ...trendPoints.map((p) => p.count));
                    const padX = 8, padY = 12;
                    const w = 600, h = 160;
                    const stepX = (w - padX * 2) / (trendPoints.length - 1 || 1);
                    const x = (i: number) => padX + i * stepX;
                    const y = (c: number) => h - padY - (c / maxCount) * (h - padY * 2);
                    const pts = trendPoints.map((p, i) => `${x(i)},${y(p.count)}`).join(" ");
                    return (
                      <>
                        <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                        {trendPoints.map((p, i) => (
                          <g key={i}>
                            <circle cx={x(i)} cy={y(p.count)} r="3" fill="var(--primary)" />
                            {p.count > 0 && <text x={x(i)} y={y(p.count) - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{p.count}</text>}
                          </g>
                        ))}
                      </>
                    );
                  })()}
                </svg>
              ) : (
                <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">加载中…</p>
              )}
              <div className="mt-1 flex justify-between text-[0.6rem] text-[var(--muted-foreground)]">
                <span>{trendPoints[0]?.date?.slice(5)}</span>
                <span>{trendPoints[trendPoints.length - 1]?.date?.slice(5)}</span>
              </div>
            </div>

            {/* 分类筛选 */}
            {detailCategories.length > 0 && (
              <div className="mb-3 flex items-center gap-2">
                <span className="text-xs text-[var(--muted-foreground)]">分类</span>
                <select
                  value={detailCategory}
                  onChange={(e) => setDetailCategory(e.target.value)}
                  className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                >
                  <option value="">全部</option>
                  {detailCategories.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
                </select>
              </div>
            )}

            {detailLoading ? (
              <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
            ) : filteredTimeline.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无操作记录</p>
            ) : (
              <div className="space-y-2">
                {filteredTimeline.map((t) => (
                  <div key={t.id} className="rounded-md border border-[var(--border)] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex rounded-full bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] px-2 py-0.5 text-[0.65rem] text-[var(--primary)]">
                        {CATEGORY_LABELS[t.target_type] || t.target_type}
                      </span>
                      <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{toThaiTime(t.created_at) || "—"}</span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--foreground)]">{t.action}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
