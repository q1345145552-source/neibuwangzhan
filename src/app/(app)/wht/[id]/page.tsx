"use client";

import React, { useState, useEffect, use, useCallback } from "react";
import { apiCall } from "@/lib/api-call";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, Upload, MessageSquare, Trash2, X, Download, Pencil } from "lucide-react";
import { StepTimer } from "@/components/step-timer";
import { useAuth } from "@/components/auth-provider";
import { fetchWithAuth } from "@/lib/api";
import { cn, fileUrl } from "@/lib/utils";
import { getStoredAuthToken } from "@/lib/auth-storage";

// ===== Types =====
interface WhtStep {
  id: number; record_id: number; step_name: string; step_order: number;
  status: string; assignee: string;
  started_at: string | null; completed_at: string | null; created_at: string;
  notes?: string; step_data?: string;
}
interface WhtRecordDetail {
  id: number; customer_id: number; year_month: string; subtype: string;
  progress: string; company_name: string; tax_id: string; contact: string;
  notes?: string;
  steps: WhtStep[];
}
interface WhtNote {
  id: number; record_id: number; step_id: number;
  content: string; created_by: string; created_at: string;
}
interface WhtDocument {
  id: number; name: string; file_url: string; uploaded_by: string; created_at: string;
}

const stepStatusClass: Record<string, string> = {
  "待处理": "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  "进行中": "bg-[color-mix(in_oklch,var(--info),var(--background)_85%)] text-[oklch(0.38_0.10_240)]",
  "已完成": "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  "阻塞": "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]",
  "已跳过": "bg-[color-mix(in_oklch,var(--muted-foreground),var(--background)_85%)] text-[var(--muted-foreground)]",
};

export default function WhtRecordDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();

  const [record, setRecord] = useState<WhtRecordDetail | null>(null);
  const [steps, setSteps] = useState<WhtStep[]>([]);
  const [documents, setDocuments] = useState<WhtDocument[]>([]);
  const [stepNotes, setStepNotes] = useState<Record<number, WhtNote[]>>({});
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});
  const [confirmingStepId, setConfirmingStepId] = useState<number | null>(null);
  const [stepUploading, setStepUploading] = useState<Record<number, boolean>>({});
  const [stepFileNames, setStepFileNames] = useState<Record<number, string>>({});
  const [stepUploadErrors, setStepUploadErrors] = useState<Record<number, string>>({});
  const [newNotes, setNewNotes] = useState<Record<number, string>>({});
  const [noteErrorMsg, setNoteErrorMsg] = useState<Record<number, string>>({});
  const [deleteNoteTarget, setDeleteNoteTarget] = useState<{stepId:number, noteId:number, content:string} | null>(null);
  const [deletingNote, setDeletingNote] = useState(false);
  const [editingAssigneeStepId, setEditingAssigneeStepId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<{id:number, name:string}[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"notes" | "docs">("notes");

  // Sidebar state
  const [sidebarNewNote, setSidebarNewNote] = useState("");
  const [newDocName, setNewDocName] = useState("");
  const [docFileName, setDocFileName] = useState("");
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docFileUrl, setDocFileUrl] = useState("");
  const [docErrorMsg, setDocErrorMsg] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [deleteDocTarget, setDeleteDocTarget] = useState<number | null>(null);
  const [deletingDoc, setDeletingDoc] = useState(false);
  const [downloadingCert, setDownloadingCert] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey(k => k + 1), []);

  useEffect(() => {
    fetchWithAuth("/api/employees").then(r => r.json())
      .then((data: any[]) => setEmployees(data.map((e: any) => ({ id: e.id, name: e.name })).filter((e: {id:number, name:string}) => e.name)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let ignore = false;
    async function run() {
      try {
        const [recordRes, docsRes] = await Promise.all([
          fetchWithAuth(`/api/wht/records/${id}`),
          fetchWithAuth(`/api/wht/records/${id}/documents`),
        ]);
        const data = await recordRes.json();
        if (ignore) return;
        if (data.error) { setError(data.error); setLoading(false); return; }
        setRecord(data);
        const sts: WhtStep[] = data.steps || [];
        setSteps(sts);
        if (docsRes.ok) setDocuments(await docsRes.json());

        // 一次拿全部步骤的备注（原来是每个步骤一个请求）
        let notesMap: Record<number, WhtNote[]> = {};
        try {
          const r = await fetchWithAuth(`/api/wht/records/${id}/steps/details`, { cache: "no-store" });
          if (r.ok) notesMap = (await r.json()).notes || {};
        } catch { /* 拿不到就留空，不影响主体 */ }
        if (!ignore) setStepNotes(notesMap);
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "加载记录失败");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    run();
    return () => { ignore = true; };
  }, [id, refreshKey]);

  const toggleExpand = (stepId: number) => {
    setExpandedSteps((prev) => ({ ...prev, [stepId]: !prev[stepId] }));
  };

  // Update step status
  const handleStepUpdate = async (stepId: number, status: string) => {
    const res = await fetchWithAuth(`/api/wht/records/${id}/steps`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step_id: stepId, status }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || "操作失败"); }
    reload();
  };

  const handleAddNote = async (stepId: number) => {
    const content = newNotes[stepId];
    if (!content?.trim()) {
      setNoteErrorMsg(prev => ({ ...prev, [stepId]: "请填写备注内容" }));
      return;
    }
    setNoteErrorMsg(prev => ({ ...prev, [stepId]: "" }));
    const ok = await apiCall(`/api/wht/records/${id}/steps/${stepId}/notes`, {
      method: "POST", body: { content, created_by: user?.name || "系统" },
      onError: (msg) => setNoteErrorMsg(prev => ({ ...prev, [stepId]: msg })),
    });
    if (!ok) return;
    setNewNotes((prev) => ({ ...prev, [stepId]: "" }));
    const notes = await fetchWithAuth(`/api/wht/records/${id}/steps/${stepId}/notes`).then(r => r.json());
    setStepNotes((prev) => ({ ...prev, [stepId]: notes }));
  };

  const handleDeleteNote = async () => {
    if (!deleteNoteTarget) return;
    setDeletingNote(true);
    try {
      await fetchWithAuth(`/api/wht/records/${id}/steps/${deleteNoteTarget.stepId}/notes?id=${deleteNoteTarget.noteId}`, {
        method: "DELETE",
      });
      const notes = await fetchWithAuth(`/api/wht/records/${id}/steps/${deleteNoteTarget.stepId}/notes`).then(r => r.json());
      setStepNotes((prev) => ({ ...prev, [deleteNoteTarget.stepId]: notes }));
      setDeleteNoteTarget(null);
    } catch (err) {
      console.error("删除备注失败:", err);
    } finally {
      setDeletingNote(false);
    }
  };

  const handleConfirmComplete = async (stepId: number) => {
    const noteContent = newNotes[stepId]?.trim();
    setConfirmingStepId(null);
    setNewNotes((prev) => ({ ...prev, [stepId]: "" }));
    try {
      if (noteContent) {
        await fetchWithAuth(`/api/wht/records/${id}/steps/${stepId}/notes`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: noteContent, created_by: user?.name || "系统" }),
        });
      }
      await fetchWithAuth(`/api/wht/records/${id}/steps`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: stepId, status: "已完成" }),
      });
      // 自动启动下一步（跳过"已跳过"的步骤）
      const idx = steps.findIndex(s => s.id === stepId);
      let nextIdx = idx + 1;
      while (nextIdx < steps.length) {
        const next = steps[nextIdx];
        if (next.status === "已跳过") { nextIdx++; continue; }
        if (next.status === "待处理") {
          await fetchWithAuth(`/api/wht/records/${id}/steps`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ step_id: next.id, status: "进行中" }),
          });
        }
        break;
      }
      reload();
    } catch (e) { console.error("[WHT] 步骤完成失败", e); setError(e instanceof Error ? e.message : "更新失败"); }
  };

  // 撤回步骤
  const handleRollback = async (stepId: number) => {
    try {
      await fetchWithAuth(`/api/wht/records/${id}/steps`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: stepId, status: "进行中" }),
      });
      reload();
    } catch (e) { console.error("[WHT] 步骤撤回失败", e); setError(e instanceof Error ? e.message : "撤回失败"); }
  };

  // Update assignee
  const handleUpdateAssignee = async (stepId: number, assignee: string) => {
    try {
      await fetchWithAuth(`/api/wht/records/${id}/steps`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: stepId, assignee }),
      });
      setEditingAssigneeStepId(null);
      reload();
    } catch (e) { console.error("[WHT] 修改负责人失败", e); setError(e instanceof Error ? e.message : "修改失败"); }
  };

  // Sidebar: add record-level note
  const handleAddSidebarNote = async () => {
    if (!sidebarNewNote.trim()) return;
    try {
      await fetchWithAuth(`/api/wht/records/${id}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: sidebarNewNote, created_by: user?.name || "系统" }),
      });
      setSidebarNewNote("");
      reload();
    } catch (e) { console.error("[WHT] 添加备注失败", e); }
  };

  // Sidebar: add document
  const handleAddDocument = async () => {
    if (!newDocName.trim()) { setDocErrorMsg("请填写文件名称"); return; }
    try {
      await fetchWithAuth(`/api/wht/records/${id}/documents`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newDocName, file_url: docFileUrl, uploaded_by: user?.name || "" }),
      });
      setNewDocName(""); setDocFileUrl(""); setDocFileName(""); setDocErrorMsg("");
      const docsRes = await fetchWithAuth(`/api/wht/records/${id}/documents`);
      if (docsRes.ok) setDocuments(await docsRes.json());
    } catch (e) { console.error("[WHT] 添加文件失败", e); setDocErrorMsg("添加失败"); }
  };

  const handleDeleteDoc = async () => {
    if (!deleteDocTarget) return;
    setDeletingDoc(true);
    try {
      await fetchWithAuth(`/api/wht/records/${id}/documents?id=${deleteDocTarget}`, { method: "DELETE" });
      setDeleteDocTarget(null);
      const docsRes = await fetchWithAuth(`/api/wht/records/${id}/documents`);
      if (docsRes.ok) setDocuments(await docsRes.json());
    } catch (e) { console.error("[WHT] 删除文件失败", e); }
    finally { setDeletingDoc(false); }
  };

  // 下载 50ทวิ
  const handleDownloadCert = async () => {
    setDownloadingCert(true);
    try {
      const res = await fetchWithAuth(`/api/wht/records/${id}/certificate`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "下载失败"); }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `50tawi-${record?.company_name || "unknown"}-${record?.year_month || ""}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[WHT] 下载50ทวิ失败", e);
      setError(e instanceof Error ? e.message : "下载失败");
    } finally {
      setDownloadingCert(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="animate-pulse space-y-4">
          <div className="h-7 w-48 rounded bg-[var(--muted)]" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-96 rounded-xl bg-[var(--muted)]" />
            <div className="h-40 rounded-xl bg-[var(--muted)]" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !record) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-[var(--muted-foreground)]">{error}</p>
        <Button variant="ghost" size="sm" className="mt-4" onClick={() => router.back()}>返回申报列表</Button>
      </div>
    );
  }

  if (!record) return null;

  const isWht53 = record.subtype === "ภ.ง.ด.53";

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
          <Button variant="ghost" size="icon-sm" onClick={() => router.push("/wht")} aria-label="返回申报列表"><ArrowLeft className="size-4" aria-hidden="true" /></Button>
          <div className="flex-1">
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>{record.company_name}</h1>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] text-[var(--primary)]">{record.subtype}</span>
              <span className="text-xs text-[var(--muted-foreground)]">{record.year_month}</span>
              {record.tax_id && <span className="text-xs text-[var(--muted-foreground)]">税号: {record.tax_id}</span>}
              <span className="text-xs text-[var(--muted-foreground)]">· {steps.filter(s => s.status === "已完成").length}/{steps.length} 已完成</span>
              {steps.length > 0 && steps[0].status === "待处理" && (
                <button onClick={() => handleStepUpdate(steps[0].id, "进行中")} className="rounded border border-[color-mix(in_oklch,var(--primary),var(--background)_60%)] bg-[color-mix(in_oklch,var(--primary),var(--background)_90%)] px-3 py-1 text-xs font-medium text-[var(--primary)] hover:bg-[color-mix(in_oklch,var(--primary),var(--background)_82%)] transition-colors">开始任务</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Basic info */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">基本信息</h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div><dt className="text-xs text-[var(--muted-foreground)]">公司名称</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{record.company_name}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">申报月份</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{record.year_month}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">子类型</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{record.subtype}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">税号</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{record.tax_id || "—"}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">联系方式</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{record.contact || "—"}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">当前进度</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{record.progress || "—"}</dd></div>
            </dl>
          </div>

          {/* Progress tracking */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">进度追踪</h3>
            {steps.length > 0 && (
              <div className="mb-5 flex items-center gap-3">
                <span className="text-xs text-[var(--muted-foreground)] shrink-0">已完成 {steps.filter(s => s.status === "已完成").length}/{steps.length}</span>
                <div className="flex-1 h-2 rounded-full bg-[var(--muted)] overflow-hidden">
                  <div className="h-full rounded-full bg-[var(--success)] transition-all duration-300" style={{ width: `${Math.round(steps.filter(s => s.status === "已完成" || s.status === "已跳过").length / steps.length * 100)}%` }} />
                </div>
                <span className="text-xs font-medium shrink-0 text-[var(--muted-foreground)]">
                  {steps.filter(s => s.status === "已完成" || s.status === "已跳过").length === steps.length ? "全部完成" : `${Math.round(steps.filter(s => s.status === "已完成" || s.status === "已跳过").length / steps.length * 100)}%`}
                </span>
              </div>
            )}

            {steps.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">暂无步骤</p>
            ) : (
              <div className="flex flex-col gap-0">
                {steps.map((step, i) => {
                  const notes = stepNotes[step.id] || [];
                  const expanded = expandedSteps[step.id] || false;
                  const hasNotes = notes.length > 0;
                  const isWht1Step3 = record.subtype === "ภ.ง.ด.1" && step.step_order === 3;

                  return (
                    <div key={step.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                          step.status === "已完成" && "bg-[var(--success)] text-[var(--success-foreground)]",
                          step.status === "进行中" && "bg-[var(--primary)] text-[var(--primary-foreground)] ring-2 ring-[var(--ring)]/30",
                          step.status === "阻塞" && "bg-[var(--destructive)] text-[var(--destructive-foreground)]",
                          step.status === "待处理" && "bg-[var(--muted)] text-[var(--muted-foreground)]",
                          step.status === "已跳过" && "bg-[var(--muted)] text-[var(--muted-foreground)]"
                        )}>{step.status === "已完成" ? "✓" : step.status === "已跳过" ? "—" : step.step_order}</div>
                        {i < steps.length - 1 && <div className={cn("w-px flex-1 min-h-[20px]", step.status === "已完成" || step.status === "已跳过" ? "bg-[var(--success)]" : "bg-[var(--border)]")} />}
                      </div>
                      <div className="pb-5 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn("text-sm font-medium", step.status === "已跳过" && "text-[var(--muted-foreground)]")}>{step.step_name}</span>
                          <span className={cn("rounded px-1.5 py-0.5 text-[0.65rem] font-medium", stepStatusClass[step.status] || "bg-[var(--muted)] text-[var(--muted-foreground)]")}>{step.status}</span>

                          {/* Assignee */}
                          {editingAssigneeStepId === step.id ? (
                            <select
                              className="h-6 rounded border border-[var(--border)] bg-[var(--background)] px-1 text-xs outline-none"
                              value={step.assignee || ""}
                              onChange={(e) => handleUpdateAssignee(step.id, e.target.value)}
                              onBlur={() => setEditingAssigneeStepId(null)}
                              autoFocus
                            >
                              <option value="">选择负责人</option>
                              {employees.map(emp => (
                                <option key={emp.id} value={emp.name}>{emp.name}</option>
                              ))}
                            </select>
                          ) : (
                            <button onClick={() => setEditingAssigneeStepId(step.id)} className="flex items-center gap-0.5 rounded px-1 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
                              <span>{step.assignee || "未分配"}</span>
                              <Pencil className="size-2.5" />
                            </button>
                          )}

                          {/* Timer */}
                          <div className="ml-auto">
                            <StepTimer
                              created_at={step.created_at}
                              started_at={step.started_at}
                              completed_at={step.completed_at}
                              status={step.status}
                              prev_completed_at={i > 0 ? steps[i - 1].completed_at : null}
                            />
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                          {step.status === "待处理" && (
                            <button onClick={() => handleStepUpdate(step.id, "进行中")} className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors">开始</button>
                          )}
                          {step.status === "进行中" && (
                            <>
                              <button onClick={() => setConfirmingStepId(step.id)} className="rounded bg-[var(--success)] px-2 py-1 text-xs text-white hover:bg-[color-mix(in_oklch,var(--success),var(--foreground)_15%)] transition-colors">标记完成</button>
                              {/* WHT53 step 4: 下载 50ทวิ */}
                              {isWht53 && step.step_order === 4 && (
                                <button onClick={handleDownloadCert} disabled={downloadingCert} className="rounded border border-[color-mix(in_oklch,var(--primary),var(--background)_60%)] bg-[color-mix(in_oklch,var(--primary),var(--background)_90%)] px-2 py-1 text-xs text-[var(--primary)] hover:bg-[color-mix(in_oklch,var(--primary),var(--background)_82%)] transition-colors disabled:opacity-50">
                                  <Download className="inline size-3 mr-1" />
                                  {downloadingCert ? "生成中..." : "下载 50ทวิ"}
                                </button>
                              )}
                            </>
                          )}
                          {step.status === "已完成" && (
                            <button onClick={() => handleRollback(step.id)} className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">撤回</button>
                          )}
                          {/* WHT1 step 3: toggle skip */}
                          {isWht1Step3 && (
                            step.status === "已跳过" ? (
                              <button onClick={() => handleStepUpdate(step.id, "待处理")} className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--primary)] hover:bg-[var(--muted)] transition-colors">启用此步骤</button>
                            ) : step.status === "待处理" ? (
                              <button onClick={() => handleStepUpdate(step.id, "已跳过")} className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">跳过此步骤</button>
                            ) : null
                          )}

                          {/* Step file upload button */}
                          <label className={cn("cursor-pointer rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs hover:bg-[var(--muted)] transition-colors", step.status === "已跳过" && "opacity-50 pointer-events-none")}>
                            <Upload className="inline size-3 mr-1" />
                            {stepUploading[step.id] ? "上传中..." : stepFileNames[step.id] || "上传文件"}
                            <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" disabled={step.status === "已跳过" || stepUploading[step.id]} onChange={async (e) => {
                              const file = e.target.files?.[0]; if (!file) return;
                              setStepUploading(p => ({ ...p, [step.id]: true }));
                              setStepFileNames(p => ({ ...p, [step.id]: file.name }));
                              setStepUploadErrors(p => ({ ...p, [step.id]: "" }));
                              try {
                                const fd = new FormData(); fd.append("file", file);
                                const ur = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
                                if (!ur.ok) throw new Error("上传失败");
                                const { url } = await ur.json();
                                const note = "上传文件: " + file.name + " (" + url + ")";
                                const nr = await fetchWithAuth(`/api/wht/records/${id}/steps/${step.id}/notes`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ content: note }),
                                });
                                if (!nr.ok) throw new Error("保存失败");
                                setStepUploadErrors(p => ({ ...p, [step.id]: "" }));
                                reload();
                              } catch (err) {
                                const msg = err instanceof Error ? err.message : String(err);
                                console.error("[WHT步骤附件上传失败]", { stepId: step.id, fileName: file.name, error: msg });
                                setStepUploadErrors(p => ({ ...p, [step.id]: msg }));
                              } finally {
                                setStepUploading(p => ({ ...p, [step.id]: false }));
                                setStepFileNames(p => ({ ...p, [step.id]: "" }));
                              }
                            }} />
                          </label>
                          {stepUploadErrors[step.id] && (
                            <span className="text-xs text-[var(--destructive)]">{stepUploadErrors[step.id]}</span>
                          )}
                        </div>

                        {/* Expand/collapse for notes */}
                        <button onClick={() => toggleExpand(step.id)} className="mt-1 flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
                          <MessageSquare className="size-3" />
                          {hasNotes && <span className="rounded-full bg-[var(--muted)] px-1.5 text-[0.65rem]">{notes.length}</span>}
                          {expanded ? "收起" : "备注"}
                        </button>

                        {expanded && (
                          <div className="mt-3 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                            {/* Step notes display from notes field */}
                            {(step.notes || "") && (() => { const isWarning = (step.notes||"").startsWith("⚠️"); return (
                              <div className={isWarning ? "rounded-md border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-800 dark:bg-amber-950/30" : "rounded-md border border-[var(--border)] bg-[var(--muted)]/50 p-2.5"}>
                                <div className="flex items-start gap-1.5">
                                  <span className="shrink-0 text-sm">{isWarning ? "⚠️" : "📋"}</span>
                                  <p className={"text-xs leading-relaxed "+(isWarning ? "text-amber-800 dark:text-amber-200 font-medium" : "text-[var(--foreground)]")}>{(step.notes||"").replace(/^[⚠️📋]\s*/,"")}</p>
                                </div>
                              </div>
                            ); })()}
                            {/* Notes list */}
                            <div>
                              <h4 className="mb-2 text-xs font-medium text-[var(--foreground)]">备注记录</h4>
                              {notes.length === 0 ? (
                                <p className="text-xs text-[var(--muted-foreground)]">暂无备注</p>
                              ) : (
                                <ul className="space-y-1.5 mb-2">
                                  {notes.map((n) => (
                                    <li key={n.id} className="rounded bg-[var(--muted)] px-2.5 py-1.5 text-xs text-[var(--foreground)]">
                                      <div className="flex items-start justify-between gap-2">
                                        {(() => {
                                          const ftMatch = n.content.match(/上传文件:\s*(.+?)\s*\(\/api\/files\/([^)]+)\)/);
                                          if (ftMatch) {
                                            const [, ftName, ftPath] = ftMatch;
                                            return <a href={"/api/files/" + ftPath + "?token=" + (getStoredAuthToken() || "")} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[var(--primary)] hover:underline">
                                              <FileText className="size-3.5 shrink-0" />
                                              <span className="truncate max-w-[200px]">{ftName}</span>
                                            </a>;
                                          }
                                          return <p className="flex-1">{n.content}</p>;
                                        })()}
                                        <button onClick={() => setDeleteNoteTarget({stepId: step.id, noteId: n.id, content: n.content})} className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] transition-colors" title="删除备注"><Trash2 className="size-3" /></button>
                                      </div>
                                      <p className="mt-0.5 text-[0.65rem] text-[var(--muted-foreground)]">{n.created_by} · {n.created_at?.slice(0, 16)}</p>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              <div className="flex gap-1.5">
                                <input value={newNotes[step.id] || ""} onChange={(e) => { setNewNotes((p) => ({ ...p, [step.id]: e.target.value })); setNoteErrorMsg(prev => ({ ...prev, [step.id]: "" })); }} onKeyDown={(e) => e.key === "Enter" && handleAddNote(step.id)} placeholder="写备注..." className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                                <button onClick={() => handleAddNote(step.id)} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_15%)]">添加</button>
                              </div>
                              {noteErrorMsg[step.id] && <p className="text-xs text-[var(--destructive)]">{noteErrorMsg[step.id]}</p>}
                            </div>
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

        {/* Sidebar */}
        <div className="flex flex-col gap-4">
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--muted)] p-0.5">
            <button onClick={() => setSidebarTab("notes")} className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors", sidebarTab === "notes" ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)]")}><MessageSquare className="mr-1 inline size-3" />申报备注</button>
            <button onClick={() => setSidebarTab("docs")} className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors", sidebarTab === "docs" ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)]")}><FileText className="mr-1 inline size-3" />申报文件</button>
          </div>

          {sidebarTab === "notes" && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <h4 className="mb-3 text-xs font-medium text-[var(--foreground)]">申报备注</h4>
              {record.notes ? (
                <div className="mb-3 whitespace-pre-wrap rounded bg-[var(--muted)] p-3 text-xs text-[var(--foreground)]">{record.notes}</div>
              ) : (
                <p className="mb-3 text-xs text-[var(--muted-foreground)]">暂无备注</p>
              )}
              <div className="space-y-2">
                <textarea
                  value={sidebarNewNote}
                  onChange={(e) => setSidebarNewNote(e.target.value)}
                  placeholder="添加备注..."
                  rows={3}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs outline-none focus:border-[var(--ring)] resize-none"
                />
                <button onClick={handleAddSidebarNote} className="w-full rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_15%)]">添加备注</button>
              </div>
            </div>
          )}

          {sidebarTab === "docs" && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <h4 className="mb-3 text-xs font-medium text-[var(--foreground)]">申报文件</h4>
              {documents.length === 0 ? (
                <p className="mb-3 text-xs text-[var(--muted-foreground)]">暂无文件</p>
              ) : (
                <ul className="space-y-2 mb-3">
                  {documents.map((doc) => (
                    <li key={doc.id} className="flex items-start justify-between gap-2 rounded bg-[var(--muted)] px-2.5 py-1.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[var(--foreground)] flex items-center gap-1.5">
                          <FileText className="size-3 shrink-0 text-[var(--muted-foreground)]" />
                          <span className="truncate">{doc.name}</span>
                          {doc.file_url && (
                            /\.(jpg|jpeg|png|gif|webp)$/i.test(doc.file_url) ? (
                              <img src={fileUrl(doc.file_url)} alt={doc.name} className="size-4 rounded object-cover cursor-pointer hover:opacity-80 transition-opacity ml-1.5" onClick={() => setPreviewUrl(doc.file_url ?? null)} />
                            ) : (
                              <> <a href={fileUrl(doc.file_url)} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--primary)] hover:underline">查看文件</a></>
                            )
                          )}
                        </p>
                        <span className="text-[0.65rem] text-[var(--muted-foreground)]">{doc.uploaded_by} · {doc.created_at?.slice(0, 16)}</span>
                      </div>
                      <button onClick={() => setDeleteDocTarget(doc.id)} className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] transition-colors" title="删除文件"><Trash2 className="size-3" /></button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <input
                    placeholder="文件名称..."
                    value={newDocName}
                    onChange={(e) => { setNewDocName(e.target.value); setDocErrorMsg(""); }}
                    className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]"
                  />
                  <label className="shrink-0 cursor-pointer rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
                    <Upload className="inline size-3 mr-1" />
                    {uploadingDoc ? "上传中..." : "选择文件"}
                    <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0]; if (!file) return;
                      setUploadingDoc(true); setDocFileName(file.name);
                      try {
                        const form = new FormData();
                        form.append("file", file);
                        const res = await fetchWithAuth("/api/upload", { method: "POST", body: form });
                        if (!res.ok) throw new Error("");
                        const data = await res.json();
                        setDocFileUrl(data.url);
                      } catch { setDocErrorMsg("文件上传失败"); setDocFileName(""); }
                      finally { setUploadingDoc(false); }
                    }} disabled={uploadingDoc} />
                  </label>
                </div>
                {docFileName && <p className="text-xs text-[var(--muted-foreground)]">已选择: {docFileName}</p>}
                {docErrorMsg && <p className="text-xs text-[var(--destructive)]">{docErrorMsg}</p>}
                <button onClick={handleAddDocument} className="w-full rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_15%)]">添加文件</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirm complete step modal */}
      {confirmingStepId !== null && (() => {
        const step = steps.find(s => s.id === confirmingStepId);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmingStepId(null)}>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="font-semibold text-[var(--foreground)]">确认完成步骤</h3>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                确定要将步骤 <span className="font-medium text-[var(--foreground)]">「{step?.step_name}」</span> 标记为完成吗？
              </p>
              {newNotes[confirmingStepId]?.trim() && (
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">备注：{newNotes[confirmingStepId]}</p>
              )}
              <div className="mt-5 flex justify-end gap-3">
                <button onClick={() => setConfirmingStepId(null)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors">取消</button>
                <button onClick={() => handleConfirmComplete(confirmingStepId)} className="rounded-lg bg-[var(--success)] px-4 py-2 text-sm font-medium text-white hover:bg-[color-mix(in_oklch,var(--success),var(--foreground)_20%)] transition-colors">确认完成</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delete note confirm modal */}
      {deleteNoteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteNoteTarget(null)}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-[var(--foreground)]">确认删除备注</h3>
            <p className="mt-2 text-sm text-[var(--muted-foreground)] line-clamp-2">{deleteNoteTarget.content}</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">此操作不可恢复。</p>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setDeleteNoteTarget(null)} disabled={deletingNote} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50">取消</button>
              <button onClick={handleDeleteNote} disabled={deletingNote} className="rounded-lg bg-[var(--destructive)] px-4 py-2 text-sm font-medium text-white hover:bg-[color-mix(in_oklch,var(--destructive),var(--foreground)_20%)] transition-colors disabled:opacity-50">
                {deletingNote ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image preview overlay */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center cursor-pointer" onClick={() => setPreviewUrl(null)} onKeyDown={(e) => { if (e.key === "Escape") setPreviewUrl(null); }}>
          <img src={fileUrl(previewUrl)} alt="预览" className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl" />
        </div>
      )}

      {/* Delete document confirm modal */}
      {deleteDocTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteDocTarget(null)}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-[var(--foreground)]">确认删除文件</h3>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">确定要删除这份文件吗？此操作不可恢复。</p>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setDeleteDocTarget(null)} disabled={deletingDoc} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50">取消</button>
              <button onClick={handleDeleteDoc} disabled={deletingDoc} className="rounded-lg bg-[var(--destructive)] px-4 py-2 text-sm font-medium text-white hover:bg-[color-mix(in_oklch,var(--destructive),var(--foreground)_20%)] transition-colors disabled:opacity-50">
                {deletingDoc ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
