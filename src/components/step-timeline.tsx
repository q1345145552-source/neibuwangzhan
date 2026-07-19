"use client";

import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn, fileUrl } from "@/lib/utils";
import { StepTimer } from "@/components/step-timer";
import {
  CheckCircle2, Circle, Upload, Undo2, MessageSquare, Trash2, FileText, X
} from "lucide-react";

// ===== Shared types =====
export interface TimelineStep {
  id: number;
  step_name: string;
  step_order: number;
  status: string;
  assignee?: string;
  notes?: string;
  completed_at?: string | null;
  started_at?: string | null;
  created_at: string;
  // extra fields — pass through for renderHeaderBadges / renderExpandedExtra
  [key: string]: any;
}

export interface TimelineNote {
  id: number;
  content: string;
  created_by: string;
  created_at: string;
}

export interface TimelineEmployee {
  id: number;
  name: string;
}

const stepStatusClass: Record<string, string> = {
  "待处理": "bg-[var(--muted)] text-[var(--muted-foreground)]",
  "进行中": "bg-[color-mix(in_oklch,var(--primary),var(--background)_85%)] text-[var(--primary)]",
  "已完成": "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]",
  "阻塞": "bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] text-[var(--destructive)]",
};

interface StepTimelineProps {
  steps: TimelineStep[];
  stepNotes: Record<number, TimelineNote[]>;
  employees: TimelineEmployee[];
  isClient?: boolean;

  // Actions — parent provides API calls
  onStart: (stepId: number) => Promise<void>;
  onComplete: (stepId: number, note?: string) => Promise<void>;
  onRollback: (stepId: number) => Promise<void>;
  onBlock: (stepId: number) => Promise<void>;
  onUpload: (stepId: number, file: File) => Promise<void>;
  onAddNote: (stepId: number, content: string) => Promise<void>;
  onDeleteNote: (stepId: number, noteId: number) => Promise<void>;
  onAssigneeChange: (stepId: number, assignee: string) => Promise<void>;

  // Can the step be completed? (check prev step)
  canComplete?: (step: TimelineStep, prevStep: TimelineStep | null) => boolean;

  // Hide per-step "开始" button — use top-level "开始任务" instead
  hidePerStepStart?: boolean;

  // Optional extra content
  renderStepExtra?: (step: TimelineStep) => React.ReactNode;
  renderHeaderBadges?: (step: TimelineStep) => React.ReactNode;
  renderExpandedExtra?: (step: TimelineStep) => React.ReactNode;
}

export function StepTimeline({
  steps, stepNotes, employees, isClient = false,
  onStart, onComplete, onRollback, onBlock, onUpload, onAddNote, onDeleteNote, onAssigneeChange,
  canComplete,
  renderStepExtra, renderHeaderBadges, renderExpandedExtra,
  hidePerStepStart = false,
}: StepTimelineProps) {
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});
  const [confirmingStepId, setConfirmingStepId] = useState<number | null>(null);
  const [newNotes, setNewNotes] = useState<Record<number, string>>({});
  const [noteErrorMsg, setNoteErrorMsg] = useState<Record<number, string>>({});
  const [editingAssigneeId, setEditingAssigneeId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ stepId: number; noteId: number; content: string } | null>(null);

  // upload state
  const [uploading, setUploading] = useState<Record<number, boolean>>({});
  const [uploadFileName, setUploadFileName] = useState<Record<number, string>>({});
  const [uploadError, setUploadError] = useState<Record<number, string>>({});
  const [error, setError] = useState("");

  const toggleExpand = (stepId: number) => setExpandedSteps(p => ({ ...p, [stepId]: !p[stepId] }));

  const handleAddNote = async (stepId: number) => {
    const c = newNotes[stepId]?.trim();
    if (!c) { setNoteErrorMsg(p => ({ ...p, [stepId]: "请填写备注内容" })); return; }
    setNoteErrorMsg(p => ({ ...p, [stepId]: "" }));
    try { await onAddNote(stepId, c); setNewNotes(p => ({ ...p, [stepId]: "" })); }
    catch (e) { setError(e instanceof Error ? e.message : "添加失败"); }
  };

  const handleConfirmComplete = async (stepId: number) => {
    const note = newNotes[stepId]?.trim();
    setConfirmingStepId(null);
    setNewNotes(p => ({ ...p, [stepId]: "" }));
    try { await onComplete(stepId, note); }
    catch (e) { setError(e instanceof Error ? e.message : "完成失败"); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try { await onDeleteNote(deleteTarget.stepId, deleteTarget.noteId); setDeleteTarget(null); }
    catch (e) { setError(e instanceof Error ? e.message : "删除失败"); }
  };

  const handleUpload = async (stepId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(p => ({ ...p, [stepId]: true }));
    setUploadFileName(p => ({ ...p, [stepId]: file.name }));
    setUploadError(p => ({ ...p, [stepId]: "" }));
    try { await onUpload(stepId, file); setUploadError(p => ({ ...p, [stepId]: "" })); }
    catch (err) { setUploadError(p => ({ ...p, [stepId]: err instanceof Error ? err.message : "上传失败" })); }
    finally { setUploading(p => ({ ...p, [stepId]: false })); e.target.value = ""; }
  };

  const handleStart = async (stepId: number) => { try { await onStart(stepId); } catch (e) { setError(e instanceof Error ? e.message : "开始失败"); } };
  const handleRollback = async (stepId: number) => { try { await onRollback(stepId); } catch (e) { setError(e instanceof Error ? e.message : "撤回失败"); } };
  const handleBlock = async (stepId: number) => { try { await onBlock(stepId); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); } };

  if (steps.length === 0) return <p className="text-sm text-[var(--muted-foreground)]">暂无步骤</p>;

  return (
    <>
      {error && (
        <div className="rounded-lg border border-[var(--destructive)] bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] px-4 py-3 text-sm text-[var(--destructive)] flex items-center justify-between mb-4">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-3 hover:opacity-70 text-lg leading-none">&times;</button>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteTarget && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="w-full max-w-sm rounded-xl border bg-[var(--background)] shadow-2xl p-5" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-medium mb-2">确认删除备注？</h3>
              <p className="text-xs text-[var(--muted-foreground)] mb-4 truncate">{deleteTarget.content}</p>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(null)}>取消</Button>
                <Button size="sm" onClick={handleDelete} className="bg-[var(--destructive)] text-[var(--destructive-foreground)]">删除</Button>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="flex flex-col gap-0">
        {steps.map((step, i) => {
          const notes = stepNotes[step.id] || [];
          const hasNotes = notes.length > 0;
          const expanded = expandedSteps[step.id] || false;
          const prevStep = steps.find(s => s.step_order === step.step_order - 1) || null;
          const canFinish = canComplete ? canComplete(step, prevStep) : (!prevStep || prevStep.status === "已完成");

          return (
            <div key={step.id} className="flex gap-3">
              {/* Timeline dot */}
              <div className="flex flex-col items-center">
                <div className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                  step.status === "已完成" && "bg-[var(--success)] text-[var(--success-foreground)]",
                  step.status === "进行中" && "bg-[var(--primary)] text-[var(--primary-foreground)] ring-2 ring-[var(--ring)]/30",
                  step.status === "阻塞" && "bg-[var(--destructive)] text-[var(--destructive-foreground)]",
                  step.status === "待处理" && "bg-[var(--muted)] text-[var(--muted-foreground)]"
                )}>{step.status === "已完成" ? "✓" : step.step_order}</div>
                {i < steps.length - 1 && (
                  <div className={cn("w-px flex-1 min-h-[20px]", step.status === "已完成" ? "bg-[var(--success)]" : "bg-[var(--border)]")} />
                )}
              </div>

              {/* Card body */}
              <div className="pb-5 flex-1">
                {/* Extra content above step name (logistics, hs_code, etc.) */}
                {renderStepExtra?.(step)}

                {/* Header */}
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-[var(--foreground)]">{step.step_name}</p>
                  <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", stepStatusClass[step.status])}>{step.status}</span>
                  {renderHeaderBadges?.(step)}

                  {/* Assignee */}
                  {step.assignee && (
                    isClient ? (
                      <span className="text-xs text-[var(--muted-foreground)]">{step.assignee}</span>
                    ) : editingAssigneeId !== step.id ? (
                      <button onClick={() => setEditingAssigneeId(step.id)} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:underline cursor-pointer">{step.assignee}</button>
                    ) : null
                  )}
                  {editingAssigneeId === step.id && (
                    <select
                      value={step.assignee || ""}
                      onChange={async (e) => {
                        const v = e.target.value;
                        if (v === step.assignee) { setEditingAssigneeId(null); return; }
                        await onAssigneeChange(step.id, v);
                        setEditingAssigneeId(null);
                      }}
                      onBlur={() => setEditingAssigneeId(null)}
                      autoFocus
                      className="rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-xs outline-none focus:border-[var(--ring)]"
                    >
                      {employees.map(emp => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
                    </select>
                  )}
                </div>

                {/* Active toolbar */}
                {step.status !== "已完成" && step.status !== "阻塞" && (
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    {confirmingStepId === step.id ? (
                      <>
                        <input
                          value={newNotes[step.id] || ""}
                          onChange={(e) => { setNewNotes(p => ({ ...p, [step.id]: e.target.value })); setNoteErrorMsg(prev => ({ ...prev, [step.id]: "" })); }}
                          onKeyDown={(e) => { if (e.key === "Enter") handleConfirmComplete(step.id); if (e.key === "Escape") setConfirmingStepId(null); }}
                          placeholder="完成备注（可选）..."
                          className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)] w-40"
                          autoFocus
                        />
                        <button onClick={() => handleConfirmComplete(step.id)} className="rounded px-2 py-0.5 text-xs bg-[var(--success)] text-[var(--success-foreground)] hover:bg-[color-mix(in_oklch,var(--success),var(--foreground)_20%)] transition-colors">确认完成</button>
                        <button onClick={() => { setConfirmingStepId(null); setNewNotes(p => ({ ...p, [step.id]: "" })); }} className="rounded px-2 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">取消</button>
                      </>
                    ) : (
                      <>
                        {step.status === "待处理" ? (
                          hidePerStepStart ? (
                            <span className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)]">待开始</span>
                          ) : (
                            <button onClick={() => handleStart(step.id)} className="rounded border border-[color-mix(in_oklch,var(--primary),var(--background)_60%)] bg-[color-mix(in_oklch,var(--primary),var(--background)_92%)] px-2 py-1 text-xs text-[var(--primary)] hover:bg-[color-mix(in_oklch,var(--primary),var(--background)_85%)] transition-colors">开始</button>
                          )
                        ) : (
                          <>
                            {canFinish ? (
                              <button onClick={() => setConfirmingStepId(step.id)} className="rounded border border-[color-mix(in_oklch,var(--success),var(--background)_70%)] bg-[color-mix(in_oklch,var(--success),var(--background)_92%)] px-2 py-1 text-xs text-[var(--success)] hover:bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] transition-colors">标记完成</button>
                            ) : (
                              <span className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] opacity-50 cursor-not-allowed select-none">需先完成前一步</span>
                            )}
                            <button onClick={() => handleBlock(step.id)} className="rounded border border-[color-mix(in_oklch,var(--destructive),var(--background)_70%)] bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] px-2 py-1 text-xs text-[var(--destructive)] hover:bg-[color-mix(in_oklch,var(--destructive),var(--background)_85%)] transition-colors">标记阻塞</button>
                          </>
                        )}
                      </>
                    )}
                    <StepTimer created_at={step.created_at} completed_at={step.completed_at} status={step.status} prev_completed_at={i > 0 ? steps[i-1].completed_at : null} started_at={step.started_at} className="ml-1" />
                  </div>
                )}

                {/* Completed / Blocked */}
                {(step.status === "已完成" || step.status === "阻塞") && (
                  <div className="mt-1 flex items-center gap-2">
                    <StepTimer created_at={step.created_at} completed_at={step.completed_at} status={step.status} prev_completed_at={i > 0 ? steps[i-1].completed_at : null} started_at={step.started_at} />
                    {!isClient && (
                      <button onClick={() => handleRollback(step.id)} className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
                        <Undo2 className="size-3" />撤回
                      </button>
                    )}
                  </div>
                )}

                {/* File upload */}
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <label className={cn(
                    "shrink-0 cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors inline-flex items-center gap-1",
                    uploading[step.id] && "opacity-50 pointer-events-none"
                  )}>
                    <Upload className="size-3" />
                    {uploading[step.id] ? uploadFileName[step.id] || "上传中..." : "附件"}
                    <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx"
                      onChange={e => handleUpload(step.id, e)} disabled={uploading[step.id]} />
                  </label>
                  {uploadError[step.id] && <span className="text-xs text-[var(--destructive)]">{uploadError[step.id]}</span>}
                </div>

                {/* Notes toggle */}
                <button onClick={() => toggleExpand(step.id)} className="mt-1 flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
                  <MessageSquare className="size-3" />
                  {hasNotes && <span className="rounded-full bg-[var(--muted)] px-1.5 text-[0.65rem]">{notes.length}</span>}
                  {expanded ? "收起" : "备注"}
                </button>

                {/* Expanded notes + extras */}
                {expanded && (
                  <div className="mt-3 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                    {/* Notes */}
                    <div>
                      <h4 className="mb-2 text-xs font-medium text-[var(--foreground)]">备注记录</h4>
                      {notes.length === 0 ? (
                        <p className="text-xs text-[var(--muted-foreground)]">暂无备注</p>
                      ) : (
                        <ul className="space-y-1.5 mb-2">
                          {notes.map(n => (
                            <li key={n.id} className="rounded bg-[var(--muted)] px-2.5 py-1.5 text-xs text-[var(--foreground)]">
                              <div className="flex items-start justify-between gap-2">
                                {(() => {
                                  const ftMatch = n.content.match(/上传文件:\s*(.+?)\s*\(\/api\/files\/([^)]+)\)/);
                                  if (ftMatch) {
                                    const [, ftName, ftPath] = ftMatch;
                                    return <a href={fileUrl("/api/files/" + ftPath)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[var(--primary)] hover:underline">
                                      <FileText className="size-3.5 shrink-0" />{ftName}
                                    </a>;
                                  }
                                  const ftMatch2 = n.content.match(/📎\s+(.+?)\n([\s\S]+)/);
                                  if (ftMatch2) {
                                    const [, ftName2, ftUrl2] = ftMatch2;
                                    return <a href={fileUrl(ftUrl2.trim())} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[var(--primary)] hover:underline">
                                      <FileText className="size-3.5 shrink-0" />{ftName2}
                                    </a>;
                                  }
                                  return <p className="flex-1">{n.content}</p>;
                                })()}
                                {!isClient && (
                                  <button onClick={() => setDeleteTarget({ stepId: step.id, noteId: n.id, content: n.content })} className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] transition-colors"><Trash2 className="size-3" /></button>
                                )}
                              </div>
                              <p className="mt-0.5 text-[0.65rem] text-[var(--muted-foreground)]">{n.created_by} · {n.created_at?.slice(0, 16)}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex gap-1.5">
                        <input value={newNotes[step.id] || ""} onChange={e => { setNewNotes(p => ({ ...p, [step.id]: e.target.value })); setNoteErrorMsg(prev => ({ ...prev, [step.id]: "" })); }} onKeyDown={e => e.key === "Enter" && handleAddNote(step.id)} placeholder="写备注..." className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                        <button onClick={() => handleAddNote(step.id)} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_15%)]">添加</button>
                      </div>
                      {noteErrorMsg[step.id] && <p className="text-xs text-[var(--destructive)] mt-1">{noteErrorMsg[step.id]}</p>}
                    </div>

                    {/* Extra content slot */}
                    {renderExpandedExtra?.(step)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
