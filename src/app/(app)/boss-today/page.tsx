"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { TaskMessageButton } from "@/components/task-message-button";
import { fetchWithAuth } from "@/lib/api";
import type { BossToday, CompletedTodo, RaisedProblem } from "@/lib/boss-today";
import { COMPLETED_TODO_DAYS, DONE_NOT_CLOSED_DAYS, STUCK_DAYS, STALE_TODO_DAYS } from "@/lib/boss-today";
import { toThaiTime } from "@/lib/utils";

const SHOW_FIRST = 10;

function md(date: string) {
  const [, m, d] = date.split("-").map(Number);
  return `${m}月${d}日`;
}

function Section({ step, title, hint, count, children }: { step: number; title: string; hint: string; count: number; children: React.ReactNode }) {
  return <section aria-labelledby={`boss-today-${step}`} className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)]">
    <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--border)] p-4">
      <span className="text-xs font-semibold tabular-nums text-[var(--muted-foreground)]">{step}</span>
      <h2 id={`boss-today-${step}`} className="text-base font-semibold">{title}</h2>
      <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${count ? "bg-[var(--warning)]/15 text-[var(--foreground)]" : "bg-[var(--success)]/15 text-[var(--success)]"}`}>{count ? `${count} 件` : "没有"}</span>
      <p className="w-full text-xs text-[var(--muted-foreground)]">{hint}</p>
    </header>
    <div className="p-3">{children}</div>
  </section>;
}

function Empty({ text }: { text: string }) {
  return <p className="px-1 py-2 text-sm text-[var(--muted-foreground)]">{text}</p>;
}

function OpenLink({ href, label }: { href: string; label: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md px-2 text-sm text-[var(--primary)] hover:bg-[var(--muted)]">
    {label}<ExternalLink aria-hidden="true" className="size-3.5" />
  </a>;
}

function MoreToggle({ total, open, onToggle }: { total: number; open: boolean; onToggle: () => void }) {
  if (total <= SHOW_FIRST) return null;
  return <Button type="button" variant="ghost" size="sm" onClick={onToggle} className="mt-1 w-full">{open ? "收起" : `展开全部 ${total} 件`}</Button>;
}

export default function BossTodayPage() {
  const { user } = useAuth();
  const [data, setData] = useState<BossToday | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [allOrders, setAllOrders] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState("");
  const [zh, setZh] = useState<Record<number, string>>({});
  const [zhFailed, setZhFailed] = useState<Record<number, true>>({});
  const [confirming, setConfirming] = useState(false);
  const translating = useRef(new Set<number>());

  // 员工用泰文写的问题，自动翻成中文（译文缓存在日报上，下次不再翻）
  const translate = useCallback((items: RaisedProblem[]) => {
    for (const p of items) {
      if (p.translated || translating.current.has(p.report_id)) continue;
      translating.current.add(p.report_id);
      void fetchWithAuth(`/api/work-reports/${p.report_id}/translate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: "problems" }) })
        .then(r => r.ok ? r.json() : null)
        .then(b => {
          if (b?.problems_zh) setZh(prev => ({ ...prev, [p.report_id]: b.problems_zh }));
          else throw new Error("translate failed");
        })
        .catch(() => setZhFailed(prev => ({ ...prev, [p.report_id]: true })));
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/boss-today");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "加载失败");
      setData(body as BossToday); setError("");
      translate((body as BossToday).raised_problems);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败，请刷新");
    } finally { setLoading(false); }
  }, [translate]);
  const reload = () => { setLoading(true); void load(); };

  useEffect(() => {
    if (user?.role !== "admin") return;
    const first = setTimeout(() => void load(), 0);
    // 在新标签页处理完回来，自动刷新
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(first); document.removeEventListener("visibilitychange", onVisible); };
  }, [user?.role, load]);

  const markSeen = async (items: { id: number; revision: string }[]) => {
    let marked = 0;
    for (let i = 0; i < items.length; i += 500) {
      const res = await fetchWithAuth("/api/boss-supervision/pending/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: "report", items: items.slice(i, i + 500) }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "标记失败");
      marked += body.marked ?? 0;
    }
    return marked;
  };

  if (!user) return <p>检查登录状态…</p>;
  if (user.role !== "admin") return <p role="alert">这个页面只给老板看。</p>;

  const problemIds = new Set(data?.raised_problems.map(p => p.report_id));
  const normalReports = data?.reports_to_clear.filter(r => !problemIds.has(r.id)) ?? [];
  const oldCount = normalReports.filter(r => r.old).length;

  const clearReports = async () => {
    if (!normalReports.length) return;
    setClearing(true); setNotice("");
    try {
      const n = await markSeen(normalReports.map(r => ({ id: r.id, revision: r.revision })));
      setNotice(`已把 ${n} 份日报标为已看。`);
      await load();
    } catch (e) { setNotice(e instanceof Error ? e.message : "标记失败，请重试"); }
    finally { setClearing(false); }
  };
  const confirmTodos = async (items: CompletedTodo[]) => {
    if (!items.length) return;
    setConfirming(true); setNotice("");
    let ok = 0, failed = 0;
    for (const t of items) {
      try {
        const res = await fetchWithAuth(`/api/todos/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm" }) });
        if (res.ok) ok++; else failed++;
      } catch { failed++; }
    }
    setNotice(failed ? `确认了 ${ok} 条，${failed} 条没成功（可能员工又改回了未完成），请刷新看看。` : `已确认 ${ok} 条。`);
    setConfirming(false);
    await load();
  };
  const ackProblem = async (p: RaisedProblem) => {
    const r = data?.reports_to_clear.find(x => x.id === p.report_id);
    if (!r) return;
    try { await markSeen([{ id: r.id, revision: r.revision }]); await load(); } catch (e) { setNotice(e instanceof Error ? e.message : "标记失败，请重试"); }
  };

  const orders = data ? (allOrders ? data.stuck_orders : data.stuck_orders.slice(0, SHOW_FIRST)) : [];
  const leftCount = data?.stuck_orders.filter(o => o.assignee_left).length ?? 0;
  const stuckTotal = (data?.stuck_orders.length ?? 0) + (data?.stuck_issues.length ?? 0);
  const total = data ? data.decisions.length + stuckTotal + data.raised_problems.length + data.completed_todos.length + data.misses.length : 0;

  // contain:inline-size —— 单行截断的长文字（订单步骤名等）不能反过来撑宽整个主区域
  return <div className="mx-auto min-w-0 max-w-4xl space-y-4 [contain:inline-size]">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">老板今日</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {data ? <>从上往下过一遍，大约 {Math.max(5, Math.min(10, Math.ceil(total / 4)))} 分钟。这里没出现的事，今天不用你管。</> : "正在整理今天要你处理的事…"}
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={reload} disabled={loading}>
        <RefreshCw aria-hidden="true" className={loading ? "animate-spin" : ""} />{loading ? "刷新中" : "刷新"}
      </Button>
    </div>
    {error && <p role="alert" className="rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 p-3 text-sm text-[var(--destructive)]">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">{notice}</p>}

    {data && <>
      <Section step={1} title="等你拍板" hint="请假、补签、问题验收、规则落实、会议心得。点开批完，回到这页会自动刷新。" count={data.decisions.length}>
        {data.decisions.length ? <ul className="divide-y divide-[var(--border)]">
          {data.decisions.map(item => <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2">
            <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-xs">{item.category_label}</span>
            <span className="text-sm font-medium">{item.employee_name}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted-foreground)]" title={item.summary}>{item.summary}</span>
            <OpenLink href={item.href} label="去批" />
          </li>)}
        </ul> : <Empty text="没有要你批的。" />}
      </Section>

      <Section step={2} title="卡住的事" hint={`订单当前这一步超过 ${STUCK_DAYS} 天没动静、标了卡住、步骤办完 ${DONE_NOT_CLOSED_DAYS} 天还没结单，或者工单 3 天以上还没解决。负责人已离职的排在前面，需要你换人。`} count={stuckTotal}>
        {leftCount > 0 && <p className="mb-2 rounded-md bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--destructive)]">有 {leftCount} 个订单的负责人已经离职或没人负责，不换人就永远不会动。</p>}
        {data.stuck_orders.length ? <>
          <ul className="divide-y divide-[var(--border)]">
            {orders.map(o => <li key={o.order_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2">
              <span className="w-16 shrink-0 text-sm tabular-nums text-[var(--muted-foreground)]">{o.idle_days} 天</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm"><span className="font-medium">{o.business || "未分类"}</span> · {o.customer_name || o.order_id}</p>
                <p className="truncate text-xs text-[var(--muted-foreground)]" title={o.step_name}>{o.step_status === "阻塞" ? "【卡住】" : o.step_status === "待结单" ? "【待结单】" : ""}{o.step_name}</p>
              </div>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${o.assignee_left ? "bg-[var(--destructive)]/10 text-[var(--destructive)]" : "bg-[var(--muted)]"}`}>
                {o.assignee === "未分配" ? "没人负责" : o.assignee_left ? `${o.assignee}（已离职）` : o.assignee}
              </span>
              <OpenLink href={o.href} label="打开" />
            </li>)}
          </ul>
          <MoreToggle total={data.stuck_orders.length} open={allOrders} onToggle={() => setAllOrders(v => !v)} />
        </> : <Empty text="订单都在正常推进。" />}
        {data.stuck_issues.length > 0 && <>
          <h3 className="mt-3 px-1 text-sm font-medium">工单</h3>
          <ul className="divide-y divide-[var(--border)]">
            {data.stuck_issues.map(i => <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2">
              <span className="w-16 shrink-0 text-sm tabular-nums text-[var(--muted-foreground)]">{i.age_days} 天</span>
              <span className="min-w-0 flex-1 truncate text-sm" title={i.description}>{i.description}</span>
              <span className="shrink-0 rounded bg-[var(--muted)] px-1.5 py-0.5 text-xs">{i.assignee || "未分配"}</span>
              {i.assignee && <TaskMessageButton type="issue" id={i.id} ownerNames={i.assignee.split(",")} />}
              <OpenLink href={i.href} label="打开" />
            </li>)}
          </ul>
        </>}
      </Section>

      <Section step={3} title="员工提的问题" hint="近 7 天日报里「遇到的问题」写了实际内容、你还没看过的。回一句，员工就知道你在看。" count={data.raised_problems.length}>
        {data.raised_problems.length ? <ul className="space-y-2">
          {data.raised_problems.map(p => <li key={p.report_id} className="rounded-lg border border-[var(--border)] p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-medium">{p.employee_name}</span>
              <span className="text-xs text-[var(--muted-foreground)]">{md(p.report_date)} 日报</span>
              <span className="flex-1" />
              <TaskMessageButton type="report" id={p.report_id} ownerNames={[p.employee_name]} />
              <Button type="button" variant="ghost" size="sm" onClick={() => void ackProblem(p)}>知道了</Button>
              <OpenLink href={p.href} label="看日报" />
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{zh[p.report_id] || p.problems}</p>
            {!p.translated && !zh[p.report_id] && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{zhFailed[p.report_id] ? "翻译失败，显示的是原文" : "正在翻译成中文…"}</p>}
            {zh[p.report_id] && <details className="mt-1 text-xs text-[var(--muted-foreground)]"><summary className="cursor-pointer">原文</summary><p className="whitespace-pre-wrap">{p.problems}</p></details>}
          </li>)}
        </ul> : <Empty text="最近没人提问题。" />}
      </Section>

      <Section step={4} title="员工办完了你派的事" hint={`近 ${COMPLETED_TODO_DAYS} 天员工标了完成、还没确认的待办。扫一眼，没问题就确认；没做好的点开改回未完成。`} count={data.completed_todos.length}>
        {data.completed_todos.length ? <>
          <ul className="divide-y divide-[var(--border)]">
            {data.completed_todos.map(t => <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2">
              <span className="w-20 shrink-0 text-sm font-medium">{t.assignee}</span>
              <span className="min-w-0 flex-1 truncate text-sm" title={t.content}>{t.content}</span>
              <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{toThaiTime(t.completed_at)}</span>
              <Button type="button" variant="ghost" size="sm" disabled={confirming} onClick={() => void confirmTodos([t])}>确认</Button>
              <OpenLink href={t.href} label="打开" />
            </li>)}
          </ul>
          {data.completed_todos.length > 1 && <div className="mt-2 flex justify-end">
            <Button type="button" size="sm" disabled={confirming} onClick={() => void confirmTodos(data.completed_todos)}>{confirming ? "确认中…" : `全部确认（${data.completed_todos.length}）`}</Button>
          </div>}
        </> : <Empty text="没有等你确认的。" />}
      </Section>

      <Section step={5} title={`${md(data.last_workday)}谁没做到`} hint="只算该上班、没请假的员工。系统已经自动给他们派了补交日报的待办；连续 3 天以上的才需要你找他聊。" count={data.misses.length}>
        {data.misses.length ? <ul className="divide-y divide-[var(--border)]">
          {data.misses.map(m => <li key={m.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2">
            <span className="w-20 text-sm font-medium">{m.name}</span>
            {m.no_attendance && <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-xs">没打卡</span>}
            {m.no_report && <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-xs">没交日报</span>}
            {m.report_miss_streak >= 3 && <span className="rounded bg-[var(--destructive)]/10 px-1.5 py-0.5 text-xs text-[var(--destructive)]">已连续 {m.report_miss_streak} 个工作日没交，该找他聊聊</span>}
          </li>)}
        </ul> : <Empty text="都做到了。" />}
      </Section>

      <section aria-labelledby="boss-today-6" className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="boss-today-6" className="text-base font-semibold">其他日报</h2>
            <p className="text-sm text-[var(--muted-foreground)]">
              {normalReports.length ? <>还有 {normalReports.length} 份没写问题的日报没看{oldCount ? `（其中 ${oldCount} 份是一周以前的）` : ""}。想看可以展开扫一眼，不看也可以直接清掉。</> : "日报都看过了。"}
            </p>
          </div>
          {normalReports.length > 0 && <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowReports(v => !v)}>{showReports ? "收起" : "展开"}</Button>
            <Button type="button" size="sm" onClick={() => void clearReports()} disabled={clearing}>{clearing ? "处理中…" : `全部标为已看（${normalReports.length}）`}</Button>
          </>}
        </div>
        {showReports && <ul className="mt-3 max-h-96 divide-y divide-[var(--border)] overflow-y-auto">
          {normalReports.map(r => <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2">
            <span className="w-20 text-sm">{r.employee_name}</span>
            <span className="w-16 text-xs text-[var(--muted-foreground)]">{md(r.report_date)}</span>
            {r.ai_label && <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-xs">{r.ai_label}</span>}
            <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted-foreground)]" title={r.summary}>{r.summary}</span>
            <OpenLink href={`/work-reports?report=${r.id}`} label="看" />
          </li>)}
        </ul>}
      </section>

      <section aria-labelledby="boss-today-7" className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 id="boss-today-7" className="text-base font-semibold">待办</h2>
        <ul className="mt-2 space-y-1 text-sm">
          <li>你自己还有 <b className="tabular-nums">{data.my_todos.total}</b> 条没完成{data.my_todos.stale ? <>，其中 <b className="tabular-nums">{data.my_todos.stale}</b> 条超过 {STALE_TODO_DAYS} 天——已经不做的，删掉或标完成，清单才有用</> : ""}。 <Link href="/todos" className="text-[var(--primary)] hover:underline">去整理</Link></li>
          {data.team_stale_todos.length > 0 && <li>员工拖了一周以上的：{data.team_stale_todos.map(t => `${t.name} ${t.count} 条`).join("、")}。周会上过一遍就行。</li>}
        </ul>
      </section>

      <p className="pb-6 text-center text-xs text-[var(--muted-foreground)]">更新于 {toThaiTime(data.generated_at)} · 看完了，今天就到这。</p>
    </>}
  </div>;
}
