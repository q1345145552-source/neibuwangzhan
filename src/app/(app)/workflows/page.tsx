"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import type { CatalogEntry } from "@/lib/workflow-catalog";

const chip = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export default function WorkflowsPage() {
  const { user } = useAuth();
  const [result, setResult] = useState<{ entries: CatalogEntry[]; error?: string } | null>(null);
  const [selected, setSelected] = useState("");
  const isAdmin = user?.role === "admin";
  const entries = useMemo(() => result?.entries ?? [], [result]);
  const loading = isAdmin && !result;
  const error = result?.error || "";

  useEffect(() => {
    if (!isAdmin) return;
    let ignore = false;
    fetchWithAuth("/api/workflows", { cache: "no-store" })
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "加载失败"); return r.json(); })
      .then((d: { entries: CatalogEntry[] }) => { if (!ignore) setResult({ entries: d.entries || [] }); })
      .catch(e => { if (!ignore) setResult({ entries: [], error: e instanceof Error ? e.message : "加载失败" }); });
    return () => { ignore = true; };
  }, [isAdmin]);

  const grouped = useMemo(() => {
    const map = new Map<string, CatalogEntry[]>();
    for (const e of entries) { const l = map.get(e.business); if (l) l.push(e); else map.set(e.business, [e]); }
    return [...map.entries()];
  }, [entries]);
  const current = entries.find(e => e.key === selected) ?? entries[0];

  if (user && user.role !== "admin") {
    return <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">流程设置只有管理员能看</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>流程设置</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">现在每类业务有哪几步、默认谁来做、要客户交什么资料。这一期只能看，用来核对现有流程；以后会在这里直接改经办人和天数。</p>
      </div>

      {error && <div role="alert" className="rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-4 py-3 text-sm text-[var(--destructive)]">{error}</div>}
      {loading && <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>}

      {!loading && entries.length > 0 && (
        <div className="grid items-start gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="业务和服务" className="flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 xl:max-h-[calc(100vh-12rem)] xl:flex-col xl:flex-nowrap xl:overflow-y-auto">
            {grouped.map(([business, list]) => (
              <div key={business} className="flex w-full flex-col gap-0.5">
                <p className="px-2 pb-1 pt-2 text-xs text-[var(--muted-foreground)]">{business}</p>
                {list.map(e => (
                  <button key={e.key} type="button" onClick={() => setSelected(e.key)}
                    className={cn("flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-[var(--secondary)]",
                      e.key === current?.key && "bg-[var(--secondary)] font-medium text-[var(--secondary-foreground)]")}>
                    <span className="min-w-0">{e.services.join(" / ")}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {(e.unconfigured || e.neutralSteps === e.steps.length - 1) && <span className="size-1.5 rounded-full bg-[var(--destructive)]" title={e.unconfigured ? "还没配流程" : "客户看到的步骤名都是「办理事项」"} />}
                      <span className="font-mono text-xs text-[var(--muted-foreground)]">{e.steps.length} 步</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          {current && (
            <section className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
              <div className="flex flex-col gap-2 border-b border-[var(--border)] px-5 py-4">
                <h2 className="text-sm font-medium text-[var(--foreground)]">{current.business} · {current.services.join(" / ")}</h2>
                <div className="flex flex-wrap gap-1.5">
                  <span className={cn(chip, "border border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]")}>共 {current.steps.length} 步</span>
                  <span className={cn(chip, "bg-[color-mix(in_oklch,var(--success),var(--background)_88%)] text-[var(--success)]")}>现在还在办 {current.inProgress} 单</span>
                  {current.reviewed
                    ? <span className={cn(chip, "bg-[color-mix(in_oklch,var(--info),var(--background)_88%)] text-[var(--info)]")}>客户看到的步骤名已核对（商城和客户站在用）</span>
                    : current.neutralSteps > 0 && <span className={cn(chip, "bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] text-[var(--destructive)]")}>客户看到「办理事项」的有 {current.neutralSteps} 步</span>}
                  {current.unconfigured && <span className={cn(chip, "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]")}>还没配流程</span>}
                </div>
                {current.personNames.length > 0 && (
                  <p className="text-xs text-[var(--muted-foreground)]">步骤名里写着人名：{current.personNames.join("、")}。以后换默认经办人，步骤名不会自动跟着变。</p>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
                      <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">#</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">步骤（员工看到）</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">客户看到的名字</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] whitespace-nowrap">默认经办人</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">要客户交的资料</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.steps.map((s, i) => (
                      <tr key={i} className="border-b border-[var(--border)] last:border-0 align-top">
                        <td className="py-3 px-4 font-mono text-xs text-[var(--muted-foreground)]">{i + 1}</td>
                        <td className="py-3 px-4">
                          <span className="text-[var(--foreground)]">{s.name}</span>
                          {s.external && <span className="ml-1.5 inline-flex rounded-full border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 text-[0.7rem] text-[var(--muted-foreground)]">外部等待</span>}
                          {i === 0 && <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">固定第一步</span>}
                          {s.notes && <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">{s.notes}</span>}
                        </td>
                        <td className={cn("py-3 px-4", s.publicName === "办理事项" ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]")}>{s.publicName}</td>
                        <td className="py-3 px-4 whitespace-nowrap">{s.assignee || <span className="text-[var(--muted-foreground)]">不预设</span>}</td>
                        <td className="py-3 px-4">
                          {s.docs.length
                            ? <div className="flex flex-wrap gap-1">{s.docs.map(d => <span key={d} className="rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-xs">{d}</span>)}</div>
                            : <span className="text-[var(--muted-foreground)]">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
