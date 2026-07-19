"use client";

import React, { useState, useEffect, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, fileUrl } from "@/lib/utils";
import { StepTimer } from "@/components/step-timer";
import { ArrowLeft, CheckCircle2, Clock, Timer, RotateCcw, Paperclip, MessageSquare, X, Loader2, AlertCircle, FileText, Download, Eye, Image, Upload } from "lucide-react";

// Types
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

const DEFAULT_ASSIGNEES: Record<number, string> = {
  1: "Eve", 2: "Eve", 3: "Eve",
  4: "Pop", 5: "Pop", 6: "Pop",
};

const PAYMENT_STATUSES = [
  { value: "通知客户付款", label: "通知客户付款", color: "bg-[color-mix(in_oklch,var(--warning),var(--background)_20%)] text-[var(--warning-foreground)]" },
  { value: "已付款", label: "已付款", color: "bg-[var(--success)] text-[var(--success-foreground)]" },
  { value: "逾期未付", label: "逾期未付", color: "bg-[var(--destructive)] text-[var(--destructive-foreground)]" },
];

export default function VatRecordDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();

  const [record, setRecord] = useState<VatRecordDetail | null>(null);
  const [steps, setSteps] = useState<VatStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Step notes
  const [stepNotes, setStepNotes] = useState<Record<number, VatStepNote[]>>({});
  const [newNotes, setNewNotes] = useState<Record<number, string>>({});
  const [showNotes, setShowNotes] = useState<Record<number, boolean>>({});

  // File upload
  const [stepUploading, setStepUploading] = useState<Record<number, boolean>>({});
  const [stepFileNames, setStepFileNames] = useState<Record<number, string>>({});
  const [stepUploadErrors, setStepUploadErrors] = useState<Record<number, string>>({});

  // Step actions
  const [confirmingStepId, setConfirmingStepId] = useState<number | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});

  const reload = useCallback(() => setRefreshKey(k => k + 1), []);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load record
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

        // Load notes for all steps
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

  const toggleExpand = (stepId: number) => {
    setExpandedSteps(p => ({ ...p, [stepId]: !p[stepId] }));
    setShowNotes(p => ({ ...p, [stepId]: true }));
  };

  // Step actions
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
      // Auto-start next step
      const idx = steps.findIndex(s => s.id === stepId);
      const next = idx >= 0 && idx < steps.length - 1 ? steps[idx + 1] : null;
      if (next && next.status === "待处理") {
        await fetchWithAuth(`/api/vat/records/${id}/steps`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step_id: next.id, status: "进行中" }),
        });
      }
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

  // File upload for steps
  const handleStepUpload = async (stepId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStepUploading(p => ({ ...p, [stepId]: true }));
    setStepUploadErrors(p => ({ ...p, [stepId]: "" }));
    setStepFileNames(p => ({ ...p, [stepId]: file.name }));
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetchWithAuth("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "上传失败");
      }
      const uploadResult = await res.json();
      const fileUrl = uploadResult.url || uploadResult.file_url || "";
      // Add as a note with file link
      const noteContent = `📎 ${file.name}\n` + (fileUrl ? `${window.location.origin}/api/files/${fileUrl}` : "");
      await fetchWithAuth(`/api/vat/records/${id}/steps/${stepId}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteContent, created_by: user?.name || "系统" }),
      });
      const notes = await fetchWithAuth(`/api/vat/records/${id}/steps/${stepId}/notes`).then(r => r.json());
      setStepNotes(p => ({ ...p, [stepId]: notes }));
      setStepUploadErrors(p => ({ ...p, [stepId]: "" }));
    } catch (err) {
      setStepUploadErrors(p => ({ ...p, [stepId]: err instanceof Error ? err.message : "上传失败" }));
    } finally {
      setStepUploading(p => ({ ...p, [stepId]: false }));
      e.target.value = "";
    }
  };

  // Payment status update for step 5
  const handlePaymentStatus = async (stepId: number, payment_status: string) => {
    try {
      const res = await fetchWithAuth(`/api/vat/records/${id}/steps`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: stepId, payment_status }),
      });
      if (!res.ok) { const e = await res.json(); setError(e.error || "更新失败"); return; }
      reload();
    } catch (e) { setError(e instanceof Error ? e.message : "更新失败"); }
  };

  // Change assignee
  const handleAssign = async (stepId: number, newAssignee: string) => {
    try {
      const res = await fetchWithAuth(`/api/vat/records/${id}/steps`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: stepId, assignee: newAssignee }),
      });
      if (!res.ok) { const e = await res.json(); setError(e.error || "修改失败"); return; }
      reload();
    } catch (e) { setError(e instanceof Error ? e.message : "修改失败"); }
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

  const allDone = steps.length > 0 && steps.every(s => s.status === "已完成");
  const completedCount = steps.filter(s => s.status === "已完成").length;

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-lg border border-[var(--destructive)] bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] px-4 py-3 text-sm text-[var(--destructive)] flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-3 hover:opacity-70 text-lg leading-none">&times;</button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.back()}><ArrowLeft className="size-4" /></Button>
        <div className="flex-1">
          <h1 className="font-display text-2xl font-light tracking-tight">{record.company_name}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <span>{record.year_month}</span>
            <span>· 税号: {record.tax_id || "—"}</span>
            <span>· {completedCount}/{steps.length} 已完成</span>
            {allDone && <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-[var(--success)] text-[var(--success-foreground)]">已归档</span>}
          </div>
        </div>
      </div>

      {/* Step list */}
      <div className="flex flex-col gap-3">
        {steps.map((step) => {
          const isActive = step.status === "进行中";
          const isDone = step.status === "已完成";
          const isPending = step.status === "待处理";
          const expanded = expandedSteps[step.id] || false;
          const notes = stepNotes[step.id] || [];
          const prevStep = steps[step.step_order - 2]; // previous step (0-indexed)
          const prevCompleted = prevStep?.completed_at || null;

          return (
            <div key={step.id}
              className={cn(
                "rounded-lg border transition-colors",
                isActive ? "border-[var(--primary)] bg-[color-mix(in_oklch,var(--primary),var(--background)_96%)]" :
                isDone ? "border-[var(--border)] bg-[var(--card)] opacity-80" :
                "border-[var(--border)] bg-[var(--card)]"
              )}
            >
              {/* Step header - always visible */}
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
                onClick={() => toggleExpand(step.id)}
              >
                {/* Status icon */}
                {isDone ? <CheckCircle2 className="size-5 text-[var(--success)] shrink-0" /> :
                 isActive ? <div className="relative shrink-0"><Timer className="size-5 text-emerald-500" /><span className="absolute -right-1 -top-1 flex size-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex size-2 rounded-full bg-emerald-500" /></span></div> :
                 <Clock className="size-5 text-[var(--muted-foreground)]/40 shrink-0" />}

                {/* Step info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("text-sm font-medium", isDone && "line-through text-[var(--muted-foreground)]")}>
                      {step.step_order}. {step.step_name}
                    </span>
                    {/* Payment status for step 5 */}
                    {step.step_order === 5 && step.payment_status && (
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                        PAYMENT_STATUSES.find(p => p.value === step.payment_status)?.color || ""
                      )}>
                        {step.payment_status}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-[var(--muted-foreground)]">
                    <span>{step.assignee || "—"}</span>
                    <StepTimer
                      created_at={step.created_at}
                      started_at={step.started_at}
                      completed_at={step.completed_at}
                      status={step.status}
                      prev_completed_at={prevCompleted}
                    />
                    {notes.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare className="size-3" />{notes.length}
                      </span>
                    )}
                  </div>
                </div>

                {/* Quick actions */}
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  {isPending && (
                    <Button size="xs" variant="ghost" onClick={() => handleStart(step.id)} className="text-xs">
                      开始
                    </Button>
                  )}
                  {isActive && (
                    <>
                      {confirmingStepId === step.id ? (
                        <div className="flex items-center gap-1">
                          <input className="w-32 rounded border px-2 py-1 text-xs" placeholder="备注(可选)"
                            value={newNotes[step.id] || ""}
                            onChange={e => setNewNotes(p => ({ ...p, [step.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter") handleConfirmComplete(step.id); if (e.key === "Escape") setConfirmingStepId(null); }}
                            autoFocus
                          />
                          <Button size="xs" onClick={() => handleConfirmComplete(step.id)} className="text-xs bg-[var(--success)] text-[var(--success-foreground)]">确认</Button>
                          <Button size="xs" variant="ghost" onClick={() => setConfirmingStepId(null)}><X className="size-3" /></Button>
                        </div>
                      ) : (
                        <Button size="xs" variant="ghost" onClick={() => setConfirmingStepId(step.id)} className="text-xs">
                          <CheckCircle2 className="size-3 mr-1" />标记完成
                        </Button>
                      )}
                    </>
                  )}
                  {isDone && (
                    <Button size="xs" variant="ghost" onClick={() => handleRollback(step.id)} className="text-xs text-[var(--muted-foreground)]">
                      <RotateCcw className="size-3 mr-1" />撤回
                    </Button>
                  )}
                </div>
              </div>

              {/* Expanded content */}
              {expanded && (
                <div className="border-t px-4 py-3 flex flex-col gap-3 bg-[var(--card)]">
                  {/* Assignee */}
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--muted-foreground)]">负责人:</span>
                    <input
                      className="rounded border px-2 py-1 text-xs w-28"
                      value={step.assignee || ""}
                      onChange={e => handleAssign(step.id, e.target.value)}
                      onBlur={e => { if (e.target.value !== step.assignee) handleAssign(step.id, e.target.value); }}
                      placeholder="输入名字"
                    />
                    {step.step_order <= 3 && step.assignee !== DEFAULT_ASSIGNEES[step.step_order] && (
                      <Button size="xs" variant="ghost" className="text-[0.6rem]" onClick={() => handleAssign(step.id, DEFAULT_ASSIGNEES[step.step_order])}>
                        重置为 {DEFAULT_ASSIGNEES[step.step_order]}
                      </Button>
                    )}
                    {step.step_order >= 4 && step.assignee !== DEFAULT_ASSIGNEES[step.step_order] && (
                      <Button size="xs" variant="ghost" className="text-[0.6rem]" onClick={() => handleAssign(step.id, DEFAULT_ASSIGNEES[step.step_order])}>
                        重置为 {DEFAULT_ASSIGNEES[step.step_order]}
                      </Button>
                    )}
                  </div>

                  {/* Payment status for step 5 */}
                  {step.step_order === 5 && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-[var(--muted-foreground)]">付款状态:</span>
                      <div className="flex gap-1">
                        {PAYMENT_STATUSES.map(ps => (
                          <button key={ps.value}
                            onClick={() => handlePaymentStatus(step.id, ps.value)}
                            className={cn(
                              "rounded px-2 py-1 text-xs transition-colors",
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

                  {/* File upload */}
                  <div className="flex items-center gap-2 text-xs">
                    <label className={cn(
                      "inline-flex items-center gap-1 cursor-pointer rounded px-2 py-1 text-xs transition-colors",
                      stepUploading[step.id] ? "opacity-50" : "border hover:bg-[var(--muted)]"
                    )}>
                      {stepUploading[step.id] ? (
                        <><Loader2 className="size-3 animate-spin" />{stepFileNames[step.id] || "上传中..."}</>
                      ) : (
                        <><Upload className="size-3" />上传附件</>
                      )}
                      <input type="file" className="hidden" onChange={e => handleStepUpload(step.id, e)} disabled={stepUploading[step.id]} />
                    </label>
                    {stepUploadErrors[step.id] && (
                      <span className="text-[var(--destructive)]">{stepUploadErrors[step.id]}</span>
                    )}
                  </div>

                  {/* Notes area */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--muted-foreground)]">备注:</span>
                    </div>
                    {notes.length > 0 && (
                      <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                        {notes.map(note => {
                          // Check if this note is a file link
                          const fileLinkMatch = note.content.match(/📎\s+(.+?)\n([\s\S]+)/);
                          if (fileLinkMatch) {
                            const fileName = fileLinkMatch[1];
                            const url = fileLinkMatch[2].trim();
                            return (
                              <div key={note.id} className="flex items-center justify-between rounded bg-[var(--muted)] px-3 py-2 text-xs group">
                                <div className="flex items-center gap-2">
                                  <Paperclip className="size-3 text-[var(--muted-foreground)]" />
                                  <span>{fileName}</span>
                                  <a href={fileUrl(url)} target="_blank" rel="noopener noreferrer"
                                    className="text-[var(--primary)] hover:underline flex items-center gap-1">
                                    <Eye className="size-3" />查看
                                  </a>
                                </div>
                                <div className="flex items-center gap-2">
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
                            <div key={note.id} className="flex items-center justify-between rounded bg-[var(--muted)] px-3 py-2 text-xs group">
                              <span className="flex-1">{note.content}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-[var(--muted-foreground)]">{note.created_by} · {note.created_at?.slice(0, 16)}</span>
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

                    {/* Add note */}
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
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
