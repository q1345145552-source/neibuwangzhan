"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Users, FileSignature, Factory, TrendingUp, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Stats {
  total: number;
  aRated: number;
  contracting: number;
  signed: number;
  newThisMonth: number;
  overdue2d: number;
  overdue5d: number;
  categories: { category: string; c: number }[];
}

const cards = [
  { title: "达人发现", desc: "创建发现任务、收录达人、提交Ploy评估池", href: "/agency/influencers", icon: Users, color: "from-pink-500 to-rose-500" },
  { title: "签约跟进", desc: "已入池达人签约九步流程，合同佣金付款管理", href: "/agency/contracts", icon: FileSignature, color: "from-blue-500 to-indigo-500" },
  { title: "品牌孵化", desc: "达人品牌孵化五步流程，工厂对接生产跟踪", href: "/agency/incubation", icon: Factory, color: "from-amber-500 to-orange-500" },
];

const statCards = [
  { key: "total", label: "达人总数", href: "/agency/influencers", color: "text-pink-600 dark:text-pink-400", bg: "bg-pink-50 dark:bg-pink-950/30" },
  { key: "aRated", label: "A级达人", href: "/agency/influencers", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30" },
  { key: "contracting", label: "签约中", href: "/agency/contracts", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30" },
  { key: "signed", label: "已签约", href: "/agency/contracts", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
  { key: "newThisMonth", label: "本月新增", href: "/agency/influencers", color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/30" },
];

const categoryColors = [
  "bg-pink-500", "bg-blue-500", "bg-amber-500", "bg-emerald-500",
  "bg-purple-500", "bg-cyan-500", "bg-rose-500", "bg-indigo-500",
];

export default function AgencyPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/agency/stats", { cache: "no-store" })
      .then(r => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  const maxCat = stats?.categories[0]?.c || 1;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">机构管理</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">达人孵化 · 签约跟进 · 供应链工厂</p>
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

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {statCards.map(s => (
            <Link key={s.key} href={s.href} className={cn("rounded-xl border border-[var(--border)] p-4 transition-all hover:shadow-md hover:border-[var(--ring)]", s.bg)}>
              <p className="text-xs text-[var(--muted-foreground)]">{s.label}</p>
              <p className={cn("mt-1 text-2xl font-semibold tabular-nums", s.color)}>
                {String(stats[s.key as keyof Stats] ?? 0)}
              </p>
            </Link>
          ))}
        </div>
      )}

      {/* Category distribution + 3 cards */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Category chart */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 lg:col-span-2">
          <h3 className="text-sm font-medium text-[var(--foreground)] flex items-center gap-2">
            <TrendingUp className="size-4 text-[var(--muted-foreground)]" />
            品类分布
          </h3>
          {stats && stats.categories.length > 0 ? (
            <div className="mt-4 space-y-3">
              {stats.categories.map((cat, i) => (
                <div key={cat.category} className="flex items-center gap-3">
                  <span className="w-20 text-xs text-[var(--muted-foreground)] truncate">{cat.category}</span>
                  <div className="flex-1 h-5 rounded-full bg-[var(--muted)] overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", categoryColors[i % categoryColors.length])}
                      style={{ width: `${Math.round((cat.c / maxCat) * 100)}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-xs font-medium tabular-nums text-[var(--foreground)]">{cat.c}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--muted-foreground)]">暂无品类数据</p>
          )}
        </div>

        {/* 3 entry cards */}
        <div className="flex flex-col gap-3">
          {cards.map(card => (
            <Link key={card.title} href={card.href} className="group flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 transition-all hover:shadow-md hover:border-[var(--ring)]">
              <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br", card.color)}>
                <card.icon className="size-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--foreground)]">{card.title}</p>
                <p className="text-xs text-[var(--muted-foreground)] truncate">{card.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
