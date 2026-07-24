"use client";

import React, { useState, useEffect, use, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, Upload, MessageSquare, Trash2, X, Download } from "lucide-react";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { StepTimeline, type TimelineStep, type TimelineNote, type TimelineEmployee } from "@/components/step-timeline";
import { cn, fileUrl } from "@/lib/utils";

// ===== Types =====
interface WhtStep {
  id: number; record_id: number; step_name: string; step_order: number;
  status: string; assignee: string;
  started_at: string | null; completed_at: string | null; created_at: string;
}
interface WhtRecordDetail {
  id: number; customer_id: number; year_month: string; subtype: string;
  progress: string; company_name: string; tax_id: string; contact: string;
  notes?: string;
  steps: WhtStep[];
}
interface WhtDocument {
  id: number; name: string; file_url: string; uploaded_by: string; created_at: string;
}

export default function WhtRecordDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();

  const [record, setRecord] = useState<WhtRecordDetail | null>(null);
  const [steps, setSteps] = useState<WhtStep[]>([]);
  const [documents, setDocuments] = useState<WhtDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [stepNotes, setStepNotes] = useState<Record<number, TimelineNote[]>>({});
  const [employees, setEmployees] = useState<TimelineEmployee[]>([]);
  const [sidebarTab, setSidebarTab] = useState<"notes" | "files">("notes");

  // Sidebar state
  const [newNote, setNewNote] = useState("");
  const [newDocName, setNewDocName] = useState("");
  const [docFileName, setDocFileName] = useState("");
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docFileUrl, setDocFileUrl] = useState("");
  const [docErrorMsg, setDocErrorMsg] = useState("");
  const [noteErrorMsg, setNoteErrorMsg] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [deleteDocTarget, setDeleteDocTarget] = useState<number | null>(null);
  const [deletingDoc, setDeletingDoc] = useState(false);
  const [downloadingCert, setDownloadingCert] = useState(false);
  const [stepsError, setStepsError] = useState("");
  const initialLoadDone = useRef(false);

  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey(k => k + 1), []);

  // load employees
  useEffect(() => {
    fetchWithAuth("/api/employees").then(r => r.json())
      .then((data: any[]) => setEmployees(data.map((e: any) => ({ id: e.id, name: e.name })).filter((e: TimelineEmployee) => e.name)))
      .catch(() => {});
  }, []);

  // load record + steps + notes + documents
  useEffect(() => {
    let ignore = false;
    async function run() {
      try {
        const res = await fetchWithAuth(`/api/wht/records/${id}`);
        const data = await res.json();
        if (ignore) return;
        if (data.error) {
          if (initialLoadDone.current) { setStepsError(data.error); } else { setError(data.error); }
          setLoading(false); return;
        }
        setRecord(data);
        initialLoadDone.current = true;
        setStepsError("");
        const sts = data.steps || [];
        setSteps(sts);

        // Load step notes
        const notesMap: Record<number, TimelineNote[]> = {};
        await Promise.all(sts.map(async (s: WhtStep) => {
          try {
            notesMap[s.id] = await fetchWithAuth(`/api/wht/records/${id}/steps/${s.id}/notes`).then(r => r.json());
          } catch { notesMap[s.id] = []; }
        }));
        if (!ignore) setStepNotes(notesMap);

        // Load sidebar documents
        try {
          const docsRes = await fetchWithAuth(`/api/wht/records/${id}/documents`);
          if (docsRes.ok) setDocuments(await docsRes.json());
        } catch {}
      } catch {
        if (!ignore) {
          if (initialLoadDone.current) { setStepsError("加载记录失败"); }
          else { setError("加载记录失败"); }
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    run();
    return () => { ignore = true; };
  }, [id, refreshKey]);

  // ===== Callbacks for StepTimeline =====
  const handleStart = useCallback(async (stepId: number) => {
    const res = await fetchWithAuth(`/api/wht/records/${id}/steps`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step_id: stepId, status: "进行中" }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || "开始失败"); }
    reload();
  }, [id, reload]);

  const handleComplete = useCallback(async (stepId: number, note?: string) => {
    if (note) {
      await fetchWithAuth(`/api/wht/records/${id}/steps/${stepId}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: note, created_by: user?.name || "系统" }),
      });
    }
    const res = await fetchWithAuth(`/api/wht/records/${id}/steps`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step_id: stepId, status: "已完成" }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || "完成失败"); }
    // 自动启动下一个待处理的步骤（跳过已标记跳过的步骤）
    const idx = steps.findIndex(s => s.id === stepId);
    if (idx >= 0 && idx < steps.length - 1) {
      for (let i = idx + 1; i < steps.length; i++) {
        if (steps[i].status === "已跳过") continue;
        if (steps[i].status === "待处理") {
          await fetchWithAuth(`/api/wht/records/${id}/steps`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ step_id: steps[i].id, status: "进行中" }),
          });
          break;
        }
        // already started/completed → stop looking
        break;
      }
    }
    reload();
  }, [id, reload, user, steps]);

  const handleRollback = useCallback(async (stepId: number) => {
    const res = await fetchWithAuth(`/api/wht/records/${id}/steps`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step_id: stepId, status: "进行中" }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || "撤回失败"); }
    reload();
  }, [id, reload]);

  const handleBlock = useCallback(async (stepId: number) => {
    const res = await fetchWithAuth(`/api/wht/records/${id}/steps`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step_id: stepId, status: "阻塞" }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || "操作失败"); }
    reload();
  }, [id, reload]);

  const handleUpload = useCallback(async (stepId: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetchWithAuth("/api/upload", { method: "POST", body: form });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "上传失败"); }
    const data = await res.json();
    const note = `📎 ${file.name}\n/api/files/${data.id || data.url?.split("/").pop()}`;
    await fetchWithAuth(`/api/wht/records/${id}/steps/${stepId}/notes`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: note, created_by: user?.name || "系统" }),
    });
    reload();
  }, [id, reload, user]);

  const handleAddNote = useCallback(async (stepId: number, content: string) => {
    await fetchWithAuth(`/api/wht/records/${id}/steps/${stepId}/notes`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, created_by: user?.name || "系统" }),
    });
    reload();
  }, [id, reload, user]);

  const handleDeleteNote = useCallback(async (stepId: number, noteId: number) => {
    await fetchWithAuth(`/api/wht/records/${id}/steps/${stepId}/notes?id=${noteId}`, { method: "DELETE" });
    reload();
  }, [id, reload]);

  const handleAssigneeChange = useCallback(async (stepId: number, assignee: string) => {
    const res = await fetchWithAuth(`/api/wht/records/${id}/steps`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step_id: stepId, assignee }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || "修改失败"); }
    reload();
  }, [id, reload]);

  // ===== Sidebar: Add document =====
  const handleAddDocument = async () => {
    if (!newDocName.trim()) { setDocErrorMsg("请填写文档名"); return; }
    setDocErrorMsg("");
    try {
      await fetchWithAuth(`/api/wht/records/${id}/documents`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newDocName, file_url: docFileUrl, uploaded_by: user?.name || "系统" }),
      });
      setNewDocName(""); setDocFileUrl(""); setDocFileName("");
      reload();
    } catch { setDocErrorMsg("添加失败"); }
  };

  const handleDeleteDoc = async () => {
    if (!deleteDocTarget) return;
    setDeletingDoc(true);
    try {
      await fetchWithAuth(`/api/wht/records/${id}/documents?id=${deleteDocTarget}`, { method: "DELETE" });
      setDeleteDocTarget(null);
      reload();
    } catch { setDeletingDoc(false); }
  };

  // ===== Sidebar: Add record note =====
  const handleAddRecordNote = async () => {
    if (!newNote.trim()) { setNoteErrorMsg("请填写备注内容"); return; }
    setNoteErrorMsg("");
    try {
      await fetchWithAuth(`/api/wht/records/${id}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newNote, created_by: user?.name || "系统" }),
      });
      setNewNote("");
      reload();
    } catch { setNoteErrorMsg("添加失败"); }
  };

  const timelineSteps: TimelineStep[] = steps;

  // ===== Loading =====
  if (loading) return (
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

  // ===== Error =====
  if (error && !record) return (
    <div className="flex flex-col items-center justify-center py-20">
      <p className="text-sm text-[var(--muted-foreground)]">{error}</p>
      <Button variant="ghost" size="sm" className="mt-4" onClick={() => router.push("/wht")}>返回</Button>
    </div>
  );

  if (!record) return null;

  const completedCount = steps.filter(s => s.status === "已完成" || s.status === "已跳过").length;

  // Parse record notes
  const recordNotes = record.notes ? record.notes.split("\n\n").filter(Boolean).map((block: string) => {
    const lines = block.split("\n");
    const content = lines[0] || "";
    const metaMatch = lines[1]?.match(/^— (.+?) (.+)$/);
    return {
      content,
      created_by: metaMatch ? metaMatch[1] : "",
      created_at: metaMatch ? metaMatch[2] : "",
    };
  }) : [];

  return (
    <div className="flex flex-col gap-6">
      {/* Header row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.push("/wht")} aria-label="返回">
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
          <div className="flex-1">
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>
              {record.company_name}
            </h1>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center rounded-full bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] px-2.5 py-0.5 text-xs font-medium text-[var(--primary)]">
                {record.subtype}
              </span>
              <span className="text-xs text-[var(--muted-foreground)]">{record.year_month}</span>
              {record.tax_id && <span className="text-xs text-[var(--muted-foreground)]">· 税号: {record.tax_id}</span>}
              <span className="text-xs text-[var(--muted-foreground)]">· {completedCount}/{steps.length} 已完成</span>
              {completedCount === steps.length && (
                <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]">已归档</span>
              )}
              {/* 开始任务按钮 */}
              {steps.length > 0 && steps[0].status === "待处理" && (
                <button onClick={() => handleStart(steps[0].id)} className="rounded border border-[color-mix(in_oklch,var(--primary),var(--background)_60%)] bg-[color-mix(in_oklch,var(--primary),var(--background)_90%)] px-3 py-1 text-xs font-medium text-[var(--primary)] hover:bg-[color-mix(in_oklch,var(--primary),var(--background)_82%)] transition-colors">开始任务</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Basic info */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">基本信息</h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div><dt className="text-xs text-[var(--muted-foreground)]">公司名称</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{record.company_name}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">税号</dt><dd className="mt-1 text-sm font-mono text-[var(--foreground)]">{record.tax_id || "—"}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">申报月份</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{record.year_month}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">子类型</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{record.subtype}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">联系方式</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{record.contact || "—"}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">状态</dt><dd className="mt-1 text-sm text-[var(--foreground)]">
                <span className={cn(
                  "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                  record.progress === "归档" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                )}>{record.progress}</span>
              </dd></div>
            </dl>
          </div>

          {/* Progress tracking */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">进度追踪</h3>
            {steps.length > 0 && (
              <div className="mb-5 flex items-center gap-3">
                <span className="text-xs text-[var(--muted-foreground)] shrink-0">已完成 {completedCount}/{steps.length}</span>
                <div className="flex-1 h-2 rounded-full bg-[var(--muted)] overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all duration-300", completedCount === steps.length ? "bg-[var(--success)]" : "bg-[var(--success)]")} style={{ width: `${Math.round(completedCount / steps.length * 100)}%` }} />
                </div>
                <span className="text-xs font-medium shrink-0 text-[var(--muted-foreground)]">{completedCount === steps.length ? "全部完成" : `${Math.round(completedCount / steps.length * 100)}%`}</span>
              </div>
            )}
            {stepsError && (
              <div className="rounded-lg border border-[var(--destructive)] bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] px-4 py-3 text-sm text-[var(--destructive)] flex items-center justify-between mb-4">
                <span>{stepsError}</span>
                <button onClick={() => setStepsError("")} className="ml-3 hover:opacity-70 text-lg leading-none">&times;</button>
              </div>
            )}
            {steps.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">暂无步骤</p>
            ) : (
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
                hidePerStepStart
                renderHeaderBadges={(step) => {
                  if (record?.subtype !== "ภ.ง.ด.53" || step.step_order !== 4) return null;
                  return (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        setDownloadingCert(true);
                        try {
                          const res = await fetchWithAuth(`/api/wht/records/${id}/certificate`);
                          if (!res.ok) throw new Error("");
                          const blob = await res.blob();
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `50tawi-${record.company_name}-${record.year_month}.pdf`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          window.URL.revokeObjectURL(url);
                        } catch { alert("下载失败，请重试"); }
                        finally { setDownloadingCert(false); }
                      }}
                      disabled={downloadingCert}
                      className="inline-flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
                    >
                      <Download className="size-3" />
                      {downloadingCert ? "下载中..." : "下载 50ทวิ"}
                    </button>
                  );
                }}
              />
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="flex flex-col gap-4">
          {/* Tab switcher */}
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--muted)] p-0.5">
            <button
              onClick={() => setSidebarTab("notes")}
              className={cn(
                "flex-1 rounded-md py-1.5 text-xs font-medium transition-colors",
                sidebarTab === "notes"
                  ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              )}
            >
              <MessageSquare className="size-3.5 inline mr-1" />申报备注
            </button>
            <button
              onClick={() => setSidebarTab("files")}
              className={cn(
                "flex-1 rounded-md py-1.5 text-xs font-medium transition-colors",
                sidebarTab === "files"
                  ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              )}
            >
              <FileText className="size-3.5 inline mr-1" />申报文件
            </button>
          </div>

          {sidebarTab === "notes" && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <h4 className="mb-3 text-[0.65rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)] border-b border-[var(--border)] pb-2">申报备注</h4>
              {recordNotes.length > 0 && (
                <div className="mb-3 space-y-2">
                  {recordNotes.map((n, i) => (
                    <div key={i} className="rounded bg-[var(--muted)] px-3 py-2 text-xs text-[var(--foreground)]">
                      <p>{n.content}</p>
                      <p className="mt-1 text-[0.65rem] text-[var(--muted-foreground)]">{n.created_by} · {n.created_at}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 space-y-1.5">
                <textarea
                  value={newNote}
                  onChange={(e) => { setNewNote(e.target.value); setNoteErrorMsg(""); }}
                  placeholder="添加申报备注..."
                  rows={3}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] resize-none"
                />
                {noteErrorMsg && <p className="text-xs text-[var(--destructive)]">{noteErrorMsg}</p>}
                <button onClick={handleAddRecordNote} className="shrink-0 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_15%)]">添加备注</button>
              </div>
            </div>
          )}

          {sidebarTab === "files" && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <h4 className="mb-3 text-[0.65rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)] border-b border-[var(--border)] pb-2">申报文件</h4>
              {documents.length === 0 ? (
                <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">暂无文件</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {documents.map((doc) => (
                    <li key={doc.id} className="flex items-center gap-2 rounded-md p-2 transition-colors hover:bg-[var(--secondary)]">
                      <FileText className="size-3.5 shrink-0 text-[var(--muted-foreground)]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-[var(--foreground)]">{doc.name}
                          {doc.file_url && (
                            /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(doc.file_url) ? (
                              <img src={fileUrl(doc.file_url)} alt={doc.name} className="max-h-10 rounded border border-[var(--border)] cursor-pointer hover:opacity-80 transition-opacity ml-1.5" onClick={() => setPreviewUrl(doc.file_url ?? null)} />
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
              <div className="mt-3 space-y-1.5">
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
