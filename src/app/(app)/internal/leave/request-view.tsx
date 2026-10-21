"use client";

import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { toThaiTime } from "@/lib/utils";

interface LeaveRequest {
  id: number; employee_name: string; leave_type: string; start_date: string; end_date: string;
  start_time: string; end_time: string; destination: string; reason: string; status: string; created_at: string;
}

export function LeaveRequestView({ targetLeaveId }: { targetLeaveId: string }) {
  const { user } = useAuth();
  const [state, setState] = useState<{ key: string; row?: LeaveRequest; error?: string }>({ key: "" });
  const key = `${user?.name}:${targetLeaveId}`;
  useEffect(() => {
    const controller = new AbortController();
    if (!user || user.role !== "employee") return;
    const id = Number(targetLeaveId);
    if (!/^[1-9]\d*$/.test(targetLeaveId) || !Number.isSafeInteger(id)) {
      setState({ key, error: "请假编号无效。" }); return;
    }
    fetchWithAuth(`/api/leave/${encodeURIComponent(targetLeaveId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const row = await response.json();
        if (!response.ok) throw new Error(row.error || "请假记录加载失败，请重试。");
        if (row.id !== id || row.employee_name !== user.name) throw new Error("请假记录不存在或你无权查看。");
        if (!controller.signal.aborted) setState({ key, row });
      })
      .catch(error => { if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : "请假记录加载失败，请重试。" }); });
    return () => controller.abort();
  }, [targetLeaveId, user, key]);

  if (state.key !== key) return <p role="status">正在加载请假申请…</p>;
  if (state.error) return <p role="alert" className="text-sm text-red-600">{state.error}</p>;
  const row = state.row;
  if (!row) return null;
  return <section aria-label="我的请假申请" data-leave-id={row.id} className="min-w-0 space-y-4 rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">我的请假申请 #{row.id}</h2>
      <span className="rounded-full bg-blue-500/10 px-3 py-1 text-sm">{row.status}</span>
    </div>
    <dl className="space-y-3 text-sm [overflow-wrap:anywhere]">
      <div><dt className="text-[var(--muted-foreground)]">申请人</dt><dd>{row.employee_name}</dd></div>
      <div><dt className="text-[var(--muted-foreground)]">类型</dt><dd>{row.leave_type}</dd></div>
      <div><dt className="text-[var(--muted-foreground)]">日期</dt><dd>{row.start_date} {row.start_time} 至 {row.end_date} {row.end_time}</dd></div>
      <div><dt className="text-[var(--muted-foreground)]">地点</dt><dd>{row.destination || "—"}</dd></div>
      <div><dt className="text-[var(--muted-foreground)]">原因</dt><dd className="whitespace-pre-wrap">{row.reason || "—"}</dd></div>
      <div><dt className="text-[var(--muted-foreground)]">提交时间</dt><dd>{toThaiTime(row.created_at)}</dd></div>
    </dl>
  </section>;
}
