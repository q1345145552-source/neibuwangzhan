"use client";

import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { toThaiTime } from "@/lib/utils";

interface AttendanceRequest {
  id: number; employee_name: string; date: string; time: string; type: string; reason: string;
  status: string; approved_by: string; approved_at: string; created_at: string;
}

export function AttendanceRequestView({ targetRequestId }: { targetRequestId: string }) {
  const { user } = useAuth();
  const [state, setState] = useState<{ key: string; row?: AttendanceRequest; error?: string }>({ key: "" });
  const key = `${user?.name}:${targetRequestId}`;
  useEffect(() => {
    const controller = new AbortController();
    if (!user || user.role !== "employee") return;
    const id = Number(targetRequestId);
    if (!/^[1-9]\d*$/.test(targetRequestId) || !Number.isSafeInteger(id)) {
      setState({ key, error: "补签申请编号无效。" }); return;
    }
    fetchWithAuth(`/api/attendance/request/${encodeURIComponent(targetRequestId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const row = await response.json();
        if (!response.ok) throw new Error(row.error || "补签申请加载失败，请重试。");
        if (row.id !== id || row.employee_name !== user.name) throw new Error("补签申请不存在或你无权查看。");
        if (!controller.signal.aborted) setState({ key, row });
      })
      .catch(error => { if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : "补签申请加载失败，请重试。" }); });
    return () => controller.abort();
  }, [targetRequestId, user, key]);

  if (state.key !== key) return <p role="status">正在加载补签申请…</p>;
  if (state.error) return <p role="alert" className="text-sm text-red-600">{state.error}</p>;
  const row = state.row;
  if (!row) return null;
  return <section id="attendance-requests" aria-label="我的补签申请" data-attendance-request-id={row.id} className="min-w-0 space-y-4 rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">我的补签申请 #{row.id}</h2>
      <span className="rounded-full bg-blue-500/10 px-3 py-1 text-sm">{row.status}</span>
    </div>
    <dl className="space-y-3 text-sm [overflow-wrap:anywhere]">
      <div><dt className="text-[var(--muted-foreground)]">申请人</dt><dd>{row.employee_name}</dd></div>
      <div><dt className="text-[var(--muted-foreground)]">申请补签时间</dt><dd>{row.date} {row.time}</dd></div>
      <div><dt className="text-[var(--muted-foreground)]">原因</dt><dd className="whitespace-pre-wrap">{row.reason || "—"}</dd></div>
      <div><dt className="text-[var(--muted-foreground)]">提交时间</dt><dd>{toThaiTime(row.created_at)}</dd></div>
      {row.approved_by && <div><dt className="text-[var(--muted-foreground)]">审批人</dt><dd>{row.approved_by}</dd></div>}
      {row.approved_at && <div><dt className="text-[var(--muted-foreground)]">审批时间</dt><dd>{toThaiTime(row.approved_at)}</dd></div>}
    </dl>
  </section>;
}
