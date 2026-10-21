"use client";

import { useAuth } from "@/components/auth-provider";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ExternalLink } from "lucide-react";
import { useBossPending } from "@/lib/use-boss-pending";
import { BOSS_PENDING_TYPES, type BossPendingCategory } from "@/lib/boss-submission-types";
import { toThaiTime } from "@/lib/utils";
import { TaskMessageButton } from "@/components/task-message-button";

export default function BossSupervisionPage() {
  const { user } = useAuth();
  const { data, loading, error, refresh } = useBossPending();
  useEffect(() => { void refresh(); }, [refresh]);
  if (!user) return <p>检查登录状态…</p>;
  if (user.role !== "admin") return <p role="alert">无权访问监督看板，仅管理员可查看。</p>;

  return <div className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">待处理清单</h1>
      <Button type="button" onClick={() => void refresh()} disabled={loading} className="min-h-11">{loading ? "刷新中…" : "刷新清单"}</Button>
    </div>
    <p className="text-sm text-[var(--muted-foreground)]">在新标签页中处理，返回后自动刷新清单。</p>
    {error && <div role="alert" className="space-y-1 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600"><p>{error}</p>{data && <p>当前保留上次成功加载的清单，请刷新重试。</p>}</div>}
    {!data && !error && <p role="status" className="text-sm text-[var(--muted-foreground)]">正在加载待处理清单…</p>}
    {data && <>
      <section aria-label="待处理总数" className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-5">
        <p className="text-sm text-[var(--muted-foreground)]">一共待处理</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{data.total}<span className="ml-2 text-sm font-normal">条</span></p>
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">更新于 {toThaiTime(data.generated_at)}</p>
      </section>
      {data.total === 0 && <p role="status" className="text-sm text-[var(--muted-foreground)]">暂无待处理事项。</p>}
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-2">
        {(Object.keys(BOSS_PENDING_TYPES) as BossPendingCategory[]).map(category => {
          const items = data.items.filter(item => item.category === category);
          const label = BOSS_PENDING_TYPES[category].label;
          return <details key={category} className="group min-w-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center gap-2 p-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1">{label}</span>
              <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-xs tabular-nums text-blue-600">{data.counts[category]} 条待处理</span>
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            {items.length ? <ul className="space-y-2 border-t border-[var(--border)] p-3">
              {items.map(item => <li key={item.id} className="min-w-0 rounded-lg border border-[var(--border)]">
                <a href={item.href} target="_blank" rel="noopener noreferrer" aria-label={`${item.employee_name}的${label}，新标签页打开`} className="block min-w-0 space-y-2 rounded-lg p-3 transition-colors hover:bg-blue-500/5 focus-visible:outline-2 focus-visible:outline-blue-500">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{item.employee_name}</span><span className="inline-flex shrink-0 items-center gap-1 text-xs text-blue-600">去处理<ExternalLink aria-hidden="true" className="size-3.5" /></span></div>
                  <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{item.summary}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{category === "todo" || category === "issue" ? "创建时间" : "提交时间"}：<time dateTime={item.submitted_at}>{toThaiTime(item.submitted_at)}</time></p>
                </a>
                <div className="flex justify-end px-3 pb-3"><TaskMessageButton type={category} id={item.source_id} ownerNames={category === "issue" ? item.employee_name.split(",") : [item.employee_name]} ownerId={item.employee_id} /></div>
              </li>)}
            </ul> : <p className="border-t border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]">暂无{label}待处理事项。</p>}
          </details>;
        })}
      </div>
    </>}
  </div>;
}
