"use client";

import React, { useState, useEffect, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, fileUrl } from "@/lib/utils";
import { StepTimer } from "@/components/step-timer";
import {
  ArrowLeft, CheckCircle2, Clock, RotateCcw, Paperclip,
  MessageSquare, X, Loader2, Upload, Undo2, AlertTriangle, Ban, PauseCircle
} from "lucide-react";

// ===== Types =====
interface VatStep {
  id: number; record_id: number; step_name: string; step_order: number;
  status: string; assignee: string; notes: string; payment_status: string;
  started_at: string | null; completed_at: string | null; created_at: string;
}
interface VatStepNote {
  id: number; record_id: number; step_id: number;
  content: string; created_by: string; created_at: string;
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

  const [stepNotes, setStepNotes] = useState<Record<number, VatStepNote[]>>({});
  const [newNotes, setNewNotes] = useState<Record<number, string>>({});
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});

  const [stepUploading, setStepUploading] = useState<Record<number, boolean>>({});
  const [stepFileNames, setStepFileNames] = useState<Record<number, string>>({});
  const [stepUploadErrors, setStepUploadErrors] = useState<Record<number, string>>({});

  const [confirmingStepId, setConfirmingStepId] = useState<number | null>(null);
  const [editingAssignee, setEditingAssignee] = useState<number | null>(null);
  const [employeeList, setEmployeeList] = useState<string[]>([]);

  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey(k => k + 1), []);

  // 加载员工列表
  useEffect(() => {
    fetchWithAuth("/api/employees").then(r => r.json())
      .then((data: any[]) => setEmployeeList(data.map(e => e.name).filter(Boolean)))
      .catch(() => {});
  }, []);

  // 加载记录
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

        const notesMap: Record<number, VatStepNote[]> = {};
        await Promise.all(sts.map(async (s: VatStep) => {
          try {
            const nr = await fetchWithAuth(`/api/vat/records/${id}/steps/${s.id}/notes`);
            notesMap[s.id] = await nr.json();
          } catch { notesMap[s.id] = []; }
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

  // ===== 步骤操作 =====
  const handleStart = async (stepId: number) => {
    try {
      const res = await fetchWithAuth(`/api/vat/records/${id}/steps`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: stepId, status: "进行中" }),
      });
      if (!res.ok) { const e = await res.json(); setError(e.error || "开始失败"); return; }
      reload();
    } catch (e) { setError(e instanceof Error ? e.message : "开始失败"); }
  };

  const handleConfirmComplete = async (stepId: number) => {
    const noteContent = newNotes[stepId]?.trim();
    setConfirmingStepId(null);
    setNewNotes(p => ({ ...p, [stepId]: "" }));
    try {
      if (noteContent) {
        await fetchWithAuth(`/api/vat/records/${id}/steps/${stepId}/notes`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: noteContent, created_by: user?.name || "系统" }),
        });
      }
      const res = await fetchWithAuth(`/api/vat/records/${id}/steps`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: stepId, status: "已完成" }),
      });
      if (!res.ok) { const e = await res.json(); setError(e.error || "完成失败"); return; }
      reload();
    } catch (e) { setError(e instanceof Error ? e.message : "完成失败"); }
  };

  const handleRollback = async (stepId: number) => {
    try {
      const res = await fetchWithAuth(`/api/vat/records/${id}/steps`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: stepId, status: "进行中" }),
      });
      if (!res.ok) { const e = await res.json(); setError(e.error || "撤回失败"); return; }
      reload();
    } catch (e) { setError(e instanceof Error ? e.message : "撤回失败"); }
  };

  const handleBlock = async (stepId: number) => {
    try {
      const res = await fetchWithAuth(`/api/vat/records/${id}/steps`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: stepId, status: "阻塞" }),
      });
      if (!res.ok) { const e = await res.json(); setError(e.error || "操作失败"); return; }
      reload();
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
  };

  const handleAddNote = async (stepId: number) => {
    const content = newNotes[stepId]?.trim();
    if (!content) return;
    try {
      await fetchWithAuth(`/api/vat/records/${id}/steps/${stepId}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, created_by: user?.name || "系统" }),
      });
      setNewNotes(p => ({ ...p, [stepId]: "" }));
      const notes = await fetchWithAuth(`/api/vat/records/${id}/steps/${stepId}/notes`).then(r => r.json());
      setStepNotes(p => ({ ...p, [stepId]: notes }));
    } catch { setError("添加备注失败"); }
  };

  const handleDeleteNote = async (stepId: number, noteId: number) => {
    if (!confirm("确认删除这条备注？")) return;
    try {
      await fetchWithAuth(`/api/vat/records/${id}/steps/${stepId}/notes?id=${noteId}`, { method: "DELETE" });
      const notes = await fetchWithAuth(`/api/vat/records/${id}/steps/${stepId}/notes`).then(r => r.json());
      setStepNotes(p => ({ ...p, [stepId]: notes }));
    } catch { setError("删除备注失败"); }
  };

  const handleStepUpload = async (stepId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStepUploading(p => ({ ...p, [stepId]: true }));
    setStepFileNames(p => ({ ...p, [stepId]: file.name }));
    setStepUploadErrors(p => ({ ...p, [stepId]: "" }));
    try {
      const fd = new FormData(); fd.append("file", file);
      const ur = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
      if (!ur.ok) throw new Error("上传失败");
      const { url } = await ur.json();
      const note = `📎 ${file.name}\n${window.location.origin}/api/files/${url}`;
      const nr = await fetchWithAuth(`/api/vat/records/${id}/steps/${stepId}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: note, created_by: user?.name || "系统" }),
      });
      if (!nr.ok) throw new Error("保存失败");
      setStepUploadErrors(p => ({ ...p, [stepId]: "" }));
      reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStepUploadErrors(p => ({ ...p, [stepId]: msg }));
      setError(msg);
    } finally {
      setStepUploading(p => ({ ...p, [stepId]: false }));
      e.target.value = "";
    }
  };

  const handleAssign = async (stepId: number, newAssignee: string) => {
    setEditingAssignee(null);
    try {
      const res = await fetchWithAuth(`/api/vat/records/${id}/steps`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: stepId, assignee: newAssignee }),
      });
      if (!res.ok) { const e = await res.json(); setError(e.error || "修改失败"); return; }
      reload();
    } catch (e) { setError(e instanceof Error ? e.message : "修改失败"); }
  };

  const toggleExpand = (stepId: number) => {
    setExpandedSteps(p => ({ ...p, [stepId]: !p[stepId] }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (error && !record) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-[var(--muted-foreground)]">{error}</p>
        <Button variant="ghost" size="sm" className="mt-4" onClick={() => router.back()}>返回</Button>
      </div>
    );
  }

  if (!record) return null;

  const completedCount = steps.filter(s => s.status === "已完成").length;

  return (
    <div className="flex flex-col gap-6">
      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-[var(--destructive)] bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] px-4 py-3 text-sm text-[var(--destructive)] flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-3 hover:opacity-70 text-lg leading-none">&times;</button>
        </div>
      )}

      {/* Header */}
      <div>
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
      </div>

      {/* Step list — 时间轴样式，对标订单详情页 */}
      {steps.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">暂无步骤</p>
      ) : (
        <div className="flex flex-col gap-0">
          {steps.map((step, i) => {
            const notes = stepNotes[step.id] || [];
            const isDone = step.status === "已完成";
            const isActive = step.status === "进行中";
            const isPending = step.status === "待处理";
            const hasNotes = notes.length > 0;

            // 是否阻塞：前一步没完成（第一步除外）
            const prevStep = i > 0 ? steps[i - 1] : null;
            const prevDone = !prevStep || prevStep.status === "已完成";
            const canStart = isPending && (i === 0 || prevDone);
            const canComplete = isActive && (i === 0 || prevDone);

            return (
              <div key={step.id} className="flex gap-3">
                {/* Timeline dot + line */}
                <div className="flex flex-col items-center">
                  <div className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                    isDone && "bg-[var(--success)] text-[var(--success-foreground)]",
                    isActive && "bg-[var(--primary)] text-[var(--primary-foreground)] ring-2 ring-[var(--ring)]/30",
                    isPending && "bg-[var(--muted)] text-[var(--muted-foreground)]"
                  )}>
                    {isDone ? "✓" : step.step_order}
                  </div>
                  {i < steps.length - 1 && (
                    <div className={cn("w-px flex-1 min-h-[20px]", isDone ? "bg-[var(--success)]" : "bg-[var(--border)]")} />
                  )}
                </div>

                {/* Step card */}
                <div className="pb-5 flex-1">
                  {/* Step header line */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("text-sm font-medium", isDone && "line-through text-[var(--muted-foreground)]")}>
                      {step.step_order}. {step.step_name}
                    </span>

                    {/* Payment status for step 5 */}
                    {step.step_order === 5 && step.payment_status && (
                      <span className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                        step.payment_status === "已付款" ? "bg-[var(--success)] text-[var(--success-foreground)]" :
                        step.payment_status === "逾期未付" ? "bg-[var(--destructive)] text-[var(--destructive-foreground)]" :
                        "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                      )}>
                        {step.payment_status}
                      </span>
                    )}
                  </div>

                  {/* Assignee + timer */}
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted-foreground)] flex-wrap">
                    {/* Assignee — clickable to change */}
                    {editingAssignee === step.id ? (
                      <select
                        className="rounded border px-1.5 py-0.5 text-xs"
                        value={step.assignee || ""}
                        onChange={e => handleAssign(step.id, e.target.value)}
                        onBlur={() => setEditingAssignee(null)}
                        autoFocus
                      >
                        <option value="">—</option>
                        {employeeList.filter(n => n).map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    ) : (
                      <button
                        onClick={() => setEditingAssignee(step.id)}
                        className="hover:text-[var(--primary)] hover:underline cursor-pointer"
                      >
                        {step.assignee || "未分配"}
                      </button>
                    )}
                  </div>

                  {/* Action buttons + timer */}
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    {/* 待处理 */}
                    {isPending && !canStart && (
                      <span className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] opacity-50 cursor-not-allowed select-none">需先完成前一步</span>
                    )}
                    {isPending && canStart && (
                      <button onClick={() => handleStart(step.id)}
                        className="rounded border border-[color-mix(in_oklch,var(--primary),var(--background)_70%)] bg-[color-mix(in_oklch,var(--primary),var(--background)_92%)] px-2 py-1 text-xs text-[var(--primary)] hover:bg-[color-mix(in_oklch,var(--primary),var(--background)_85%)] transition-colors">
                        开始
                      </button>
                    )}

                    {/* 进行中 */}
                    {isActive && (
                      <>
                        {confirmingStepId === step.id ? (
                          <>
                            <input
                              className="w-32 rounded border px-2 py-0.5 text-xs"
                              placeholder="备注(可选)"
                              value={newNotes[step.id] || ""}
                              onChange={e => setNewNotes(p => ({ ...p, [step.id]: e.target.value }))}
                              onKeyDown={e => { if (e.key === "Enter") handleConfirmComplete(step.id); if (e.key === "Escape") setConfirmingStepId(null); }}
                              autoFocus
                            />
                            <button onClick={() => handleConfirmComplete(step.id)}
                              className="rounded px-2 py-0.5 text-xs bg-[var(--success)] text-[var(--success-foreground)] hover:bg-[color-mix(in_oklch,var(--success),var(--foreground)_20%)] transition-colors">确认完成</button>
                            <button onClick={() => { setConfirmingStepId(null); setNewNotes(p => ({ ...p, [step.id]: "" })); }}
                              className="rounded px-2 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">取消</button>
                          </>
                        ) : (
                          <>
                            {canComplete ? (
                              <button onClick={() => setConfirmingStepId(step.id)}
                                className="rounded border border-[color-mix(in_oklch,var(--success),var(--background)_70%)] bg-[color-mix(in_oklch,var(--success),var(--background)_92%)] px-2 py-1 text-xs text-[var(--success)] hover:bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] transition-colors">标记完成</button>
                            ) : (
                              <span className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] opacity-50 cursor-not-allowed select-none">需先完成前一步</span>
                            )}
                            <button onClick={() => handleBlock(step.id)}
                              className="rounded border border-[color-mix(in_oklch,var(--destructive),var(--background)_70%)] bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] px-2 py-1 text-xs text-[var(--destructive)] hover:bg-[color-mix(in_oklch,var(--destructive),var(--background)_85%)] transition-colors">
                              <PauseCircle className="size-3 mr-0.5" />标记阻塞
                            </button>
                          </>
                        )}
                        <StepTimer created_at={step.created_at} completed_at={step.completed_at} status={step.status}
                          prev_completed_at={i > 0 ? steps[i - 1].completed_at : null} started_at={step.started_at} className="ml-1" />
                      </>
                    )}

                    {/* 已完成 / 阻塞 */}
                    {(isDone && (
                      <div className="flex items-center gap-2">
                        <StepTimer created_at={step.created_at} completed_at={step.completed_at} status="已完成"
                          prev_completed_at={i > 0 ? steps[i - 1].completed_at : null} started_at={step.started_at} />
                        {step.completed_at && (
                          <span className="text-xs text-[var(--muted-foreground)]">
                            {step.completed_at.slice(0, 16)}
                          </span>
                        )}
                        <button onClick={() => handleRollback(step.id)}
                          className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
                          <Undo2 className="size-3" />撤回
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* File upload button */}
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <label className={cn(
                      "shrink-0 cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors inline-flex items-center gap-1",
                      stepUploading[step.id] && "opacity-50 pointer-events-none"
                    )}>
                      <Upload className="size-3" />
                      {stepUploading[step.id] ? stepFileNames[step.id] || "上传中..." : "附件"}
                      <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx"
                        onChange={e => handleStepUpload(step.id, e)} disabled={stepUploading[step.id]} />
                    </label>
                    {stepUploadErrors[step.id] && (
                      <span className="text-xs text-[var(--destructive)]">{stepUploadErrors[step.id]}</span>
                    )}
                  </div>

                  {/* Notes toggle */}
                  <button onClick={() => toggleExpand(step.id)}
                    className="mt-1 flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
                    <MessageSquare className="size-3" />
                    {hasNotes && <span className="rounded-full bg-[var(--muted)] px-1.5 text-[0.65rem]">{notes.length}</span>}
                    {expandedSteps[step.id] ? "收起" : "备注"}
                  </button>

                  {/* Expanded notes area */}
                  {expandedSteps[step.id] && (
                    <div className="mt-3 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                      {/* Notes list */}
                      {notes.length > 0 && (
                        <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                          {notes.map(note => {
                            const fileMatch = note.content.match(/📎\s+(.+?)\n([\s\S]+)/);
                            if (fileMatch) {
                              const fileName = fileMatch[1];
                              const url = fileMatch[2].trim();
                              const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName);
                              return (
                                <div key={note.id} className="flex items-center justify-between rounded bg-[var(--muted)] px-3 py-2 text-xs group">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Paperclip className="size-3 text-[var(--muted-foreground)] shrink-0" />
                                    <span className="truncate">{fileName}</span>
                                    <a href={fileUrl(url)} target="_blank" rel="noopener noreferrer"
                                      className="text-[var(--primary)] hover:underline shrink-0">
                                      {isImg ? "预览" : "查看"}
                                    </a>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-[var(--muted-foreground)]">{note.created_by} · {note.created_at?.slice(0, 16)}</span>
                                    <button onClick={() => handleDeleteNote(step.id, note.id)}
                                      className="opacity-0 group-hover:opacity-100 text-[var(--destructive)] hover:text-[var(--destructive)] transition-opacity">
                                      <X className="size-3" />
                                    </button>
                                  </div>
                                </div>
                              );
                            }
                            return (
                              <div key={note.id} className="flex items-start justify-between rounded bg-[var(--muted)] px-3 py-2 text-xs group">
                                <span className="flex-1 whitespace-pre-wrap break-all">{note.content}</span>
                                <div className="flex items-center gap-2 shrink-0 ml-2">
                                  <span className="text-[var(--muted-foreground)] whitespace-nowrap">{note.created_by} · {note.created_at?.slice(0, 16)}</span>
                                  <button onClick={() => handleDeleteNote(step.id, note.id)}
                                    className="opacity-0 group-hover:opacity-100 text-[var(--destructive)] hover:text-[var(--destructive)] transition-opacity">
                                    <X className="size-3" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Add note input */}
                      <div className="flex items-center gap-2">
                        <input
                          className="flex-1 rounded border px-2 py-1.5 text-xs"
                          placeholder="添加备注..."
                          value={newNotes[step.id] || ""}
                          onChange={e => setNewNotes(p => ({ ...p, [step.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === "Enter") handleAddNote(step.id); }}
                        />
                        <Button size="xs" variant="ghost" onClick={() => handleAddNote(step.id)}>
                          <MessageSquare className="size-3" />
                        </Button>
                      </div>

                      {/* Payment status toggle (step 5 only) */}
                      {step.step_order === 5 && (
                        <div className="border-t pt-2.5 mt-1">
                          <p className="text-xs text-[var(--muted-foreground)] mb-1.5">付款状态:</p>
                          <div className="flex gap-1.5">
                            {PAYMENT_STATUSES.map(ps => (
                              <button key={ps.value}
                                onClick={async () => {
                                  try {
                                    const res = await fetchWithAuth(`/api/vat/records/${id}/steps`, {
                                      method: "PATCH", headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ step_id: step.id, payment_status: ps.value }),
                                    });
                                    if (!res.ok) { const e = await res.json(); setError(e.error || "更新失败"); return; }
                                    reload();
                                  } catch (e) { setError(e instanceof Error ? e.message : "更新失败"); }
                                }}
                                className={cn(
                                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                                  step.payment_status === ps.value
                                    ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                                    : "border hover:bg-[var(--muted)]"
                                )}
                              >
                                {ps.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
