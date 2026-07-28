"use client";

import React, { useState, useEffect, useCallback, use, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Paperclip, Upload, MessageSquare, CheckCircle2, Circle, Pencil, Trash2, X, Undo2, AlertTriangle, Image } from "lucide-react";
import { StepTimer } from "@/components/step-timer";
import { useAuth } from "@/components/auth-provider";
import { fetchWithAuth } from "@/lib/api";
import { cn, toThaiTime, fileUrl } from "@/lib/utils";

interface ShippingOrder {
  id: number; cabinet_number: string; warehouse: string; progress: string; creator: string; created_at: string; updated_at: string;
}
interface ShippingStep {
  id: number; order_id: number; step_name: string; step_order: number; status: string; assignee: string; started_at: string | null; completed_at: string | null; created_at: string;
}
interface StepNote { id: number; step_id: number; content: string; created_by: string; created_at: string; }

/** 每一步标记完成时必填的内容提示 */
const STEP_REQUIREMENTS: Record<number, { label: string; needFile: boolean }> = {
  1: { label: "柜号", needFile: false },
  2: { label: "装柜清单信息", needFile: false },
  3: { label: "预计更新时间", needFile: false },
  4: { label: "船名", needFile: false },
  5: { label: "跟拆派仓的聊天记录截图", needFile: true },
  6: { label: "跟拆派仓的聊天记录截图", needFile: true },
  7: { label: "做派送单的聊天记录截图", needFile: true },
  8: { label: "回执单图片", needFile: true },
};

export default function LogisticsDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();

  const [order, setOrder] = useState<ShippingOrder | null>(null);
  const [steps, setSteps] = useState<ShippingStep[]>([]);
  const [stepNotes, setStepNotes] = useState<Record<number, StepNote[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});
  const [newNotes, setNewNotes] = useState<Record<number, string>>({});
  const [noteErrorMsg, setNoteErrorMsg] = useState<Record<number, string>>({});
  const [confirmingStepId, setConfirmingStepId] = useState<number | null>(null);
  const [confirmFiles, setConfirmFiles] = useState<Record<number, File | null>>({});
  const [confirmFileNames, setConfirmFileNames] = useState<Record<number, string>>({});
  const [confirmUploading, setConfirmUploading] = useState(false);
  const [deleteNoteTarget, setDeleteNoteTarget] = useState<{ stepId: number; noteId: number } | null>(null);
  const [deleteNoteSaving, setDeleteNoteSaving] = useState(false);

  const [editingAssignee, setEditingAssignee] = useState<{ stepId: number; name: string } | null>(null);

  // 拆派仓问题弹窗
  const [delayStepId, setDelayStepId] = useState<number | null>(null);
  const [delayFile, setDelayFile] = useState<File | null>(null);
  const [delayFileName, setDelayFileName] = useState("");
  const [delayUploading, setDelayUploading] = useState(false);
  const delayFileRef = useRef<HTMLInputElement>(null);

  // Sidebar
  const [sideTab, setSideTab] = useState<"notes" | "files">("notes");
  const [uploading, setUploading] = useState(false);
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; url: string }[]>([]);

  // ─── Load ───
  const load = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/logistics/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error("加载失败");
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setOrder(data as ShippingOrder);
      setSteps((data.steps || []) as ShippingStep[]);
      setStepNotes(data.stepNotes || {});
    } catch (e: any) { setError(e?.message || "加载失败"); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // ─── File upload helper ───
  const uploadFile = async (file: File): Promise<string | null> => {
    const form = new FormData(); form.append("file", file);
    const res = await fetchWithAuth("/api/upload", { method: "POST", body: form });
    if (!res.ok) return null;
    const data = await res.json();
    return data.url || null;
  };

  // ─── Step operations ───
  const updateStep = async (stepId: number, status: string, assignee?: string) => {
    try {
      const body: any = { step_id: stepId, status };
      if (assignee) body.assignee = assignee;
      const res = await fetchWithAuth(`/api/logistics/${id}/steps`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "操作失败"); }
    } catch (e: any) { setError(e.message); return false; }
    return true;
  };

  const handleStart = async (stepId: number) => { if (await updateStep(stepId, "进行中")) load(); };
  const handleBlock = async (stepId: number) => { if (await updateStep(stepId, "阻塞")) load(); };

  const handleConfirmComplete = async (stepId: number) => {
    const step = steps.find(s => s.id === stepId);
    if (!step) return;
    const req = STEP_REQUIREMENTS[step.step_order];
    const noteText = newNotes[stepId]?.trim();
    const file = confirmFiles[stepId];

    // 校验必填
    if (req?.needFile && !file) {
      setError(`步骤 ${step.step_order} 标记完成必须上传「${req.label}」`);
      return;
    }
    if (!req?.needFile && !noteText) {
      setError(`步骤 ${step.step_order} 标记完成必须填写「${req.label}」`);
      return;
    }

    setConfirmingStepId(null);
    setConfirmUploading(true);
    try {
      // 上传文件（如果需要）
      let fileUrl = "";
      if (file) {
        fileUrl = (await uploadFile(file)) || "";
        if (!fileUrl) { setError("文件上传失败，请重试"); setConfirmUploading(false); return; }
      }

      // 构建备注内容
      const noteContent = req?.needFile
        ? `[${req.label}] ${fileUrl}`
        : `[${req.label}] ${noteText}`;

      // 保存备注
      await fetchWithAuth(`/api/logistics/${id}/steps/${stepId}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteContent, created_by: user?.name || "系统" }),
      });

      setNewNotes(p => ({ ...p, [stepId]: "" }));
      setConfirmFiles(p => ({ ...p, [stepId]: null }));
      setConfirmFileNames(p => ({ ...p, [stepId]: "" }));

      // 标记完成
      if (await updateStep(stepId, "已完成")) {
        const idx = steps.findIndex(s => s.id === stepId);
        const next = idx >= 0 && idx < steps.length - 1 ? steps[idx + 1] : null;
        if (next && next.status === "待处理") {
          await updateStep(next.id, "进行中");
        }
        load();
      }
    } catch (e: any) { setError(e.message); }
    finally { setConfirmUploading(false); }
  };

  const handleRollback = async (stepId: number) => { if (await updateStep(stepId, "待处理")) load(); };

  const handleAssign = async (stepId: number, name: string) => {
    if (await updateStep(stepId, steps.find(s => s.id === stepId)!.status, name)) load();
    setEditingAssignee(null);
  };

  // ─── 拆派仓问题标记 ───
  const handleDelaySubmit = async () => {
    if (!delayFile || !delayStepId) return;
    setDelayUploading(true);
    try {
      const fileUrl = await uploadFile(delayFile);
      if (!fileUrl) { setError("截图上传失败"); setDelayUploading(false); return; }

      await fetchWithAuth(`/api/logistics/${id}/steps/${delayStepId}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `拆派仓延迟:已上传截图 ${fileUrl}`, created_by: user?.name || "系统" }),
      });

      setDelayStepId(null);
      setDelayFile(null);
      setDelayFileName("");
      load();
    } catch (e: any) { setError(e.message); }
    finally { setDelayUploading(false); }
  };

  // ─── Notes ───
  const handleAddNote = async (stepId: number) => {
    const content = newNotes[stepId]?.trim();
    if (!content) { setNoteErrorMsg(p => ({ ...p, [stepId]: "请填写备注内容" })); return; }
    setNoteErrorMsg(p => ({ ...p, [stepId]: "" }));
    try {
      const res = await fetchWithAuth(`/api/logistics/${id}/steps/${stepId}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, created_by: user?.name || "系统" }),
      });
      if (!res.ok) throw new Error("添加失败");
      setNewNotes(p => ({ ...p, [stepId]: "" }));
      const notes = await res.json();
      setStepNotes(p => ({ ...p, [stepId]: notes }));
    } catch (e: any) { setNoteErrorMsg(p => ({ ...p, [stepId]: e.message })); }
  };

  const handleDeleteNote = async () => {
    if (!deleteNoteTarget) return;
    setDeleteNoteSaving(true);
    try {
      const res = await fetchWithAuth(`/api/logistics/${id}/steps/${deleteNoteTarget.stepId}/notes?id=${deleteNoteTarget.noteId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      const notes = await res.json();
      setStepNotes(p => ({ ...p, [deleteNoteTarget.stepId]: notes }));
      setDeleteNoteTarget(null);
    } catch (e: any) { setError(e.message); }
    finally { setDeleteNoteSaving(false); }
  };

  // ─── File upload (sidebar) ───
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true); setUploadFileName(file.name);
    try {
      const url = await uploadFile(file);
      if (url) setUploadedFiles(p => [...p, { name: file.name, url }]);
      else setError("文件上传失败");
    } catch { setError("文件上传失败"); }
    finally { setUploading(false); setUploadFileName(""); }
  };

  const toggleExpand = (stepId: number) => setExpandedSteps(p => ({ ...p, [stepId]: !p[stepId] }));

  if (loading) return <div className="text-center py-12 text-sm text-[var(--muted-foreground)]">加载中…</div>;
  if (!order) return <div className="text-center py-12 text-sm text-[var(--muted-foreground)]">订单不存在</div>;

  const doneCount = steps.filter(s => s.status === "已完成").length;
  const pct = steps.length > 0 ? Math.round(doneCount / steps.length * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-lg border border-[var(--destructive)] bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] px-4 py-3 text-sm text-[var(--destructive)] flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-3 text-[var(--destructive)] hover:opacity-70 text-lg leading-none">&times;</button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.back()}><ArrowLeft className="size-4" /></Button>
          <div>
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">{order.cabinet_number}</h1>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                order.progress === "已完成" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
              )}>{order.progress}</span>
              <span className="text-xs text-[var(--muted-foreground)]">{order.warehouse}</span>
              <span className="text-xs text-[var(--muted-foreground)]">· {doneCount}/{steps.length} 已完成</span>
              {steps.length > 0 && steps[0].status === "待处理" && (
                <button onClick={() => handleStart(steps[0].id)} className="rounded border border-[color-mix(in_oklch,var(--primary),var(--background)_60%)] bg-[color-mix(in_oklch,var(--primary),var(--background)_90%)] px-3 py-1 text-xs font-medium text-[var(--primary)] hover:bg-[color-mix(in_oklch,var(--primary),var(--background)_82%)] transition-colors">开始任务</button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* LEFT */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Basic info */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">基本信息</h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div><dt className="text-xs text-[var(--muted-foreground)]">柜号</dt><dd className="mt-1 text-sm font-mono text-[var(--foreground)]">{order.cabinet_number}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">发货仓库</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{order.warehouse}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">创建人</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{order.creator || "—"}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">创建日期</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{toThaiTime(order.created_at)}</dd></div>
            </dl>
          </div>

          {/* Progress tracking */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">进度追踪</h3>
            {steps.length > 0 && (
              <div className="mb-5 flex items-center gap-3">
                <span className="text-xs text-[var(--muted-foreground)] shrink-0">已完成 {doneCount}/{steps.length}</span>
                <div className="flex-1 h-2 rounded-full bg-[var(--muted)] overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all duration-300", doneCount === steps.length ? "bg-emerald-500" : "bg-[var(--primary)]")} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs font-medium shrink-0 text-[var(--muted-foreground)]">{doneCount === steps.length ? "全部完成" : `${pct}%`}</span>
              </div>
            )}

            {steps.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">暂无步骤</p>
            ) : (
              <div className="flex flex-col gap-0">
                {steps.map((step, i) => {
                  const notes = stepNotes[step.id] || [];
                  const expanded = expandedSteps[step.id] || false;
                  const req = STEP_REQUIREMENTS[step.step_order];
                  const isDelayStep = step.step_order >= 5 && step.step_order <= 8;
                  const hasDelayNote = notes.some(n => n.content.startsWith("拆派仓延迟"));

                  return (
                    <div key={step.id} className="flex gap-3">
                      {/* Step number + connector */}
                      <div className="flex flex-col items-center">
                        <div className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                          step.status === "已完成" && "bg-emerald-500 text-white",
                          step.status === "进行中" && "bg-[var(--primary)] text-[var(--primary-foreground)] ring-2 ring-[var(--ring)]/30",
                          step.status === "阻塞" && "bg-red-500 text-white",
                          step.status === "待处理" && "bg-[var(--muted)] text-[var(--muted-foreground)]"
                        )}>
                          {step.status === "已完成" ? <CheckCircle2 className="size-3.5" /> : step.status === "阻塞" ? "!" : step.step_order}
                        </div>
                        {i < steps.length - 1 && <div className={cn("w-px flex-1 min-h-[20px]", (step.status === "已完成" || steps[i + 1]?.status === "进行中") ? "bg-emerald-500/50" : "bg-[var(--border)]")} />}
                      </div>

                      {/* Step content */}
                      <div className="flex-1 pb-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={cn("text-sm font-medium", step.status === "已完成" ? "text-[var(--muted-foreground)]" : "text-[var(--foreground)]")}>{step.step_name}</p>
                          {hasDelayNote && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-[0.6rem] font-medium text-red-700 dark:text-red-400"><AlertTriangle className="size-2.5"/>拆派仓延迟</span>}
                          <StepTimer created_at={step.created_at} completed_at={step.completed_at} status={step.status} started_at={step.started_at} className="ml-auto" />
                        </div>

                        {/* Assignee */}
                        <div className="mt-0.5 flex items-center gap-1.5">
                          {editingAssignee?.stepId === step.id ? (
                            <>
                              <input value={editingAssignee.name} onChange={e => setEditingAssignee({ stepId: step.id, name: e.target.value })}
                                className="w-20 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-xs outline-none focus:border-[var(--ring)]"
                                onKeyDown={e => { if (e.key === "Enter") handleAssign(step.id, editingAssignee.name); if (e.key === "Escape") setEditingAssignee(null); }} autoFocus />
                              <button onClick={() => handleAssign(step.id, editingAssignee.name)} className="text-xs text-[var(--primary)]">保存</button>
                              <button onClick={() => setEditingAssignee(null)} className="text-xs text-[var(--muted-foreground)]">取消</button>
                            </>
                          ) : (
                            <button onClick={() => setEditingAssignee({ stepId: step.id, name: step.assignee || "可爱" })}
                              className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
                              <Pencil className="size-2.5" />{step.assignee || "可爱"}
                            </button>
                          )}
                        </div>

                        {/* ── 拆派仓问题 按钮（步骤5-8，进行中时显示）── */}
                        {isDelayStep && (step.status === "进行中" || step.status === "已完成" || step.status === "阻塞") && !hasDelayNote && (
                          <div className="mt-1">
                            <button onClick={() => setDelayStepId(step.id)}
                              className="inline-flex items-center gap-1 rounded border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/20 px-2 py-0.5 text-xs text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-950/40 transition-colors">
                              <AlertTriangle className="size-3" />拆派仓有问题
                            </button>
                          </div>
                        )}

                        {/* Actions */}
                        {step.status !== "已完成" && (
                          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                            {confirmingStepId === step.id ? (
                              <div className="flex flex-col gap-2 w-full max-w-sm">
                                {/* 文字备注（步骤1-4必填，5-8可选辅助说明） */}
                                {!req?.needFile && (
                                  <input
                                    value={newNotes[step.id] || ""}
                                    onChange={e => { setNewNotes(p => ({ ...p, [step.id]: e.target.value })); setNoteErrorMsg(p => ({ ...p, [step.id]: "" })); }}
                                    onKeyDown={e => { if (e.key === "Enter") handleConfirmComplete(step.id); if (e.key === "Escape") setConfirmingStepId(null); }}
                                    placeholder={`必填：${req?.label}`}
                                    className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]"
                                    autoFocus
                                  />
                                )}
                                {/* 文件上传（步骤5-8必填） */}
                                {req?.needFile && (
                                  <div className="flex items-center gap-2">
                                    <label className="shrink-0 cursor-pointer rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs hover:bg-[var(--muted)] transition-colors">
                                      <Upload className="size-3 inline mr-1" />
                                      {confirmFileNames[step.id] ? confirmFileNames[step.id] : `上传${req.label}`}
                                      <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf" className="hidden"
                                        onChange={e => { const f = e.target.files?.[0]; if (f) { setConfirmFiles(p => ({ ...p, [step.id]: f })); setConfirmFileNames(p => ({ ...p, [step.id]: f.name })); } }} />
                                    </label>
                                    {confirmFileNames[step.id] && (
                                      <button onClick={() => { setConfirmFiles(p => ({ ...p, [step.id]: null })); setConfirmFileNames(p => ({ ...p, [step.id]: "" })); }}
                                        className="text-xs text-[var(--muted-foreground)] hover:text-[var(--destructive)]"><X className="size-3 inline" />移除</button>
                                    )}
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
                                  <button onClick={() => handleConfirmComplete(step.id)} disabled={confirmUploading}
                                    className="rounded px-2 py-1 text-xs bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
                                    {confirmUploading ? "上传中…" : "确认完成"}
                                  </button>
                                  <button onClick={() => { setConfirmingStepId(null); setNewNotes(p => ({ ...p, [step.id]: "" })); setConfirmFiles(p => ({ ...p, [step.id]: null })); setConfirmFileNames(p => ({ ...p, [step.id]: "" })); }}
                                    className="rounded px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">取消</button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {step.status === "待处理" ? (
                                  <button onClick={() => handleStart(step.id)}
                                    className="rounded border border-[color-mix(in_oklch,var(--primary),var(--background)_70%)] bg-[color-mix(in_oklch,var(--primary),var(--background)_92%)] px-2 py-1 text-xs text-[var(--primary)] hover:bg-[color-mix(in_oklch,var(--primary),var(--background)_85%)] transition-colors">开始</button>
                                ) : step.status === "进行中" && (
                                  <>
                                    <button onClick={() => {
                                      setConfirmingStepId(step.id);
                                      setNewNotes(p => ({ ...p, [step.id]: "" }));
                                      setConfirmFiles(p => ({ ...p, [step.id]: null }));
                                      setConfirmFileNames(p => ({ ...p, [step.id]: "" }));
                                    }}
                                      className="rounded border border-[color-mix(in_oklch,var(--success),var(--background)_70%)] bg-[color-mix(in_oklch,var(--success),var(--background)_92%)] px-2 py-1 text-xs text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">标记完成</button>
                                    <button onClick={() => handleBlock(step.id)}
                                      className="rounded border border-[color-mix(in_oklch,var(--destructive),var(--background)_70%)] bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] px-2 py-1 text-xs text-[var(--destructive)] hover:bg-[color-mix(in_oklch,var(--destructive),var(--background)_85%)] transition-colors">标记阻塞</button>
                                  </>
                                )}
                                {step.status === "阻塞" && (
                                  <button onClick={() => handleStart(step.id)}
                                    className="rounded border border-[color-mix(in_oklch,var(--primary),var(--background)_70%)] bg-[color-mix(in_oklch,var(--primary),var(--background)_92%)] px-2 py-1 text-xs text-[var(--primary)] hover:bg-[color-mix(in_oklch,var(--primary),var(--background)_85%)] transition-colors">重新开始</button>
                                )}
                              </>
                            )}
                          </div>
                        )}

                        {/* Completed / Blocked */}
                        {(step.status === "已完成" || step.status === "阻塞") && (
                          <div className="mt-1 flex items-center gap-2">
                            {step.status === "已完成" && step.completed_at && (
                              <>
                                <StepTimer created_at={step.created_at} completed_at={step.completed_at} status="已完成" started_at={step.started_at} />
                                <span className="text-xs text-[var(--muted-foreground)]">完成于 {toThaiTime(step.completed_at)}</span>
                              </>
                            )}
                            <button onClick={() => handleRollback(step.id)}
                              className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
                              <Undo2 className="size-3" />撤回
                            </button>
                          </div>
                        )}

                        {/* Expand notes */}
                        <button onClick={() => toggleExpand(step.id)}
                          className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
                          <MessageSquare className="size-3" />
                          {expanded ? "收起" : `备注${notes.length ? ` (${notes.length})` : ""}与文件`}
                        </button>

                        {expanded && (
                          <div className="mt-2 pl-1 border-l-2 border-[var(--border)] space-y-2">
                            {notes.map(n => (
                              <div key={n.id} className="flex items-start justify-between gap-2 group">
                                <div className="flex-1">
                                  <p className="text-xs text-[var(--foreground)]">{n.content}</p>
                                  <p className="mt-0.5 text-[0.65rem] text-[var(--muted-foreground)]">{n.created_by} · {toThaiTime(n.created_at)}</p>
                                </div>
                                <button onClick={() => setDeleteNoteTarget({ stepId: step.id, noteId: n.id })}
                                  className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] transition-all">
                                  <Trash2 className="size-3" />
                                </button>
                              </div>
                            ))}
                            <div className="flex items-center gap-2">
                              <input value={newNotes[step.id] || ""} onChange={e => { setNewNotes(p => ({ ...p, [step.id]: e.target.value })); setNoteErrorMsg(p => ({ ...p, [step.id]: "" })); }}
                                onKeyDown={e => e.key === "Enter" && handleAddNote(step.id)}
                                placeholder="添加备注…" className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                              <button onClick={() => handleAddNote(step.id)} className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">添加</button>
                            </div>
                            {noteErrorMsg[step.id] && <p className="text-xs text-[var(--destructive)]">{noteErrorMsg[step.id]}</p>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT sidebar */}
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <div className="flex border-b border-[var(--border)]">
              <button onClick={() => setSideTab("notes")}
                className={cn("flex-1 py-2.5 text-xs font-medium text-center transition-colors", sideTab === "notes" ? "text-[var(--foreground)] border-b-2 border-[var(--primary)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]")}>
                <MessageSquare className="size-3 inline mr-1" />全部备注
              </button>
              <button onClick={() => setSideTab("files")}
                className={cn("flex-1 py-2.5 text-xs font-medium text-center transition-colors", sideTab === "files" ? "text-[var(--foreground)] border-b-2 border-[var(--primary)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]")}>
                <Paperclip className="size-3 inline mr-1" />文件上传
              </button>
            </div>
            <div className="p-4 max-h-[600px] overflow-y-auto">
              {sideTab === "notes" ? (
                (() => {
                  const allNotes: (StepNote & { step_name: string })[] = [];
                  steps.forEach(s => {
                    (stepNotes[s.id] || []).forEach(n => allNotes.push({ ...n, step_name: s.step_name }));
                  });
                  return allNotes.length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)] text-center py-4">暂无备注</p>
                  ) : (
                    <div className="space-y-3">
                      {allNotes.map(n => (
                        <div key={n.id} className="border-b border-[var(--border)] pb-2 last:border-0">
                          <p className="text-xs text-[var(--foreground)]">{n.content}</p>
                          <p className="mt-1 text-[0.6rem] text-[var(--muted-foreground)]">{n.created_by} · {n.step_name} · {toThaiTime(n.created_at)}</p>
                        </div>
                      ))}
                    </div>
                  );
                })()
              ) : (
                <div className="space-y-3">
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--border)] px-3 py-4 text-xs text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors">
                    <Upload className="size-4" />
                    {uploading ? `上传中: ${uploadFileName}…` : "点击上传文件"}
                    <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
                  </label>
                  {uploadedFiles.length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)] text-center py-4">暂无文件</p>
                  ) : (
                    <ul className="space-y-2">
                      {uploadedFiles.map((f, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 rounded border border-[var(--border)] px-2 py-1.5">
                          <a href={fileUrl(f.url)} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--foreground)] hover:text-[var(--primary)] truncate flex-1">{f.name}</a>
                          <button onClick={() => setUploadedFiles(p => p.filter((_, j) => j !== i))}
                            className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] hover:text-[var(--destructive)]"><X className="size-3" /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 拆派仓问题弹窗 */}
      {delayStepId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setDelayStepId(null); setDelayFile(null); setDelayFileName(""); }}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="size-5 text-orange-500" />
              <p className="text-sm font-medium text-[var(--foreground)]">拆派仓延迟标记</p>
            </div>
            <p className="text-xs text-[var(--muted-foreground)] mb-3">上传截图证明拆派仓出了问题</p>
            {delayFileName ? (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-[var(--foreground)] truncate flex-1">{delayFileName}</span>
                <button onClick={() => { setDelayFile(null); setDelayFileName(""); }} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--destructive)]"><X className="size-3" /></button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--border)] px-3 py-4 text-xs text-[var(--muted-foreground)] hover:border-orange-400 hover:text-orange-600 transition-colors mb-3">
                <Image className="size-4" />点击上传截图
                <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) { setDelayFile(f); setDelayFileName(f.name); } }} />
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setDelayStepId(null); setDelayFile(null); setDelayFileName(""); }}>取消</Button>
              <Button size="sm" onClick={handleDelaySubmit} disabled={!delayFile || delayUploading}
                className="bg-orange-500 hover:bg-orange-600 text-white">{delayUploading ? "上传中…" : "确认标记"}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete note modal */}
      {deleteNoteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteNoteTarget(null)}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <p className="text-sm text-[var(--foreground)]">确认删除这条备注？</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteNoteTarget(null)}>取消</Button>
              <Button size="sm" onClick={handleDeleteNote} disabled={deleteNoteSaving} className="bg-[var(--destructive)] text-[var(--destructive-foreground)]">{deleteNoteSaving ? "删除中…" : "确认删除"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
