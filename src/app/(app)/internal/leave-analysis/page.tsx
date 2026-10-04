"use client";

import { useState, useEffect } from "react";
import { fetchWithAuth } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface LeaveRow {
  id: number;
  employee_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
  created_at: string;
  judgment: string | null;
  ai_reason: string;
  ai_detail: string;
  analyzed_at: string;
}

export default function LeaveAnalysisPage() {
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);
  const [detail, setDetail] = useState<LeaveRow | null>(null);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/leave/analysis", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "加载失败"); setLeaves([]); }
      else setLeaves(Array.isArray(data.leaves) ? data.leaves : []);
    } catch { setLeaves([]); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const batchAnalyze = async () => {
    setAnalyzing(true);
    setErr("");
    try {
      const res = await fetchWithAuth("/api/leave/analyze-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setErr(data.error || "分析失败");
    } catch (e) { setErr(e instanceof Error ? e.message : "分析失败"); }
    setAnalyzing(false);
    load();
  };

  const analyzeOne = async (id: number) => {
    setAnalyzingId(id);
    setErr("");
    try {
      const res = await fetchWithAuth("/api/leave/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setErr(data.error || "分析失败");
    } catch (e) { setErr(e instanceof Error ? e.message : "分析失败"); }
    setAnalyzingId(null);
    load();
  };

  const unanalyzed = leaves.filter((l) => !l.judgment).length;
  const suspicious = leaves.filter((l) => l.judgment === "疑似异常").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">请假 AI 分析</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            结合请假理由、日期、历史记录与个人情况判断是否疑似异常
            {suspicious > 0 && <span className="ml-2 text-red-600 dark:text-red-400 font-medium">疑似异常 {suspicious} 条</span>}
          </p>
        </div>
        <Button size="sm" onClick={batchAnalyze} disabled={analyzing}>
          {analyzing ? "分析中…" : `一键分析${unanalyzed > 0 ? `（未分析 ${unanalyzed} 条）` : ""}`}
        </Button>
      </div>

      {err && <p className="text-xs text-red-500">{err}</p>}

      {loading ? (
        <p className="text-sm text-[var(--muted-foreground)]">加载中…</p>
      ) : leaves.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">暂无请假记录</p>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                  <th className="py-2.5 px-3 text-left text-xs font-medium">员工</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium">类型</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium">日期</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium">理由</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium">AI 判断</th>
                  <th className="py-2.5 px-3 text-center text-xs font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {leaves.map((l) => (
                  <tr key={l.id} className={cn("border-b border-[var(--border)] last:border-0", l.judgment === "疑似异常" && "bg-red-50/70 dark:bg-red-950/10")}>
                    <td className="py-2.5 px-3 font-medium">{l.employee_name}</td>
                    <td className="py-2.5 px-3">{l.leave_type}</td>
                    <td className="py-2.5 px-3 text-xs text-[var(--muted-foreground)]">{l.start_date} ~ {l.end_date}</td>
                    <td className="py-2.5 px-3 text-xs text-[var(--muted-foreground)] max-w-xs truncate">{l.reason || "—"}</td>
                    <td className="py-2.5 px-3">
                      {l.judgment === "疑似异常" ? (
                        <button onClick={() => setDetail(l)} className="text-left block">
                          <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">疑似异常</span>
                          {l.ai_reason && <span className="ml-2 text-xs text-red-600 dark:text-red-400">{l.ai_reason}</span>}
                        </button>
                      ) : l.judgment === "正常" ? (
                        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">正常</span>
                      ) : (
                        <span className="text-xs text-[var(--muted-foreground)]">未分析</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {l.judgment ? (
                        <button onClick={() => setDetail(l)} className="text-xs text-blue-600 hover:underline">详情</button>
                      ) : (
                        <button onClick={() => analyzeOne(l.id)} disabled={analyzingId === l.id} className="text-xs text-blue-600 hover:underline disabled:opacity-50">
                          {analyzingId === l.id ? "分析中…" : "分析"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl max-w-lg w-full max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">AI 分析详情</h3>
              <button onClick={() => setDetail(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between gap-3"><span className="shrink-0 text-[var(--muted-foreground)]">员工</span><span className="text-right font-medium">{detail.employee_name}</span></div>
              <div className="flex justify-between gap-3"><span className="shrink-0 text-[var(--muted-foreground)]">请假</span><span className="text-right">{detail.leave_type} · {detail.start_date} ~ {detail.end_date}</span></div>
              <div className="flex justify-between gap-3"><span className="shrink-0 text-[var(--muted-foreground)]">理由</span><span className="text-right">{detail.reason || "—"}</span></div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--muted-foreground)]">判断</span>
                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", detail.judgment === "疑似异常" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300")}>{detail.judgment || "未分析"}</span>
              </div>
              {detail.ai_reason && (
                <div>
                  <span className="text-[var(--muted-foreground)] text-xs">简短理由</span>
                  <p className="mt-1 rounded bg-[var(--muted)]/30 p-2">{detail.ai_reason}</p>
                </div>
              )}
              {detail.ai_detail && (
                <div>
                  <span className="text-[var(--muted-foreground)] text-xs">详细分析（为什么这么判断、结合了哪些情况）</span>
                  <p className="mt-1 rounded bg-[var(--muted)]/30 p-2 whitespace-pre-wrap">{detail.ai_detail}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
