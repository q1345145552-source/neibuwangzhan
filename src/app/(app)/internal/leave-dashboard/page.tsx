"use client";

import { useState, useEffect, useMemo } from "react";
import { fetchWithAuth } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function LeaveDashboardPage() {
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/leave/dashboard")
      .then(r => r.json())
      .then(d => { if (!d.error) setDashboard(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const cards = useMemo(() => {
    if (!dashboard) return [];
    const m = dashboard.monthStats || [];
    const totalLeaves = m.reduce((sum: number, s: any) =>
      sum + (s.sick || 0) + (s.personal || 0) + (s.annual || 0) + (s.other || 0), 0);
    const sickTotal = m.reduce((sum: number, s: any) => sum + (s.sick || 0), 0);
    const sickPct = totalLeaves > 0 ? Math.round(sickTotal / totalLeaves * 100) : 0;

    return [
      { label: "本月请假人次", value: totalLeaves, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30", target: "section-month-stats" },
      { label: "待审批", value: dashboard.pendingCount ?? 0, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30", target: "section-pending" },
      { label: "本月病假人次", value: sickTotal, color: "text-red-600", bg: "bg-red-50 dark:bg-red-950/30", target: "section-sick" },
      { label: "病假占比", value: `${sickPct}%`, color: sickPct > 50 ? "text-red-600" : "text-orange-600", bg: sickPct > 50 ? "bg-red-50 dark:bg-red-950/30" : "bg-orange-50 dark:bg-orange-950/30", target: "section-sick" },
      { label: "拼假嫌疑", value: (dashboard.bridgeSuspects?.length ?? 0), color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-950/30", target: "section-bridge" },
    ];
  }, [dashboard]);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (loading) return <div className="text-center py-12 text-sm text-[var(--muted-foreground)]">加载中…</div>;
  if (!dashboard) return <div className="text-center py-12 text-sm text-[var(--muted-foreground)]">暂无数据或没有权限</div>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">请假看板</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">实时请假数据一览</p>
      </div>

      {/* ── 五张汇总卡片 ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c, i) => (
          <button
            key={i}
            onClick={() => scrollTo(c.target)}
            className={cn(
              "rounded-xl border border-[var(--border)] p-4 text-left cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5",
              c.bg
            )}
          >
            <p className={cn("text-3xl font-bold", c.color)}>{c.value}</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">{c.label} ▸</p>
          </button>
        ))}
      </div>

      {/* ── 今日请假 / 待审批 ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div id="section-today" className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs text-[var(--muted-foreground)]">今日请假</p>
          {dashboard.todayOnLeave.length === 0 ? (
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">无</p>
          ) : (
            <div className="mt-1 space-y-1">
              {dashboard.todayOnLeave.map((l: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{l.employee_name}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">{l.leave_type}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">{l.start_date} ~ {l.end_date}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div id="section-pending" className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs text-[var(--muted-foreground)]">待审批 <span className="font-bold text-amber-600">{dashboard.pendingCount}</span> 条</p>
          {dashboard.pendingList?.length > 0 && (
            <div className="mt-1 space-y-1">
              {dashboard.pendingList.map((l: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  <span className="font-medium text-[var(--foreground)]">{l.employee_name}</span>
                  <span>{l.leave_type}</span>
                  <span>{l.start_date} ~ {l.end_date}</span>
                  <span className="text-[var(--muted-foreground)]/60">{l.created_at?.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 当月统计（外层 div 始终存在，保证卡片能跳到） ── */}
      <div id="section-month-stats">
        {dashboard.monthStats?.length > 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-xs text-[var(--muted-foreground)] mb-3">当月统计（{dashboard.monthStats.length} 人请假）</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                    <th className="py-2 px-3 text-left font-medium">姓名</th>
                    <th className="py-2 px-3 text-center font-medium">病假</th>
                    <th className="py-2 px-3 text-center font-medium">事假</th>
                    <th className="py-2 px-3 text-center font-medium">年假</th>
                    <th className="py-2 px-3 text-center font-medium">其他</th>
                    <th className="py-2 px-3 text-right font-medium">总天数</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.monthStats.map((s: any) => (
                    <tr key={s.employee_name} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-2 px-3 font-medium">{s.employee_name}</td>
                      <td className="py-2 px-3 text-center">{s.sick || 0}</td>
                      <td className="py-2 px-3 text-center">{s.personal || 0}</td>
                      <td className="py-2 px-3 text-center">{s.annual || 0}</td>
                      <td className="py-2 px-3 text-center">{s.other || 0}</td>
                      <td className="py-2 px-3 text-right font-medium">{s.totalDays}天</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-xs text-[var(--muted-foreground)]">当月统计</p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">本月暂无请假记录</p>
          </div>
        )}
      </div>

      {/* ── 病假排行 / 拼假嫌疑 ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div id="section-sick">
          {dashboard.sickLeaders?.length > 0 ? (
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-[var(--card)] p-4">
              <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-3">🔴 病假重点关注</p>
              <div className="space-y-2">
                {dashboard.sickLeaders.map((s: any, i: number) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="font-medium">{s.employee_name}</span>
                    <span className="text-red-600 font-bold">{s.sick}次</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-xs text-[var(--muted-foreground)]">病假重点关注</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">本月无病假记录</p>
            </div>
          )}
        </div>
        <div id="section-bridge">
          {dashboard.bridgeSuspects?.length > 0 ? (
            <div className="rounded-xl border border-orange-200 dark:border-orange-800 bg-[var(--card)] p-4">
              <p className="text-sm font-medium text-orange-600 dark:text-orange-400 mb-3">⚠️ 拼假嫌疑（{dashboard.bridgeSuspects.length} 条）</p>
              <div className="space-y-3">
                {dashboard.bridgeSuspects.map((b: any, i: number) => (
                  <div key={i} className="text-sm">
                    <p className="font-medium text-[var(--foreground)]">{b.employee_name}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">{b.start_date} ~ {b.end_date}</p>
                    <p className="text-xs text-orange-600">卡到：{b.holidays.map((h: any) => h.date + " " + h.name.split(" (")[0]).join("、")}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-xs text-[var(--muted-foreground)]">拼假嫌疑</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">本月无拼假嫌疑</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
