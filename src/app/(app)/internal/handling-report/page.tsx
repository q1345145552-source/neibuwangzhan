"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import type { HandlingReport } from "@/lib/handling-report";

const fmtDays = (n: number | null | undefined) => (n == null ? "—" : `${n} 天`);
const monthLabel = (m: string) => `${m.slice(0, 4)} 年 ${Number(m.slice(5, 7))} 月`;

function Tile({ label, value, unit, note, alert }: { label: string; value: string; unit?: string; note: string; alert?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-sm text-[var(--muted-foreground)]">{label}</p>
      <p className={cn("mt-1 font-mono text-2xl font-semibold tabular-nums", alert ? "text-[var(--destructive)]" : "text-[var(--foreground)]")}>
        {value}{unit && <span className="ml-1 font-sans text-sm font-normal text-[var(--muted-foreground)]">{unit}</span>}
      </p>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">{note}</p>
    </div>
  );
}

function ExternalTag() {
  return <span className="inline-flex rounded-full border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 text-[0.7rem] text-[var(--muted-foreground)]">外部等待</span>;
}

const th = "py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide whitespace-nowrap";
const thNum = "py-3 px-4 text-right text-xs font-medium text-[var(--muted-foreground)] tracking-wide whitespace-nowrap";
const td = "py-3 px-4 align-top";
const tdNum = "py-3 px-4 text-right font-mono text-xs tabular-nums align-top";

export default function HandlingReportPage() {
  const { user } = useAuth();
  // month 为空 = 当月；结果按请求的月份记下，月份一换就显示「加载中」直到新结果回来
  const [month, setMonth] = useState("");
  const [result, setResult] = useState<{ month: string; data?: HandlingReport; error?: string } | null>(null);
  const [knownMonths, setKnownMonths] = useState<string[]>([]);
  const [retry, setRetry] = useState(0);
  const isAdmin = user?.role === "admin";
  const loading = isAdmin && result?.month !== month;
  // 只显示所选月份自己的数：换月份时旧数先撤掉，加载失败也不会把上个月的数当成这个月
  const data = result?.month === month ? result.data ?? null : null;
  const error = result?.month === month ? result.error || "" : "";
  const [currentMonth] = useState(() => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7)); // 曼谷当月
  const monthOptions = knownMonths.length ? knownMonths : [currentMonth];

  useEffect(() => {
    if (!isAdmin) return;
    let ignore = false;
    fetchWithAuth(`/api/internal/handling-report${month ? `?month=${month}` : ""}`, { cache: "no-store" })
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "加载失败"); return r.json(); })
      .then((d: HandlingReport) => { if (!ignore) { setResult({ month, data: d }); setKnownMonths(d.months); } })
      .catch(e => { if (!ignore) setResult({ month, error: e instanceof Error ? e.message : "加载失败" }); });
    return () => { ignore = true; };
  }, [month, isAdmin, retry]);

  if (user && user.role !== "admin") {
    return <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">办理月报只有管理员能看</p>;
  }

  const s = data?.summary;
  const maxSlow = Math.max(1, ...(data?.slowSteps || []).map(x => x.medianDays));
  const maxLoad = Math.max(1, ...(data?.load || []).map(x => x.orders));
  const isCurrentMonth = data ? data.month === data.asOf.slice(0, 7) : false;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>办理效率月报</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">每类业务一般几个工作日办完、卡在哪一步、每个人手上压着几单、哪些单超时了。</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="report-month" className="text-sm text-[var(--muted-foreground)]">月份</label>
        <select id="report-month" value={month || data?.month || currentMonth} onChange={e => setMonth(e.target.value)} className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20">
          {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}{m === currentMonth ? "（进行中）" : ""}</option>)}
        </select>
        {data && <span className="text-xs text-[var(--muted-foreground)]">天数都按工作日算（周日和泰国法定假日不算）· 数据截至 {data.asOf}</span>}
        {error && <button type="button" onClick={() => { setResult(null); setRetry(n => n + 1); }} className="text-xs text-[var(--primary)] underline">重试</button>}
      </div>

      {error && <div role="alert" className="rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-4 py-3 text-sm text-[var(--destructive)]">{error}</div>}
      {loading && <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>}

      {data && s && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={isCurrentMonth ? "本月到目前办完" : "当月办完"} value={String(s.done)} unit="单" note={s.medianDays != null ? `从建单到办完，中间值 ${s.medianDays} 个工作日（不含公司注册）` : "办完的单太少，先不算中间值"} />
            <Tile label="现在还在办" value={String(s.inProgress)} unit="单" note={`其中有步骤卡住的 ${s.blockedOrders} 单`} />
            <Tile label="现在超时的单" value={String(s.overdue)} unit="单" note="停在当前这一步，超过设定天数（没设的按平时 1.5 倍）" alert={s.overdue > 0} />
            <Tile label="时间记录齐全" value={s.coverage == null ? "—" : String(s.coverage)} unit={s.coverage == null ? undefined : "%"} note="当月完成的步骤里记了开始时间的比例；7 月 16 日前的老单没记" />
          </div>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-sm font-medium text-[var(--foreground)]">各类业务办理周期</h2>
              <span className="text-xs text-[var(--muted-foreground)]">中间值：一半的单比它快，一半比它慢，不会被个别老单拉偏</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border)]"><th className={th}>业务</th><th className={thNum}>{isCurrentMonth ? "本月办完" : "当月办完"}</th><th className={thNum}>中间值</th><th className={thNum}>最长</th><th className={thNum}>现在还在办</th><th className={th}>备注</th></tr></thead>
                <tbody>
                  {data.groups.map(g => (
                    <tr key={g.group} className="border-b border-[var(--border)] last:border-0">
                      <td className={td}>{g.group}</td>
                      <td className={tdNum}>{g.done}</td>
                      <td className={tdNum}>{fmtDays(g.medianDays)}</td>
                      <td className={tdNum}>{fmtDays(g.maxDays)}</td>
                      <td className={tdNum}>{g.inProgress}</td>
                      <td className={cn(td, "text-xs text-[var(--muted-foreground)]")}>{g.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.groups.length === 0 && <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">这个月没有办完的单，也没有在办的单</p>}
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-4">
                <h2 className="text-sm font-medium text-[var(--foreground)]">最慢的几步</h2>
                <span className="text-xs text-[var(--muted-foreground)]">近 90 天，每步至少 5 个样本；半天以内办完的不列</span>
              </div>
              <div className="flex flex-col gap-3 px-5 py-4">
                {data.slowSteps.length === 0 && <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">样本还不够，暂时看不出哪一步最慢</p>}
                {data.slowSteps.map(x => (
                  <div key={`${x.group}-${x.step}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
                      <span className="text-[var(--foreground)]">{x.step}</span>
                      <span className="text-xs text-[var(--muted-foreground)]">{x.group}</span>
                      {x.external && <ExternalTag />}
                    </div>
                    <div className="row-span-2 text-right font-mono text-sm tabular-nums">{x.medianDays} 天<span className="block font-sans text-[0.7rem] text-[var(--muted-foreground)]">{x.samples} 个样本</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]">
                      <div className={cn("h-full rounded-full", x.external ? "bg-[var(--muted-foreground)]/50" : "bg-[var(--primary)]")} style={{ width: `${Math.round(x.medianDays / maxSlow * 100)}%` }} />
                    </div>
                  </div>
                ))}
                <p className="text-xs text-[var(--muted-foreground)]">等官方、等平台、等客户的步骤标了「外部等待」，不算到员工头上。几分钟内连着点完的步骤（当月 {s.batchSteps} 步）不算耗时。</p>
              </div>
            </section>

            <section className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-4">
                <h2 className="text-sm font-medium text-[var(--foreground)]">每人手上的单</h2>
                <span className="text-xs text-[var(--muted-foreground)]">截至 {data.asOf}，按单子现在做到的那一步算</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[var(--border)]"><th className={th}>经办人</th><th className={thNum}>在办</th><th className={thNum}>卡住</th><th className={thNum}>没开始</th><th className={thNum}>停得最久</th><th className="w-24 py-3 px-4" /></tr></thead>
                  <tbody>
                    {data.load.map(r => (
                      <tr key={r.person} className="border-b border-[var(--border)] last:border-0">
                        <td className={td}>{r.kind === "staff" ? r.person : <span className="inline-flex rounded-full border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">{r.person}</span>}</td>
                        <td className={tdNum}>{r.orders}</td>
                        <td className={cn(tdNum, r.blocked > 0 && "text-[var(--destructive)]")}>{r.blocked}</td>
                        <td className={tdNum}>{r.notStarted}</td>
                        <td className={tdNum}>{fmtDays(r.longestDays)}</td>
                        <td className="py-3 px-4 align-middle"><div className="h-1.5 overflow-hidden rounded-full bg-[var(--muted)]"><div className="h-full rounded-full bg-[var(--info)]" style={{ width: `${Math.round(r.orders / maxLoad * 100)}%` }} /></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.load.length === 0 && <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">现在没有在办的单</p>}
              </div>
              <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--muted-foreground)]">
                经办人没有历史记录，这一块只能看现在，选以前的月份也一样。跟<Link href="/internal" className="underline">内部管理</Link>里的负载数不一样：负载把以后才轮到的步骤和已取消的单也算进去了。
              </p>
            </section>
          </div>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-sm font-medium text-[var(--foreground)]">现在超时的单</h2>
              <span className="text-xs text-[var(--muted-foreground)]">流程设置里设了预计天数的，超过设定天数就算；没设的按平时（近 90 天同一步的中间值）的 1.5 倍判，样本不够的不判</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border)]"><th className={th}>订单</th><th className={th}>客户</th><th className={th}>业务</th><th className={th}>卡在哪一步</th><th className={th}>经办人</th><th className={thNum}>已停</th><th className={thNum}>平时</th></tr></thead>
                <tbody>
                  {data.overdue.map(r => (
                    <tr key={`${r.orderId}-${r.step}`} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--secondary)]">
                      <td className={td}><Link href={`/orders/${r.orderId}`} className="font-mono text-xs font-medium text-[var(--accent-foreground)] hover:underline">{r.orderId}</Link></td>
                      <td className={td}>{r.customer}</td>
                      <td className={cn(td, "whitespace-nowrap")}>{r.group}</td>
                      <td className={td}><span className="mr-1.5">{r.step}</span>{r.external && <ExternalTag />}</td>
                      <td className={td}>{r.assignee || <span className="text-[var(--muted-foreground)]">未指定</span>}</td>
                      <td className={cn(tdNum, "text-[var(--destructive)]")}>{fmtDays(r.stayedDays)}</td>
                      <td className={tdNum}>{r.bySetting ? `设定 ${fmtDays(r.normalDays)}` : fmtDays(r.normalDays)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.overdue.length === 0 && <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">现在没有超时的单</p>}
            </div>
          </section>

          <div className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
            <p>· 办理周期从建单那一刻算到最后一步完成；公司注册几种服务共用一套流程，周期和最慢一步先不算。</p>
            <p>· 已取消的单不进任何统计（目前共 {s.cancelledTotal} 单）。</p>
            <p>· 步骤名以「等待」开头的（等官方、等平台、等客户）算外部等待；以后流程设置里能勾选时改用勾选。</p>
          </div>
        </>
      )}
    </div>
  );
}
