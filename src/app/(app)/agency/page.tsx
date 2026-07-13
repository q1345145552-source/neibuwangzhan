"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Users, FileSignature, TrendingUp, Search, FlaskConical, PackageCheck, Send, UserPlus, Star, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchWithAuth } from "@/lib/api";

interface DashboardData {
  pipelineCounts: { discovery: number; completed_discovery: number; contract: number; incubation: number; completed_incubation: number };
  todayStats: { tasks: number; influencers: number; evaluations: number; contracts: number };
  yesterdayStats: { tasks: number; influencers: number; evaluations: number; contracts: number };
  overdueContracts: { id: number; created_at: string; payment_status: string; influencer_id: number; influencer_name: string }[];
  recentEvaluations: { id: number; rating: string; evaluated_at: string; influencer_id: number; influencer_name: string; category: string }[];
}

interface StatsData {
  categories: { category: string; c: number }[];
}

const categoryColors = [
  "bg-pink-500", "bg-blue-500", "bg-amber-500", "bg-emerald-500",
  "bg-purple-500", "bg-cyan-500", "bg-rose-500", "bg-indigo-500",
];

const ratingColor = (r: string) => {
  const map: Record<string, string> = { A: "bg-emerald-500", B: "bg-blue-500", C: "bg-amber-500", D: "bg-red-500" };
  return map[r] || "bg-slate-400";
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return `${Math.floor(days / 30)}月前`;
}

function deltaStr(today: number, yesterday: number) {
  const d = today - yesterday;
  if (d > 0) return `↑${d}`;
  if (d < 0) return `↓${Math.abs(d)}`;
  return "—";
}

function deltaColor(today: number, yesterday: number) {
  if (today > yesterday) return "text-emerald-600 dark:text-emerald-400";
  if (today < yesterday) return "text-red-500";
  return "text-[var(--muted-foreground)]";
}

export default function AgencyPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);

  useEffect(() => {
    fetchWithAuth("/api/agency/dashboard", { cache: "no-store" })
      .then(r => r.json()).then(setData).catch(() => {});
    fetchWithAuth("/api/agency/stats", { cache: "no-store" })
      .then(r => r.json()).then(setStats).catch(() => {});
  }, []);

  const maxCat = stats?.categories[0]?.c || 1;
  const { pipelineCounts: pc } = data || { pipelineCounts: { discovery: 0, completed_discovery: 0, contract: 0, incubation: 0, completed_incubation: 0 } };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">机构管理</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">达人孵化 · 签约跟进 · 品牌孵化</p>
      </div>

      {/* 阶段流水线 */}
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
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">9步流程中</p>
        </Link>

        <Link href="/agency/incubation" className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 p-4 transition-all hover:shadow-md hover:border-amber-300">
          <div className="flex items-center gap-2">
            <FlaskConical className="size-4 text-amber-500" />
            <p className="text-xs text-[var(--muted-foreground)]">品牌孵化</p>
          </div>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">{pc.incubation}</p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">5步流程中</p>
        </Link>

        <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50/40 dark:bg-green-950/20 p-4">
          <div className="flex items-center gap-2">
            <PackageCheck className="size-4 text-green-500" />
            <p className="text-xs text-[var(--muted-foreground)]">已完成</p>
          </div>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-green-600 dark:text-green-400">{pc.completed_incubation}</p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">孵化完成</p>
        </div>
      </div>

      {/* 今日团队工作量 */}
      {data && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-4">今日团队工作量</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-[var(--border)] p-3">
              <div className="flex items-center gap-1.5">
                <Send className="size-3.5 text-[var(--muted-foreground)]" />
                <p className="text-xs text-[var(--muted-foreground)]">发起任务</p>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-xl font-semibold tabular-nums text-[var(--foreground)]">{data.todayStats.tasks}</span>
                <span className={cn("text-xs tabular-nums", deltaColor(data.todayStats.tasks, data.yesterdayStats.tasks))}>
                  较昨日 {deltaStr(data.todayStats.tasks, data.yesterdayStats.tasks)}
                </span>
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border)] p-3">
              <div className="flex items-center gap-1.5">
                <UserPlus className="size-3.5 text-[var(--muted-foreground)]" />
                <p className="text-xs text-[var(--muted-foreground)]">找到达人</p>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-xl font-semibold tabular-nums text-[var(--foreground)]">{data.todayStats.influencers}</span>
                <span className={cn("text-xs tabular-nums", deltaColor(data.todayStats.influencers, data.yesterdayStats.influencers))}>
                  较昨日 {deltaStr(data.todayStats.influencers, data.yesterdayStats.influencers)}
                </span>
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border)] p-3">
              <div className="flex items-center gap-1.5">
                <Star className="size-3.5 text-[var(--muted-foreground)]" />
                <p className="text-xs text-[var(--muted-foreground)]">完成评估</p>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-xl font-semibold tabular-nums text-[var(--foreground)]">{data.todayStats.evaluations}</span>
                <span className={cn("text-xs tabular-nums", deltaColor(data.todayStats.evaluations, data.yesterdayStats.evaluations))}>
                  较昨日 {deltaStr(data.todayStats.evaluations, data.yesterdayStats.evaluations)}
                </span>
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border)] p-3">
              <div className="flex items-center gap-1.5">
                <PenLine className="size-3.5 text-[var(--muted-foreground)]" />
                <p className="text-xs text-[var(--muted-foreground)]">新签合同</p>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-xl font-semibold tabular-nums text-[var(--foreground)]">{data.todayStats.contracts}</span>
                <span className={cn("text-xs tabular-nums", deltaColor(data.todayStats.contracts, data.yesterdayStats.contracts))}>
                  较昨日 {deltaStr(data.todayStats.contracts, data.yesterdayStats.contracts)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 签约超时提醒 + 最近评估结果 */}
      {data && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* 签约超时提醒 */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
            <h2 className="text-sm font-semibold text-[var(--foreground)] mb-4">
              签约超时提醒
              {data.overdueContracts.length > 0 && (
                <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 dark:bg-red-950/30 dark:text-red-400">
                  {data.overdueContracts.length}
                </span>
              )}
            </h2>
            {data.overdueContracts.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)] py-4 text-center">暂无超时合同</p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {data.overdueContracts.map((c) => {
                  const days = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000);
                  const critical = days >= 5;
                  return (
                    <Link
                      key={c.id}
                      href={`/agency/contracts/${c.influencer_id}`}
                      className={`flex items-center gap-3 p-3 rounded-lg border text-sm hover:shadow-sm transition-all ${
                        critical ? "border-red-200 bg-red-50 dark:bg-red-950/20" : "border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20"
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${critical ? "bg-red-500" : "bg-yellow-500"}`}></span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{c.influencer_name}</div>
                        <div className="text-xs text-[var(--muted-foreground)]">
                          {critical ? `已超时 ${days} 天` : `已等待 ${days} 天`}
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                        critical ? "bg-red-200 text-red-700 dark:bg-red-900/40 dark:text-red-300" : "bg-yellow-200 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300"
                      }`}>
                        {critical ? "需处理" : "需跟进"}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* 最近评估结果 */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
            <h2 className="text-sm font-semibold text-[var(--foreground)] mb-4">最近评估结果</h2>
            {data.recentEvaluations.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)] py-4 text-center">暂无评估记录</p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {data.recentEvaluations.map((e) => (
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
                        {e.category || "未分类"} · {timeAgo(e.evaluated_at)}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 品类分布 + 快捷入口 */}
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
