"use client";

import React, { useState, useEffect, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { StepTimeline, type TimelineStep, type TimelineNote, type TimelineEmployee } from "@/components/step-timeline";
import { ArrowLeft, Loader2 } from "lucide-react";

// ===== Types =====
interface VatStep {
  id: number; record_id: number; step_name: string; step_order: number;
  status: string; assignee: string; payment_status: string;
  started_at: string | null; completed_at: string | null; created_at: string;
}
interface VatRecordDetail {
  id: number; customer_id: number; year_month: string; progress: string;
  amount: number; assignee: string; company_name: string; tax_id: string;
  steps: VatStep[];
}

const PAYMENT_STATUSES = [
  { value: "通知客户付款", label: "通知客户付款" },
  { value: "已付款", label: "已付款" },
  { value: "逾期未付", label: "逾期未付" },
];

export default function VatRecordDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();

  const [record, setRecord] = useState<VatRecordDetail | null>(null);
  const [steps, setSteps] = useState<VatStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [stepNotes, setStepNotes] = useState<Record<number, TimelineNote[]>>({});
  const [employees, setEmployees] = useState<TimelineEmployee[]>([]);

  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey(k => k + 1), []);

  // load employees
  useEffect(() => {
    fetchWithAuth("/api/employees").then(r => r.json())
      .then((data: any[]) => setEmployees(data.map((e: any) => ({ id: e.id, name: e.name })).filter((e: TimelineEmployee) => e.name)))
      .catch(() => {});
  }, []);

  // load record + steps + notes
  useEffect(() => {
    let ignore = false;
    async function run() {
      try {
        const res = await fetchWithAuth(`/api/vat/records/${id}`);
        const data = await res.json();
        if (ignore) return;
        if (data.error) { setError(data.error); setLoading(false); return; }
        setRecord(data);
        const sts = data.steps || [];
        setSteps(sts);

        const notesMap: Record<number, TimelineNote[]> = {};
        await Promise.all(sts.map(async (s: VatStep) => {
          try { notesMap[s.id] = await fetchWithAuth(`/api/vat/records/${id}/steps/${s.id}/notes`).then(r => r.json()); }
          catch { notesMap[s.id] = []; }
        }));
        if (!ignore) setStepNotes(notesMap);
      } catch {
        if (!ignore) setError("加载记录失败");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    run();
    return () => { ignore = true; };
  }, [id, refreshKey]);

  // ===== Callbacks for StepTimeline =====
  const handleStart = useCallback(async (stepId: number) => {
    const res = await fetchWithAuth(`/api/vat/records/${id}/steps`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step_id: stepId, status: "进行中" }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || "开始失败"); }
    reload();
  }, [id, reload]);

  const handleComplete = useCallback(async (stepId: number, note?: string) => {
    if (note) {
      await fetchWithAuth(`/api/vat/records/${id}/steps/${stepId}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: note, created_by: user?.name || "系统" }),
      });
    }
    const res = await fetchWithAuth(`/api/vat/records/${id}/steps`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step_id: stepId, status: "已完成" }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || "完成失败"); }
    reload();
  }, [id, reload, user]);

  const handleRollback = useCallback(async (stepId: number) => {
    const res = await fetchWithAuth(`/api/vat/records/${id}/steps`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step_id: stepId, status: "进行中" }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || "撤回失败"); }
    reload();
  }, [id, reload]);

  const handleBlock = useCallback(async (stepId: number) => {
    const res = await fetchWithAuth(`/api/vat/records/${id}/steps`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step_id: stepId, status: "阻塞" }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || "操作失败"); }
    reload();
  }, [id, reload]);

  const handleUpload = useCallback(async (stepId: number, file: File) => {
    const fd = new FormData(); fd.append("file", file);
    const ur = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
    if (!ur.ok) throw new Error("上传失败");
    const { url } = await ur.json();
    const note = `上传文件: ${file.name} (/api/files/${url})`;
    const nr = await fetchWithAuth(`/api/vat/records/${id}/steps/${stepId}/notes`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: note, created_by: user?.name || "系统" }),
    });
    if (!nr.ok) throw new Error("保存失败");
    reload();
  }, [id, reload, user]);

  const handleAddNote = useCallback(async (stepId: number, content: string) => {
    await fetchWithAuth(`/api/vat/records/${id}/steps/${stepId}/notes`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, created_by: user?.name || "系统" }),
    });
    reload();
  }, [id, reload, user]);

  const handleDeleteNote = useCallback(async (stepId: number, noteId: number) => {
    await fetchWithAuth(`/api/vat/records/${id}/steps/${stepId}/notes?id=${noteId}`, { method: "DELETE" });
    reload();
  }, [id, reload]);

  const handleAssigneeChange = useCallback(async (stepId: number, assignee: string) => {
    const res = await fetchWithAuth(`/api/vat/records/${id}/steps`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step_id: stepId, assignee }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || "修改失败"); }
    reload();
  }, [id, reload]);

  // ===== Timeline steps — add payment_status for badge ====
  const timelineSteps: TimelineStep[] = steps;

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="size-6 animate-spin text-[var(--muted-foreground)]" /></div>;

  if (error && !record) return (
    <div className="flex flex-col items-center justify-center py-20">
      <p className="text-sm text-[var(--muted-foreground)]">{error}</p>
      <Button variant="ghost" size="sm" className="mt-4" onClick={() => router.back()}>返回</Button>
    </div>
  );

  if (!record) return null;

  const completedCount = steps.filter(s => s.status === "已完成").length;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.back()} aria-label="返回"><ArrowLeft className="size-4" /></Button>
        <div className="flex-1">
          <h1 className="font-display text-2xl font-light tracking-tight">{record.company_name}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-[var(--muted-foreground)] flex-wrap">
            <span>{record.year_month}</span>
            <span>· 税号: {record.tax_id || "—"}</span>
            <span>· {completedCount}/{steps.length} 已完成</span>
            {completedCount === steps.length && (
              <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-[var(--success)] text-[var(--success-foreground)]">已归档</span>
            )}
          </div>
        </div>
      </div>

      {/* Steps via shared component */}
      <StepTimeline
        steps={timelineSteps}
        stepNotes={stepNotes}
        employees={employees}
        onStart={handleStart}
        onComplete={handleComplete}
        onRollback={handleRollback}
        onBlock={handleBlock}
        onUpload={handleUpload}
        onAddNote={handleAddNote}
        onDeleteNote={handleDeleteNote}
        onAssigneeChange={handleAssigneeChange}
        renderHeaderBadges={(step) => (
          step.payment_status ? (
            <span className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
              step.payment_status === "已付款" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]" :
              step.payment_status === "逾期未付" ? "bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] text-[var(--destructive)]" :
              "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]"
            )}>{step.payment_status}</span>
          ) : null
        )}
        renderExpandedExtra={(step) => (
          step.step_order === 5 ? (
            <div className="border-t border-[var(--border)] pt-3">
              <h4 className="mb-2 text-xs font-medium text-[var(--foreground)]">付款状态</h4>
              <div className="flex gap-1.5">
                {PAYMENT_STATUSES.map(ps => (
                  <button key={ps.value}
                    onClick={async () => {
                      try {
                        const res = await fetchWithAuth(`/api/vat/records/${id}/steps`, {
                          method: "PATCH", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ step_id: step.id, payment_status: ps.value }),
                        });
                        if (res.ok) reload();
                      } catch {}
                    }}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium transition-colors border",
                      step.payment_status === ps.value
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                        : "border-[var(--border)] hover:bg-[var(--muted)]"
                    )}
                  >{ps.label}</button>
                ))}
              </div>
            </div>
          ) : null
        )}
      />
    </div>
  );
}

// helper for cn
function cn(...args: any[]) {
  return args.filter(Boolean).join(" ");
}
