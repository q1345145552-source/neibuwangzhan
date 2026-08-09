"use client";

import { useState, useEffect } from "react";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";

export default function LeaveDashboardPage() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/leave/dashboard")
      .then(r => r.json())
      .then(d => { if (!d.error) setDashboard(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-sm text-[var(--muted-foreground)]">加载中…</div>;
  if (!dashboard) return <div className="text-center py-12 text-sm text-[var(--muted-foreground)]">暂无数据或没有权限</div>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">请假看板</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">实时请假数据一览</p>
      </div>

      <div className="space-y-4">
        {/* 今日请假 / 待审批 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
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
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
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

        {/* 当月统计 */}
        {dashboard.monthStats?.length > 0 && (
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
        )}

        {/* 病假排行 / 拼假嫌疑 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {dashboard.sickLeaders?.length > 0 && (
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
          )}
          {dashboard.bridgeSuspects?.length > 0 && (
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
          )}
        </div>
      </div>
    </div>
  );
}
