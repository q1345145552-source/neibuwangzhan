"use client";

import { useState, useEffect } from "react";
import { fetchWithAuth } from "@/lib/api";
import { cn } from "@/lib/utils";
import { X, TrendingUp, CheckCircle2, Clock, FileText, History, BarChart3, User, Phone, Hash, AlertTriangle } from "lucide-react";

interface WhtCustomerProfile {
  customer: { id: number; company_name: string; tax_id: string; contact: string; status: string };
  currentMonth: string;
  currentRecords: { id: number; subtype: string; progress: string; amount: number; completed_steps: number; total_steps: number }[];
  currentSteps: { id: number; step_order: number; step_name: string; status: string; assignee: string }[];
  history: { year_month: string; archived: number; total: number; total_amount: number }[];
  last3Amounts: { month: string; amount: number }[];
  overdueCount: number;
  archivedCount: number;
  totalRecords: number;
}

export function WhtCustomerProfile({ customerId, onClose }: { customerId: number; onClose: () => void }) {
  const [profile, setProfile] = useState<WhtCustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchWithAuth(`/api/wht/customers/${customerId}/profile`)
      .then(r => r.json())
      .then(data => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [customerId]);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[var(--background)] border-l border-[var(--border)] shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-[var(--background)] px-5 py-4">
          <div>
            <h2 className="text-lg font-medium">{profile?.customer.company_name || "加载中..."}</h2>
            {profile?.customer.tax_id && (
              <p className="text-xs text-[var(--muted-foreground)]">税号: {profile.customer.tax_id}</p>
            )}
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-[var(--muted)] transition-colors">
            <X className="size-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="size-6 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
          </div>
        ) : !profile ? (
          <div className="flex items-center justify-center py-20 text-sm text-[var(--muted-foreground)]">加载失败</div>
        ) : (
          <div className="flex flex-col gap-5 p-5">

            {/* Overdue warning */}
            {profile.overdueCount > 0 && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
                <AlertTriangle className="size-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">未完成申报</p>
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {profile.overdueCount} 条记录未归档 · 已归档 {profile.archivedCount} 条
                  </p>
                </div>
              </div>
            )}

            {/* Basic info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 rounded-lg border p-3">
                <Phone className="size-4 text-[var(--muted-foreground)]" />
                <div>
                  <p className="text-[0.6rem] uppercase text-[var(--muted-foreground)]">联系方式</p>
                  <p className="text-sm">{profile.customer.contact || "—"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg border p-3">
                <Hash className="size-4 text-[var(--muted-foreground)]" />
                <div>
                  <p className="text-[0.6rem] uppercase text-[var(--muted-foreground)]">状态</p>
                  <p className={cn("text-sm font-medium",
                    profile.customer.status === "启用" ? "text-[var(--success)]" :
                    profile.customer.status === "暂停" ? "text-amber-500" : "text-[var(--muted-foreground)]"
                  )}>{profile.customer.status}</p>
                </div>
              </div>
            </div>

            {/* Current month progress */}
            <div>
              <h3 className="flex items-center gap-2 text-sm font-medium mb-3">
                <Clock className="size-4" />本月申报进度 ({profile.currentMonth})
              </h3>
              {profile.currentRecords.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {profile.currentRecords.map(rec => (
                    <div key={rec.id} className="rounded-lg border bg-[var(--card)] p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-[var(--muted)]">{rec.subtype}</span>
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                            rec.progress === "归档" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                          )}>{rec.progress}</span>
                          <span className="text-xs text-[var(--muted-foreground)]">{rec.completed_steps}/{rec.total_steps}</span>
                        </div>
                      </div>
                      {rec.amount > 0 && (
                        <p className="text-xs text-[var(--muted-foreground)]">
                          金额: ฿{rec.amount.toLocaleString()}
                        </p>
                      )}
                    </div>
                  ))}
                  {/* Current steps for first record */}
                  {profile.currentSteps.length > 0 && (
                    <div className="flex flex-col gap-1 mt-1">
                      {profile.currentSteps.map(step => (
                        <div key={step.id}
                          className={cn(
                            "flex items-center gap-2 rounded px-3 py-1.5 text-xs",
                            step.status === "已完成" ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300" :
                            step.status === "进行中" ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300" :
                            step.status === "已跳过" ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300" :
                            "bg-[var(--muted)] text-[var(--muted-foreground)]"
                          )}
                        >
                          {step.status === "已完成" ? <CheckCircle2 className="size-3.5" /> :
                           step.status === "已跳过" ? <span className="size-3.5 flex items-center justify-center text-[0.65rem]">—</span> :
                           <Clock className="size-3.5" />}
                          <span className="flex-1">{step.step_name}</span>
                          <span className="text-[0.6rem]">{step.assignee}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted-foreground)]">本月暂无申报记录</p>
              )}
            </div>

            {/* Amount trend */}
            <div>
              <h3 className="flex items-center gap-2 text-sm font-medium mb-3">
                <TrendingUp className="size-4" />近三月预扣税金额趋势
              </h3>
              {profile.last3Amounts.length > 0 ? (
                <div className="flex items-end gap-4 h-24 px-2">
                  {[...profile.last3Amounts].reverse().map((item, i) => {
                    const maxAmount = Math.max(...profile.last3Amounts.map(a => a.amount), 1);
                    const heightPct = (item.amount / maxAmount) * 100;
                    return (
                      <div key={item.month} className="flex flex-col items-center gap-1 flex-1">
                        <span className="text-xs font-medium tabular-nums">
                          {item.amount > 0 ? `฿${(item.amount / 1000).toFixed(1)}k` : "—"}
                        </span>
                        <div
                          className="w-full rounded-t-sm bg-[var(--primary)] transition-all"
                          style={{ height: `${Math.max(heightPct, 8)}%`, opacity: 0.3 + i * 0.3 }}
                        />
                        <span className="text-[0.6rem] text-[var(--muted-foreground)]">{item.month.slice(5)}月</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted-foreground)]">暂无金额数据</p>
              )}
            </div>

            {/* History summary */}
            <div>
              <h3 className="flex items-center gap-2 text-sm font-medium mb-3">
                <History className="size-4" />历史申报记录
              </h3>
              {profile.history.length > 0 ? (
                <div className="flex flex-col gap-1 max-h-52 overflow-y-auto">
                  {profile.history.map(h => (
                    <div key={h.year_month} className="flex items-center justify-between rounded px-3 py-1.5 text-xs hover:bg-[var(--muted)]">
                      <span>{h.year_month}</span>
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          h.archived === h.total ? "text-emerald-600" : "text-amber-600"
                        )}>
                          {h.archived === h.total ? <CheckCircle2 className="size-3 inline mr-1" /> : <Clock className="size-3 inline mr-1" />}
                          {h.archived}/{h.total} 归档
                        </span>
                        {h.total_amount > 0 && (
                          <span className="text-[var(--muted-foreground)] tabular-nums">฿{h.total_amount.toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted-foreground)]">暂无历史记录</p>
              )}
            </div>

            {/* Stats footer */}
            <div className="rounded-lg bg-[var(--muted)] p-3 text-xs text-[var(--muted-foreground)]">
              <div className="flex justify-between">
                <span>总记录</span>
                <span className="font-medium">{profile.totalRecords}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span>已归档</span>
                <span className="font-medium text-emerald-600">{profile.archivedCount}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span>未完成</span>
                <span className="font-medium text-amber-600">{profile.overdueCount}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
