"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Users, FileSignature, Sparkles, TrendingUp, AlertCircle, Clock, Search, FlaskConical, PackageCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface Stats {
  total: number; aRated: number; newThisMonth: number;
  discoveryCount: number; poolCount: number; contractingCount: number;
  incubatingCount: number; completedCount: number;
  overdue2d: number; overdue5d: number;
  categories: { category: string; c: number }[];
}

const phaseLabelMap: Record<string, string> = {
  discovery: "达人发现",
  completed_discovery: "已入池",
  contract: "签约中",
  completed_contract: "签约完成",
  incubation: "孵化中",
  completed_incubation: "已完成",
};

const categoryColors = [
  "bg-pink-500", "bg-blue-500", "bg-amber-500", "bg-emerald-500",
  "bg-purple-500", "bg-cyan-500", "bg-rose-500", "bg-indigo-500",
];

export default function AgencyPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/agency/stats", { cache: "no-store" })
      .then(r => r.json()).then(setStats).catch(() => {});
  }, []);

  const maxCat = stats?.categories[0]?.c || 1;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">机构管理</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">达人孵化 · 签约跟进 · 品牌孵化</p>
      </div>

      {/* Overdue alerts */}
      {stats && (stats.overdue2d > 0 || stats.overdue5d > 0) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3">
          <AlertCircle className="size-4 text-amber-500 shrink-0" />
          <span className="text-sm text-[var(--foreground)]">
            {stats.overdue5d > 0 && (
              <Link href="/agency/contracts?overdue=5" className="font-medium text-red-600 hover:underline">
                {stats.overdue5d} 个已超时
              </Link>
            )}
            {stats.overdue5d > 0 && stats.overdue2d > 0 && <span className="mx-1">·</span>}
            {stats.overdue2d > 0 && (
              <Link href="/agency/contracts?overdue=2" className="font-medium text-amber-600 hover:underline">
                {stats.overdue2d} 个需跟进
              </Link>
            )}
          </span>
          <span className="text-xs text-[var(--muted-foreground)]">签约超时提醒</span>
        </div>
      )}

      {/* Phase pipeline cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Link href="/agency/influencers" className="rounded-xl border border-pink-200 dark:border-pink-800 bg-pink-50/40 dark:bg-pink-950/20 p-4 transition-all hover:shadow-md hover:border-pink-300">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-pink-500" />
              <p className="text-xs text-[var(--muted-foreground)]">达人发现</p>
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-pink-600 dark:text-pink-400">
              {stats.discoveryCount ?? 0}
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">进行中</p>
          </Link>

          <Link href="/agency/influencers?tab=evaluating" className="rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/40 dark:bg-purple-950/20 p-4 transition-all hover:shadow-md hover:border-purple-300">
            <div className="flex items-center gap-2">
              <Search className="size-4 text-purple-500" />
              <p className="text-xs text-[var(--muted-foreground)]">已入池</p>
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-purple-600 dark:text-purple-400">
              {stats.poolCount ?? 0}
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">待签约/孵化</p>
          </Link>

          <Link href="/agency/contracts" className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 p-4 transition-all hover:shadow-md hover:border-blue-300">
            <div className="flex items-center gap-2">
              <FileSignature className="size-4 text-blue-500" />
              <p className="text-xs text-[var(--muted-foreground)]">签约中</p>
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-blue-600 dark:text-blue-400">
              {stats.contractingCount ?? 0}
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">9步流程中</p>
          </Link>

          <Link href="/agency/incubation" className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 p-4 transition-all hover:shadow-md hover:border-amber-300">
            <div className="flex items-center gap-2">
              <FlaskConical className="size-4 text-amber-500" />
              <p className="text-xs text-[var(--muted-foreground)]">品牌孵化</p>
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
              {stats.incubatingCount ?? 0}
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">5步流程中</p>
          </Link>

          <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50/40 dark:bg-green-950/20 p-4">
            <div className="flex items-center gap-2">
              <PackageCheck className="size-4 text-green-500" />
              <p className="text-xs text-[var(--muted-foreground)]">已完成</p>
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-green-600 dark:text-green-400">
              {stats.completedCount ?? 0}
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">孵化完成</p>
          </div>
        </div>
      )}

      {/* Category + Entry cards */}
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
