"use client";

import React, { useState, useEffect, use, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, DollarSign, Paperclip, Upload, MessageSquare, CheckCircle2, Circle, Trash2, X, Copy, CheckCheck, Link2, Pencil, Edit3, Save } from "lucide-react";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { StepTimeline, type TimelineStep, type TimelineNote, type TimelineEmployee } from "@/components/step-timeline";
import { cn, fileUrl } from "@/lib/utils";

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
interface VatDocument {
  id: number; name: string; file_url: string; uploaded_by: string; created_at: string;
}
interface VatStepDoc {
  id: number; step_id: number; record_id: number; document_name: string; status: string;
}
interface VatFinance {
  id: number; record_id: number; type: string; amount: number;
  description: string; payment_method: string; slip_number: string;
  slip_file: string; status: string; currency: string; created_at: string;
}

const PAYMENT_STATUSES = [
  { value: "通知客户付款", label: "通知客户付款" },
  { value: "已付款", label: "已付款" },
  { value: "逾期未付", label: "逾期未付" },
];

const stepStatusBadge: Record<string, string> = {
  "待处理": "bg-[var(--muted)] text-[var(--muted-foreground)]",
  "进行中": "bg-[color-mix(in_oklch,var(--primary),var(--background)_85%)] text-[var(--primary)]",
  "已完成": "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]",
  "阻塞": "bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] text-[var(--destructive)]",
};

export default function VatRecordDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();

  const [record, setRecord] = useState<VatRecordDetail | null>(null);
  const [steps, setSteps] = useState<VatStep[]>([]);
  const [documents, setDocuments] = useState<VatDocument[]>([]);
  const [finances, setFinances] = useState<VatFinance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [stepNotes, setStepNotes] = useState<Record<number, TimelineNote[]>>({});
  const [stepDocs, setStepDocs] = useState<Record<number, VatStepDoc[]>>({});
  const [employees, setEmployees] = useState<TimelineEmployee[]>([]);
  const [sidebarTab, setSidebarTab] = useState<"notes" | "files" | "finances">("notes");

  // Sidebar state
  const [newNote, setNewNote] = useState("");
  const [newDocName, setNewDocName] = useState("");
  const [docFileName, setDocFileName] = useState("");
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docFileUrl, setDocFileUrl] = useState("");
  const [docErrorMsg, setDocErrorMsg] = useState("");
  const [noteErrorMsg, setNoteErrorMsg] = useState("");
  // Finance form state
  const [newFinDesc, setNewFinDesc] = useState("");
  const [newFinAmount, setNewFinAmount] = useState("");
  const [newFinType, setNewFinType] = useState("income");
  const [newFinCurrency, setNewFinCurrency] = useState("CNY");
  const [exchangeRate, setExchangeRateState] = useState<number>(() => {
    if (typeof window === "undefined") return 5;
    return Number(localStorage.getItem("cnyToThbRate")) || 5;
  });
  const setExchangeRate = (rate: number) => { setExchangeRateState(rate); if (typeof window !== "undefined") localStorage.setItem("cnyToThbRate", String(rate)); };
  const [newFinMethod, setNewFinMethod] = useState("");
  const [newFinSlip, setNewFinSlip] = useState("");
  const [finErrorMsg, setFinErrorMsg] = useState("");
  const [finFileName, setFinFileName] = useState("");
  const [uploadingFin, setUploadingFin] = useState(false);
  const [finSlipFile, setFinSlipFile] = useState("");
  const [editingFinanceId, setEditingFinanceId] = useState<number | null>(null);
  const [editFinanceFields, setEditFinanceFields] = useState<Partial<VatFinance>>({});
  const [deleteFinanceTarget, setDeleteFinanceTarget] = useState<number | null>(null);
  const [deletingFinance, setDeletingFinance] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [deleteDocTarget, setDeleteDocTarget] = useState<number | null>(null);
  const [deletingDoc, setDeletingDoc] = useState(false);

  // Feedback link
  const [feedbackLink, setFeedbackLink] = useState<string | null>(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [copyingLink, setCopyingLink] = useState(false);
  const [copyModalLink, setCopyModalLink] = useState<string | null>(null);
  const [editingRecord, setEditingRecord] = useState(false);
  const [editFields, setEditFields] = useState<{ amount?: number; assignee?: string }>({});
  const [savingRecord, setSavingRecord] = useState(false);
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

  // load record + steps + notes + step_documents + documents
  useEffect(() => {
    let ignore = false;
    async function run() {
      try {
        const res = await fetchWithAuth(`/api/vat/records/${id}`);
        const data = await res.json();
        if (ignore) return;
        if (data.error) { if (initialLoadDone.current) { setStepsError(data.error); } else { setError(data.error); } setLoading(false); return; }
        setRecord(data);
        initialLoadDone.current = true;
        setStepsError("");
        const sts = data.steps || [];
        setSteps(sts);

        const notesMap: Record<number, TimelineNote[]> = {};
        const docsMap: Record<number, VatStepDoc[]> = {};
        await Promise.all(sts.map(async (s: VatStep) => {
          try { notesMap[s.id] = await fetchWithAuth(`/api/vat/records/${id}/steps/${s.id}/notes`).then(r => r.json()); }
          catch { notesMap[s.id] = []; }
          try { docsMap[s.id] = await fetchWithAuth(`/api/vat/records/${id}/steps/${s.id}/documents`).then(r => r.json()); }
          catch { docsMap[s.id] = []; }
        }));
        if (!ignore) {
          setStepNotes(notesMap);
          setStepDocs(docsMap);
        }

        // Load sidebar documents
        try {
          const docsRes = await fetchWithAuth(`/api/vat/records/${id}/documents`);
          if (docsRes.ok) setDocuments(await docsRes.json());
        } catch {}
        // Load finances
        try {
          const finRes = await fetchWithAuth(`/api/vat/records/${id}/finances`);
          if (finRes.ok) setFinances(await finRes.json());
        } catch {}

        // Load feedback link
        try {
          const fbRes = await fetchWithAuth(`/api/vat/records/${id}/feedback-token`);
          if (fbRes.ok) {
            const fb = await fbRes.json();
            setFeedbackLink(fb.link || null);
            setFeedbackSubmitted(fb.submitted || false);
          }
        } catch {}
      } catch {
        if (!ignore) {
          if (initialLoadDone.current) {
            setStepsError("加载记录失败");
          } else {
            setError("加载记录失败");
          }
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
    // 自动启动下一步
    const idx = steps.findIndex(s => s.id === stepId);
    const next = idx >= 0 && idx < steps.length - 1 ? steps[idx + 1] : null;
    if (next && next.status === "待处理") {
      await fetchWithAuth(`/api/vat/records/${id}/steps`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: next.id, status: "进行中" }),
      });
    }
    reload();
  }, [id, reload, user, steps]);

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
    const form = new FormData();
    form.append("file", file);
    const res = await fetchWithAuth("/api/upload", { method: "POST", body: form });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "上传失败"); }
    const data = await res.json();
    const note = `📎 ${file.name}\n/api/files/${data.id || data.url?.split("/").pop()}`;
    await fetchWithAuth(`/api/vat/records/${id}/steps/${stepId}/notes`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: note, created_by: user?.name || "系统" }),
    });
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

  // Mark step document as uploaded
  const handleMarkUploaded = async (stepId: number, docId: number) => {
    const res = await fetchWithAuth(`/api/vat/records/${id}/steps/${stepId}/documents`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_id: docId }),
    });
    if (res.ok) {
      const docs = await res.json();
      setStepDocs(prev => ({ ...prev, [stepId]: docs }));
    }
  };

  // ===== Sidebar: Add document =====
  const handleAddDocument = async () => {
    if (!newDocName.trim()) { setDocErrorMsg("请填写文档名"); return; }
    setDocErrorMsg("");
    try {
      await fetchWithAuth(`/api/vat/records/${id}/documents`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newDocName, file_url: docFileUrl, uploaded_by: user?.name || "系统" }),
      });
      setNewDocName("");
      setDocFileUrl("");
      setDocFileName("");
      reload();
    } catch { setDocErrorMsg("添加失败"); }
  };

  const handleDeleteDoc = async () => {
    if (!deleteDocTarget) return;
    setDeletingDoc(true);
    try {
      await fetchWithAuth(`/api/vat/records/${id}/documents?id=${deleteDocTarget}`, { method: "DELETE" });
      setDeleteDocTarget(null);
      reload();
    } catch { setDeletingDoc(false); }
  };

  // ===== Sidebar: Add record note =====
  const handleAddRecordNote = async () => {
    if (!newNote.trim()) { setNoteErrorMsg("请填写备注内容"); return; }
    setNoteErrorMsg("");
    try {
      await fetchWithAuth(`/api/vat/records/${id}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newNote, created_by: user?.name || "系统" }),
      });
      setNewNote("");
      reload();
    } catch { setNoteErrorMsg("添加失败"); }
  };

  // ===== Finance handlers =====
  const handleAddFinance = async () => {
    if (!newFinDesc.trim() || !newFinAmount) { setFinErrorMsg("请填写描述和金额"); return; }
    setFinErrorMsg("");
    try {
      const status = newFinType === "income" ? "paid" : "pending";
      await fetchWithAuth(`/api/vat/records/${id}/finances`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newFinType, amount: Number(newFinAmount), description: newFinDesc,
          payment_method: newFinMethod, slip_number: newFinSlip, slip_file: finSlipFile,
          status, currency: newFinCurrency,
        }),
      });
      setNewFinDesc(""); setNewFinAmount(""); setNewFinMethod(""); setNewFinSlip("");
      setFinSlipFile(""); setFinFileName("");
      reload();
    } catch (err) { setFinErrorMsg("添加失败"); }
  };

  const handleUpdateFinance = async (financeId: number) => {
    try {
      await fetchWithAuth(`/api/vat/records/${id}/finances`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finance_id: financeId, ...editFinanceFields }),
      });
      setEditingFinanceId(null);
      setEditFinanceFields({});
      reload();
    } catch { /* ignore */ }
  };

  const handleDeleteFinance = async () => {
    if (!deleteFinanceTarget) return;
    setDeletingFinance(true);
    try {
      await fetchWithAuth(`/api/vat/records/${id}/finances?id=${deleteFinanceTarget}`, { method: "DELETE" });
      setDeleteFinanceTarget(null);
      reload();
    } catch { setDeletingFinance(false); }
  };

  // ===== Edit record =====
  const startEdit = () => {
    if (!record) return;
    setEditFields({ amount: record.amount, assignee: record.assignee });
    setEditingRecord(true);
  };

  const handleSaveRecord = async () => {
    setSavingRecord(true);
    try {
      const res = await fetchWithAuth(`/api/vat/records/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editFields),
      });
      if (!res.ok) throw new Error("保存失败");
      setEditingRecord(false);
      reload();
    } catch { /* ignore */ }
    finally { setSavingRecord(false); }
  };

  // ===== Feedback link =====
  const generateFeedbackLink = async () => {
    try {
      const res = await fetchWithAuth(`/api/vat/records/${id}/feedback-token`, { method: "POST" });
      if (res.ok) {
        const d = await res.json();
        setFeedbackLink(d.link);
        setFeedbackSubmitted(false);
      }
    } catch {}
  };

  const copyFeedbackLink = async () => {
    if (!feedbackLink) return;
    let succeeded = false;
    try { await navigator.clipboard.writeText(feedbackLink); succeeded = true; } catch {}
    if (!succeeded) {
      try {
        const ta = document.createElement("textarea");
        ta.value = feedbackLink;
        ta.style.position = "fixed"; ta.style.left = "-9999px"; ta.style.top = "-9999px";
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand("copy"); document.body.removeChild(ta);
        succeeded = true;
      } catch {}
    }
    if (succeeded) {
      setCopyingLink(true);
      setTimeout(() => setCopyingLink(false), 2000);
    } else {
      setCopyModalLink(feedbackLink);
    }
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
      <Button variant="ghost" size="sm" className="mt-4" onClick={() => router.push("/vat?tab=records")}>返回</Button>
    </div>
  );

  if (!record) return null;

  const completedCount = steps.filter(s => s.status === "已完成").length;

  // ===== Main render =====
  return (
    <div className="flex flex-col gap-6">


      {/* Header row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.push("/vat?tab=records")} aria-label="返回">
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
          <div className="flex-1">
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>
              {record.company_name}
            </h1>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center rounded-full bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] px-2.5 py-0.5 text-xs font-medium text-[var(--primary)]">
                VAT 申报
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
          <div className="flex items-center gap-2 shrink-0">
            {!editingRecord ? (
              <Button variant="outline" size="sm" onClick={startEdit} className="gap-1.5"><Edit3 className="size-3.5" />编辑</Button>
            ) : (
              <>
                <Button variant="default" size="sm" onClick={handleSaveRecord} disabled={savingRecord} className="gap-1.5"><Save className="size-3.5" />{savingRecord ? "保存中..." : "保存"}</Button>
                <Button variant="ghost" size="sm" onClick={() => setEditingRecord(false)} disabled={savingRecord} className="gap-1.5"><X className="size-3.5" />取消</Button>
              </>
            )}
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
            {editingRecord ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">公司名称</label>
                  <input type="text" value={record.company_name} disabled className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)] outline-none" />
                </div>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">税号</label>
                  <input type="text" value={record.tax_id || ""} disabled className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)] outline-none font-mono" />
                </div>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">申报月份</label>
                  <input type="text" value={record.year_month} disabled className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)] outline-none" />
                </div>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">负责人</label>
                  <input type="text" value={editFields.assignee ?? record.assignee} onChange={(e) => setEditFields(p => ({ ...p, assignee: e.target.value }))} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
                </div>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">申报金额（฿）</label>
                  <input type="number" value={editFields.amount ?? record.amount ?? ""} onChange={(e) => setEditFields(p => ({ ...p, amount: Number(e.target.value) }))} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] font-mono" placeholder="输入 VAT 税金金额" />
                </div>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">状态</label>
                  <input type="text" value={record.progress} disabled className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 text-sm text-[var(--foreground)] outline-none" />
                </div>
              </div>
            ) : (
              <dl className="grid gap-4 sm:grid-cols-2">
                <div><dt className="text-xs text-[var(--muted-foreground)]">公司名称</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{record.company_name}</dd></div>
                <div><dt className="text-xs text-[var(--muted-foreground)]">税号</dt><dd className="mt-1 text-sm font-mono text-[var(--foreground)]">{record.tax_id || "—"}</dd></div>
                <div><dt className="text-xs text-[var(--muted-foreground)]">申报月份</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{record.year_month}</dd></div>
                <div><dt className="text-xs text-[var(--muted-foreground)]">负责人</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{record.assignee || "—"}</dd></div>
                <div><dt className="text-xs text-[var(--muted-foreground)]">申报金额</dt><dd className="mt-1 text-sm font-mono text-[var(--foreground)]">{record.amount ? record.amount.toLocaleString() + " ฿" : "—"}</dd></div>
                <div><dt className="text-xs text-[var(--muted-foreground)]">状态</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{stepStatusBadge[record.progress] ? (<span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", stepStatusBadge[record.progress])}>{record.progress}</span>) : record.progress}</dd></div>
              </dl>
            )}
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
            {/* 客户评价链接 */}
            {steps.length > 0 && completedCount === steps.length && (
              <div className="mb-4 flex items-center gap-2 flex-wrap">
                {feedbackLink ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 dark:bg-green-900/20 px-3 py-1 text-xs font-medium text-green-700 dark:text-green-400">
                      <Link2 className="size-3" />
                      评价链接已生成 {feedbackSubmitted && "（已评价）"}
                    </span>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={copyFeedbackLink}>
                      {copyingLink ? <CheckCheck className="size-3" /> : <Copy className="size-3" />}
                      {copyingLink ? "已复制" : "复制评价链接"}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={generateFeedbackLink}>
                    <Link2 className="size-3 mr-1" />
                    生成评价链接
                  </Button>
                )}
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
                  const sd = stepDocs[step.id] || [];
                  const uploadedCount = sd.filter((d: any) => d.status === "uploaded").length;
                  return (
                    <>
                      {step.payment_status && (
                        <span className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                          step.payment_status === "已付款" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]" :
                          step.payment_status === "逾期未付" ? "bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] text-[var(--destructive)]" :
                          "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]"
                        )}>{step.payment_status}</span>
                      )}
                      {sd.length > 0 && (
                        <span className={cn("text-xs", uploadedCount === sd.length ? "text-[var(--success)]" : "text-[var(--warning)]")}>文件 {uploadedCount}/{sd.length}</span>
                      )}
                    </>
                  );
                }}
                renderExpandedExtra={(step) => {
                  const sd = stepDocs[step.id] || [];
                  return (
                    <>
                      {/* 文件清单 */}
                      {sd.length > 0 && (
                        <div className="border-t border-[var(--border)] pt-3">
                          <h4 className="mb-2 text-xs font-medium text-[var(--foreground)]">所需文件</h4>
                          <ul className="space-y-1">
                            {sd.map((doc) => {
                              const isUploaded = doc.status === "uploaded";
                              return (
                                <li key={doc.id} className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-[var(--muted)]">
                                  <div className="flex items-center gap-1.5">
                                    {isUploaded ? <CheckCircle2 className="size-3 text-[var(--success)]" /> : <Circle className="size-3 text-[var(--muted-foreground)]" />}
                                    <span className={isUploaded ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}>{doc.document_name}</span>
                                  </div>
                                  {!isUploaded && (
                                    <button onClick={() => handleMarkUploaded(step.id, doc.id)} className="rounded px-1.5 py-0.5 text-[0.65rem] text-[var(--success)] hover:bg-[color-mix(in_oklch,var(--success),var(--background)_90%)]">标记已上传</button>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                      {/* 付款状态（第 5 步） */}
                      {step.step_order === 5 && (
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
                      )}
                    </>
                  );
                }}
              />
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-4">
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--muted)] p-0.5">
            <button onClick={() => setSidebarTab("notes")} className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors", sidebarTab === "notes" ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)]")}><MessageSquare className="mr-1 inline size-3" />备注</button>
            <button onClick={() => setSidebarTab("files")} className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors", sidebarTab === "files" ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)]")}><Paperclip className="mr-1 inline size-3" />文件</button>
            <button onClick={() => setSidebarTab("finances")} className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors", sidebarTab === "finances" ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)]")}><DollarSign className="mr-1 inline size-3" />费用</button>
          </div>

          {sidebarTab === "notes" && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <h4 className="mb-3 text-[0.65rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)] border-b border-[var(--border)] pb-2">申报备注</h4>
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

          {sidebarTab === "finances" && (() => {
            const toTHB = (amount: number, cur?: string) => cur === "CNY" ? amount * (exchangeRate || 1) : amount;
            const totalIncomeRaw = finances.filter(f => f.type === "income").reduce((s, f) => s + toTHB(f.amount, f.currency), 0);
            const totalExpenseRaw = finances.filter(f => f.type === "expense").reduce((s, f) => s + toTHB(f.amount, f.currency), 0);
            const pendingPayRaw = finances.filter(f => f.status === "pending").reduce((s, f) => s + toTHB(f.amount, f.currency), 0);
            const totalIncome = Math.round(totalIncomeRaw);
            const totalExpense = Math.round(totalExpenseRaw);
            const pendingPay = Math.round(pendingPayRaw);
            return (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <div className="mb-3 flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5">
                  <span className="text-xs text-[var(--muted-foreground)] shrink-0">汇率 1¥ =</span>
                  <input type="number" step="0.01" min="0" value={exchangeRate} onChange={(e) => setExchangeRate(Number(e.target.value) || 0)} className="w-16 text-xs font-mono bg-transparent outline-none text-[var(--foreground)]" />
                  <span className="text-xs text-[var(--muted-foreground)]">฿</span>
                  <span className="text-[0.65rem] text-[var(--muted-foreground)] ml-auto">全部折合泰铢</span>
                </div>
                {finances.length > 0 && (
                  <div className="mb-4 grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-[color-mix(in_oklch,var(--success),var(--background)_90%)] px-3 py-2 text-center">
                      <p className="text-[0.6rem] text-[var(--success)]">总收入</p>
                      <p className="mt-0.5 text-xs font-mono font-medium text-[var(--success)]">฿{totalIncome.toLocaleString()}</p>
                    </div>
                    <div className="rounded-lg bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] px-3 py-2 text-center">
                      <p className="text-[0.6rem] text-[var(--destructive)]">总支出</p>
                      <p className="mt-0.5 text-xs font-mono font-medium text-[var(--destructive)]">฿{totalExpense.toLocaleString()}</p>
                    </div>
                    <div className="rounded-lg bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] px-3 py-2 text-center">
                      <p className="text-[0.6rem] text-[var(--warning)]">待付余额</p>
                      <p className="mt-0.5 text-xs font-mono font-medium text-[var(--warning)]">฿{pendingPay.toLocaleString()}</p>
                    </div>
                  </div>
                )}
                {finances.length === 0 ? <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">暂无费用记录</p> : (
                  <ul className="flex flex-col gap-2">
                    {finances.map((f) => (
                      <li key={f.id} className="rounded-md p-2 transition-colors hover:bg-[var(--secondary)]">
                        {editingFinanceId === f.id ? (
                          <div className="space-y-1.5">
                            <div className="flex gap-1.5">
                              <select value={editFinanceFields.type || f.type} onChange={(e) => setEditFinanceFields(p => ({ ...p, type: e.target.value }))} className="w-16 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1 text-xs outline-none focus:border-[var(--ring)]">
                                <option value="income">收入</option>
                                <option value="expense">支出</option>
                              </select>
                              <input type="number" value={editFinanceFields.amount ?? f.amount} onChange={(e) => setEditFinanceFields(p => ({ ...p, amount: Number(e.target.value) }))} className="w-24 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                              <select value={editFinanceFields.status || f.status} onChange={(e) => setEditFinanceFields(p => ({ ...p, status: e.target.value }))} className="w-16 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1 text-xs outline-none focus:border-[var(--ring)]">
                                <option value="paid">已付</option>
                                <option value="pending">待付</option>
                                <option value="cancelled">已取消</option>
                              </select>
                              <select value={editFinanceFields.currency || f.currency || "CNY"} onChange={(e) => setEditFinanceFields(p => ({ ...p, currency: e.target.value }))} className="w-16 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1 text-xs outline-none focus:border-[var(--ring)]">
                                <option value="CNY">¥</option>
                                <option value="THB">฿</option>
                              </select>
                            </div>
                            <div className="flex gap-1.5">
                              <input value={editFinanceFields.description || f.description} onChange={(e) => setEditFinanceFields(p => ({ ...p, description: e.target.value }))} className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                              <button onClick={() => handleUpdateFinance(f.id)} className="shrink-0 rounded bg-[var(--primary)] px-2 py-0.5 text-xs text-[var(--primary-foreground)]">保存</button>
                              <button onClick={() => { setEditingFinanceId(null); setEditFinanceFields({}); }} className="shrink-0 rounded border border-[var(--border)] px-2 py-0.5 text-xs">取消</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className={cn("inline-flex size-1.5 rounded-full", f.type === "income" ? "bg-[var(--success)]" : "bg-[var(--destructive)]")} />
                                <span className="text-xs font-medium text-[var(--foreground)]">{f.description}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <button onClick={() => { setEditingFinanceId(f.id); setEditFinanceFields({ type: f.type, amount: f.amount, description: f.description, payment_method: f.payment_method, slip_number: f.slip_number, status: f.status, currency: f.currency }); }} className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors" title="编辑"><Pencil className="size-3" /></button>
                                <button onClick={() => setDeleteFinanceTarget(f.id)} className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] transition-colors"><Trash2 className="size-3" /></button>
                              </div>
                            </div>
                            <p className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                              <span className={cn("font-mono font-medium", f.type === "income" ? "text-[var(--success)]" : "text-[var(--destructive)]")}>
                                {f.type === "income" ? "+" : "-"}{f.amount.toLocaleString()} {f.currency === "CNY" ? "¥" : "฿"}
                              </span>
                              <span className={cn("rounded px-1 py-0.5 text-[0.6rem] font-medium", f.status === "paid" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]" : f.status === "pending" ? "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]" : "bg-[var(--muted)] text-[var(--muted-foreground)]")}>{f.status === "paid" ? "已付" : f.status === "pending" ? "待付" : "已取消"}</span>
                              {f.payment_method && <span>{f.payment_method}{f.slip_number ? " · " + f.slip_number : ""}</span>}
                              {f.slip_file && (
                                /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(f.slip_file) ? (
                                  <img src={fileUrl(f.slip_file)} alt="水单" className="max-h-6 rounded border border-[var(--border)] cursor-pointer hover:opacity-80" onClick={() => setPreviewUrl(f.slip_file)} />
                                ) : (
                                  <a href={fileUrl(f.slip_file)} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--primary)] hover:underline">查看水单</a>
                                )
                              )}
                            </p>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 space-y-1.5">
                  <div className="flex gap-1.5">
                    <input placeholder="描述…" value={newFinDesc} onChange={(e) => { setNewFinDesc(e.target.value); setFinErrorMsg(""); }} className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                    <input type="number" placeholder="金额" value={newFinAmount} onChange={(e) => { setNewFinAmount(e.target.value); setFinErrorMsg(""); }} className="w-20 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                    <select value={newFinType} onChange={(e) => setNewFinType(e.target.value)} className="w-16 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1 text-xs outline-none focus:border-[var(--ring)]">
                      <option value="income">收入</option>
                      <option value="expense">支出</option>
                    </select>
                    <select value={newFinCurrency} onChange={(e) => setNewFinCurrency(e.target.value)} className="w-16 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1 text-xs outline-none focus:border-[var(--ring)]">
                      <option value="CNY">¥</option>
                      <option value="THB">฿</option>
                    </select>
                  </div>
                  <div className="flex gap-1.5">
                    <input placeholder="付款方式（可选）" value={newFinMethod} onChange={(e) => setNewFinMethod(e.target.value)} className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                    <input placeholder="流水单号（可选）" value={newFinSlip} onChange={(e) => setNewFinSlip(e.target.value)} className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                    <label className="shrink-0 cursor-pointer rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors" title="上传水单">
                      <Paperclip className="size-3" />
                      <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; setUploadingFin(true); setFinFileName(file.name); try { const form = new FormData(); form.append("file", file); const res = await fetchWithAuth("/api/upload", { method: "POST", body: form }); if (!res.ok) throw new Error(""); const data = await res.json(); setFinSlipFile(data.url); } catch { setFinErrorMsg("上传失败"); setFinFileName(""); } finally { setUploadingFin(false); } }} disabled={uploadingFin} />
                    </label>
                    {(uploadingFin || finFileName) && <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[100px] self-center">{uploadingFin ? "上传中..." : finFileName}</span>}
                    <button onClick={handleAddFinance} disabled={uploadingFin} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_20%)] disabled:opacity-50">{uploadingFin ? "上传中..." : "添加"}</button>
                  </div>
                  {finErrorMsg && <p className="mt-1 text-xs text-[var(--destructive)]">{finErrorMsg}</p>}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Image preview overlay */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center cursor-pointer" onClick={() => setPreviewUrl(null)} onKeyDown={(e) => { if (e.key === "Escape") setPreviewUrl(null); }}>
          <img src={fileUrl(previewUrl)} alt="预览" className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl" />
        </div>
      )}

      {/* Delete finance confirm modal */}
      {deleteFinanceTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteFinanceTarget(null)}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-[var(--foreground)]">确认删除费用</h3>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">确定要删除这条费用记录吗？此操作不可恢复。</p>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setDeleteFinanceTarget(null)} disabled={deletingFinance} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50">取消</button>
              <button onClick={handleDeleteFinance} disabled={deletingFinance} className="rounded-lg bg-[var(--destructive)] px-4 py-2 text-sm font-medium text-white hover:bg-[color-mix(in_oklch,var(--destructive),var(--foreground)_20%)] transition-colors disabled:opacity-50">
                {deletingFinance ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
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

      {/* Copy link modal (HTTP fallback) */}
      {copyModalLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCopyModalLink(null)}>
          <div className="bg-[var(--background)] rounded-xl shadow-2xl max-w-lg w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <h2 className="text-sm font-medium">评价链接</h2>
              <button onClick={() => setCopyModalLink(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-[var(--muted-foreground)]">浏览器不支持自动复制，请手动复制下方链接：</p>
              <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--muted)] p-3">
                <input type="text" value={copyModalLink} readOnly className="flex-1 bg-transparent text-sm font-mono outline-none select-all" onFocus={e => e.target.select()} autoFocus />
                <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => { navigator.clipboard.writeText(copyModalLink).catch(() => {}); setCopyModalLink(null); setCopyingLink(true); setTimeout(() => setCopyingLink(false), 2000); }}>
                  <Copy className="size-3 mr-1" />复制
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
