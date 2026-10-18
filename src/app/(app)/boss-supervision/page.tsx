"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { toThaiTime } from "@/lib/utils";
import type { SupervisionOverdue } from "@/lib/boss-supervision";

type Category = SupervisionOverdue["category"];
interface Snapshot {
  total: number; counts: Record<Category, number>; overdues: SupervisionOverdue[]; generated_at: string;
}
const modules: { category: Category; label: string }[] = [
  { category: "todo", label: "待办逾期" },
  { category: "report", label: "日报漏交" },
  { category: "meeting", label: "会议未交" },
  { category: "notice", label: "通知未落实" },
];

function OverdueItems({ items }: { items: SupervisionOverdue[] }) {
  return <ul className="space-y-2">
    {items.map(item => <li key={item.id} className="min-w-0 space-y-2 rounded-lg border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{item.employee_name}</span>
        <span className="shrink-0 rounded-full bg-blue-500/10 px-2 py-1 text-xs text-blue-600">{modules.find(module => module.category === item.category)?.label}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{item.title}</p>
      <p className="text-sm font-medium text-red-600 [overflow-wrap:anywhere]">逾期 {item.overdue_duration}</p>
    </li>)}
  </ul>;
}

export default function BossSupervisionPage() {
  const { user, token } = useAuth();
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<"module" | "employee">("module");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (user?.role !== "admin" || !token) return;
    const controller = new AbortController();
    fetch("/api/boss-supervision/overdue", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "加载监督看板失败，请重试");
        return body as Snapshot;
      })
      .then(body => { if (!controller.signal.aborted) { setData(body); setError(""); } })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "加载失败，请重试"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user?.role, token, revision]);

  if (!user) return <p>检查登录状态…</p>;
  if (user.role !== "admin") return <p role="alert">无权访问监督看板，仅管理员可查看。</p>;
  function refresh() { setLoading(true); setError(""); setRevision(previous => previous + 1); }
  const employees = new Map<number, { name: string; items: SupervisionOverdue[] }>();
  for (const item of data?.overdues ?? []) {
    const group = employees.get(item.employee_id) ?? { name: item.employee_name, items: [] };
    group.items.push(item); employees.set(item.employee_id, group);
  }
  const employeeGroups = [...employees].sort((a, b) => b[1].items.length - a[1].items.length || a[0] - b[0]);
  return <div className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">监督看板</h1><Button type="button" onClick={refresh} disabled={loading} className="min-h-11">{loading ? "加载中…" : "刷新清单"}</Button></div>
    <p className="text-sm text-[var(--muted-foreground)]">按曼谷时间计算，计时已扣除周日和请假时段。{data && ` 更新于 ${toThaiTime(data.generated_at)}`}</p>
    {error && <div role="alert" className="space-y-2 rounded-lg bg-red-500/10 p-3 text-sm text-red-600"><p>{error}</p>{data && <p>当前保留上次成功加载的数据，请刷新重试。</p>}<Button type="button" onClick={refresh} disabled={loading}>重试</Button></div>}
    {loading && <p role="status" className="text-sm text-[var(--muted-foreground)]">正在获取逾期清单…</p>}
    {data && <>
      <section aria-label="逾期统计" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {[{ label: "逾期总数", count: data.total }, ...modules.map(module => ({ label: module.label, count: data.counts[module.category] }))].map(stat => <div key={stat.label} className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"><p className="text-sm text-[var(--muted-foreground)]">{stat.label}</p><p className="mt-2 text-2xl font-semibold">{stat.count}<span className="ml-1 text-xs font-normal">条</span></p></div>)}
      </section>
      <div role="tablist" aria-label="监督看板视角" className="flex flex-wrap gap-2">
        {([{ key: "module", label: "按模块看" }, { key: "employee", label: "按员工看" }] as const).map(tab => <button key={tab.key} type="button" role="tab" id={`supervision-tab-${tab.key}`} aria-selected={view === tab.key} aria-controls="supervision-panel" onClick={() => setView(tab.key)} className={`min-h-11 rounded-lg border px-4 py-2 text-sm ${view === tab.key ? "border-blue-600 bg-blue-600 text-white" : "border-[var(--border)] bg-[var(--card)]"}`}>{tab.label}</button>)}
      </div>
      <div id="supervision-panel" role="tabpanel" aria-labelledby={`supervision-tab-${view}`}>
        {data.total === 0 && <p role="status" className="mb-4 rounded-xl border border-[var(--border)] p-5 text-sm text-[var(--muted-foreground)]">当前没有逾期事项。</p>}
        {view === "module" ? <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {modules.map(module => {
            const items = data.overdues.filter(item => item.category === module.category);
            return <section key={module.category} aria-label={module.label} className="min-w-0 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{module.label}</h2><span className="text-sm text-[var(--muted-foreground)]">{items.length} 条</span></div>
              {items.length ? <OverdueItems items={items} /> : <p className="text-sm text-[var(--muted-foreground)]">暂无逾期</p>}
            </section>;
          })}
        </div> : <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {employeeGroups.map(([id, group]) => <article key={id} aria-label={`${group.name}的逾期`} className="min-w-0 space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="min-w-0 font-semibold [overflow-wrap:anywhere]">{group.name}</h2><span className="text-sm text-red-600">共 {group.items.length} 条逾期</span></div>
            {modules.map(module => {
              const items = group.items.filter(item => item.category === module.category);
              return items.length ? <section key={module.category} aria-label={module.label} className="min-w-0 space-y-2"><h3 className="text-sm font-medium">{module.label} · {items.length} 条</h3><OverdueItems items={items} /></section> : null;
            })}
          </article>)}
        </div>}
      </div>
    </>}
  </div>;
}
