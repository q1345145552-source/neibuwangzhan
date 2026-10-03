"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";
import { cn, toThaiTime } from "@/lib/utils";
import { Users, Zap, X, Activity, ChevronRight } from "lucide-react";

interface ActivityStats {
  today: string;
  total: number;
  active: number;
  employees: { name: string; count: number; yesterday: number; types: Record<string, number>; lastActiveDate: string | null; inactive: boolean }[];
}

interface TimelineItem {
  id: number;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: string;
  href: string;
  parent_label: string;
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

// 折线图（每日操作数），员工详情与全公司总览共用
function TrendChart({ points }: { points: { date: string; count: number }[] }) {
  if (points.length === 0) return null;
  const maxCount = Math.max(1, ...points.map((p) => p.count));
  const padX = 8, padY = 12;
  const w = 600, h = 160;
  const stepX = (w - padX * 2) / (points.length - 1 || 1);
  const x = (i: number) => padX + i * stepX;
  const y = (c: number) => h - padY - (c / maxCount) * (h - padY * 2);
  const pts = points.map((p, i) => `${x(i)},${y(p.count)}`).join(" ");
  return (
    <>
      <svg viewBox="0 0 600 160" className="w-full" preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.count)} r="3" fill="var(--primary)" />
            {p.count > 0 && <text x={x(i)} y={y(p.count) - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{p.count}</text>}
          </g>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[0.6rem] text-[var(--muted-foreground)]">
        <span>{points[0]?.date?.slice(5)}</span>
        <span>{points[points.length - 1]?.date?.slice(5)}</span>
      </div>
    </>
  );
}

export default function ActivityPage() {
  const router = useRouter();
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("today");

  const [detailName, setDetailName] = useState<string | null>(null);
  const [detailTimeline, setDetailTimeline] = useState<TimelineItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailCategory, setDetailCategory] = useState("");
  const [trendPoints, setTrendPoints] = useState<{ date: string; count: number }[]>([]);
  const [trendDays, setTrendDays] = useState<7 | 30>(7);

  const [companyTrend, setCompanyTrend] = useState<{ date: string; count: number }[]>([]);
  const [companyTrendDays, setCompanyTrendDays] = useState<7 | 30>(7);
  const [companyTrendLoading, setCompanyTrendLoading] = useState(true);

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

  // 全公司活跃总览（独立于上方范围筛选，默认 7 天）
  const loadCompanyTrend = useCallback((days: 7 | 30) => {
    setCompanyTrendLoading(true);
    fetchWithAuth(`/api/activity/company-trend?days=${days}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setCompanyTrend(Array.isArray(d.points) ? d.points : []); })
      .catch(() => {})
      .finally(() => setCompanyTrendLoading(false));
  }, []);

  useEffect(() => { loadCompanyTrend(7); }, [loadCompanyTrend]);

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

      {/* 全公司活跃总览趋势（独立于上方范围筛选） */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-blue-500" />
            <span className="text-sm font-medium text-[var(--foreground)]">全公司活跃趋势</span>
            <span className="text-xs text-[var(--muted-foreground)]">每天总操作数</span>
          </div>
          <div className="flex gap-1">
            {([7, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => { setCompanyTrendDays(d); loadCompanyTrend(d); }}
                className={cn(
                  "rounded px-2 py-0.5 text-xs transition-colors",
                  companyTrendDays === d ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                )}
              >
                {d}天
              </button>
            ))}
          </div>
        </div>
        {companyTrendLoading ? (
          <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">加载中…</p>
        ) : companyTrend.length === 0 ? (
          <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">暂无数据</p>
        ) : (
          <TrendChart points={companyTrend} />
        )}
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
                      e.inactive
                        ? "border-red-500/60 bg-red-500/10"
                        : e.count > 0
                          ? "border-[var(--border)] bg-[var(--card)]"
                          : "border-[var(--border)] bg-[var(--muted)]/30 opacity-70"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">{e.name}</p>
                      <div className="flex shrink-0 items-center gap-1">
                        {e.inactive && (
                          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[0.65rem] font-medium text-red-600 dark:text-red-400">
                            最近不活跃
                          </span>
                        )}
                        {up && <span className="text-xs font-medium text-emerald-600">↑</span>}
                        {down && <span className="text-xs font-medium text-red-500">↓</span>}
                      </div>
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <p className={cn("font-display text-3xl font-light tabular-nums", e.count > 0 ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]")}>{e.count}</p>
                      <span className="text-xs text-[var(--muted-foreground)]">昨天 {e.yesterday}</span>
                    </div>
                    {e.inactive && (
                      <p className="mt-1 text-xs text-red-500 dark:text-red-400">
                        {e.lastActiveDate ? `最近活跃 ${e.lastActiveDate}` : "从未有操作记录"}
                      </p>
                    )}
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
                <TrendChart points={trendPoints} />
              ) : (
                <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">加载中…</p>
              )}
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
                {filteredTimeline.map((t) => {
                  const canJump = !!t.href;
                  return (
                    <button
                      key={t.id}
                      onClick={() => { if (t.href) router.push(t.href); }}
                      disabled={!canJump}
                      className={cn(
                        "w-full rounded-md border border-[var(--border)] px-3 py-2 text-left transition-colors",
                        canJump ? "hover:border-[var(--primary)] hover:bg-[var(--muted)]/40" : "cursor-default"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex rounded-full bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] px-2 py-0.5 text-[0.65rem] text-[var(--primary)]">
                          {CATEGORY_LABELS[t.target_type] || t.target_type}
                        </span>
                        <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{toThaiTime(t.created_at) || "—"}</span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--foreground)]">{t.action}</p>
                      {t.parent_label && (
                        <p className="mt-0.5 text-xs font-medium text-[var(--primary)]">{t.parent_label}</p>
                      )}
                      {t.detail && (
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-[var(--muted-foreground)]">{t.detail}</p>
                      )}
                      {canJump && (
                        <span className="mt-1 inline-flex items-center gap-0.5 text-[0.65rem] text-[var(--muted-foreground)]">
                          查看详情 <ChevronRight className="size-3" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
