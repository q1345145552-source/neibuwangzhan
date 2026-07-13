"use client";

import { useState, useEffect, use, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, DollarSign, Paperclip, Plus, Upload, MessageSquare, CheckCircle2, Circle, Pencil, Trash2, Edit3, Save, X, Undo2, Upload as UploadIcon, Building, ExternalLink, Search, Play, Sparkles } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { fetchEmployees, type Employee, startPhase, fetchWithAuth } from "@/lib/api";
import { cn, toThaiTime } from "@/lib/utils";
function getBackUrl(inf: any) {
  if (!inf) return "/agency/influencers";
  if (inf.phase === "contract" || inf.phase === "completed_contract") return "/agency/contracts";
  if (inf.phase === "incubation" || inf.phase === "completed_incubation") return "/agency/incubation";
  return "/agency/influencers";
}
function getPageTitle(inf: any) {
  if (inf?.phase === "contract" || inf?.phase === "completed_contract") return "签约跟进";
  if (inf?.phase === "incubation" || inf?.phase === "completed_incubation") return "品牌孵化";
  if (inf?.status === "已推荐给老板") return "老板推荐";
  return "达人发现";
}


// ── Status styles ──
const stepStatusClass: Record<string, string> = {
  "待处理": "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  "进行中": "bg-[color-mix(in_oklch,var(--info),var(--background)_85%)] text-[oklch(0.38_0.10_240)]",
  "已完成": "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  "阻塞": "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]",
  "已停止": "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]",
};

const phaseColors: Record<string, string> = {
  discovery: "border-pink-300 dark:border-pink-700",
  contract: "border-blue-300 dark:border-blue-700",
  incubation: "border-amber-300 dark:border-amber-700",
};
const phaseBgs: Record<string, string> = {
  discovery: "bg-pink-50/30 dark:bg-pink-950/20",
  contract: "bg-blue-50/30 dark:bg-blue-950/20",
  incubation: "bg-amber-50/30 dark:bg-amber-950/20",
};
const phaseLabels: Record<string, string> = {
  discovery: "达人发现",
  contract: "签约跟进",
  incubation: "品牌孵化",
};

// ── Types ──
interface Influencer {
  phase: string;
  id: number; name: string; code: string; status: string; category: string; tiktok_link: string;
  line_id: string; contact_phone: string; monthly_gmv: string; live_stream_ratio: string;
  contact_time: string; reply_status: string; followers: string; avg_views: string;
  gmv_range: string; notes: string; created_at: string; updated_at: string;
  steps: InfStep[]; evaluations: any[]; contracts: any[];
}

interface InfStep {
  id: number; influencer_id: number; step_name: string; step_order: number;
  phase: string; status: string; assignee: string; notes: string;
  stop_reason: string; completed_at: string | null; created_at: string;
}

interface InfStepNote {
  id: number; step_id: number; influencer_id: number;
  content: string; created_by: string; created_at: string;
}

interface InfDocument { id: number; name: string; file_url: string; file_type: string; status: string; uploaded_by: string; created_at: string; }
interface InfFinance { id: number; type: string; amount: number; status: string; description: string; payment_method: string; slip_number: string; slip_file: string; currency: string; created_at: string; }
interface InfCertificate { id: number; certificate_number: string; product_name: string; issue_date: string; expiry_date: string; status: string; notes: string; file_url: string; created_at: string; }

function isImageUrl(url: string | undefined | null): boolean {
  return /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url || "");
}

export default function InfluencerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const isClient = user?.role === "client";

  const [inf, setInf] = useState<Influencer | null>(null);
  const [steps, setSteps] = useState<InfStep[]>([]);
  const [docs, setDocs] = useState<InfDocument[]>([]);
  const [finances, setFinances] = useState<InfFinance[]>([]);
  const [certs, setCerts] = useState<InfCertificate[]>([]);
  const [stepNotes, setStepNotes] = useState<Record<number, InfStepNote[]>>({});
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});
  const [confirmingStepId, setConfirmingStepId] = useState<number | null>(null);
  const [confirmNote, setConfirmNote] = useState("");
  const [newNotes, setNewNotes] = useState<Record<number, string>>({});
  const [noteErrorMsg, setNoteErrorMsg] = useState<Record<number, string>>({});
  const [deleteNoteTarget, setDeleteNoteTarget] = useState<{ stepId: number; noteId: number; content: string } | null>(null);
  const [editingAssigneeStepId, setEditingAssigneeStepId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"finances" | "docs" | "certs">("finances");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // ── CSV ──
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState<{ imported: number; skipped: string[]; total: number } | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // ── Factory association ──
  const [factoryModal, setFactoryModal] = useState(false);
  const [factories, setFactories] = useState<any[]>([]);
  const [linkedFactories, setLinkedFactories] = useState<any[]>([]);

  // ── Finance form ──
  const [newFinDesc, setNewFinDesc] = useState("");
  const [newFinAmount, setNewFinAmount] = useState("");
  const [newFinType, setNewFinType] = useState("income");
  const [newFinCurrency, setNewFinCurrency] = useState("CNY");
  const [newFinMethod, setNewFinMethod] = useState("");
  const [newFinSlip, setNewFinSlip] = useState("");
  const [finErrorMsg, setFinErrorMsg] = useState("");
  const [finFileName, setFinFileName] = useState("");
  const [uploadingFin, setUploadingFin] = useState(false);
  const [finSlipFile, setFinSlipFile] = useState("");

  // ── Document form ──
  const [newDocName, setNewDocName] = useState("");
  const [docFileName, setDocFileName] = useState("");
  const [docFileUrl, setDocFileUrl] = useState("");
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docErrorMsg, setDocErrorMsg] = useState("");

  // ── Certificate form ──
  const [newCertNo, setNewCertNo] = useState("");
  const [certFileName, setCertFileName] = useState("");
  const [certFileUrl, setCertFileUrl] = useState("");
  const [uploadingCert, setUploadingCert] = useState(false);
  const [certErrorMsg, setCertErrorMsg] = useState("");
  const [editingCertId, setEditingCertId] = useState<number | null>(null);
  const [editCertFields, setEditCertFields] = useState<Partial<InfCertificate>>({});

  // ── Upload states per step ──
  const [stepUploading, setStepUploading] = useState<Record<number, boolean>>({});
  const [stepFileNames, setStepFileNames] = useState<Record<number, string>>({});

  useEffect(() => { fetchEmployees().then(setEmployees).catch(() => {}); }, []);

  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey(k => k + 1), []);

  // ── Load influencer data ──
  useEffect(() => {
    let ignore = false;
    async function run() {
      try {
        const res = await fetchWithAuth(`/api/influencers/${id}`, { cache: "no-store" });
        if (!res.ok) throw new Error("加载失败");
        const data = await res.json();
        if (ignore) return;
        setInf(data);
        setSteps(data.steps || []);
        const ns: Record<number, InfStepNote[]> = {};
        for (const s of data.steps || []) {
          try {
            const nr = await fetchWithAuth(`/api/influencers/${id}/steps/${s.id}/notes`, { cache: "no-store" });
            ns[s.id] = nr.ok ? await nr.json() : [];
          } catch { ns[s.id] = []; }
        }
        setStepNotes(ns);
        // Load documents, finances, certificates
        try { const dr = await fetchWithAuth(`/api/influencers/${id}/documents`, { cache: "no-store" }); if (dr.ok) setDocs(await dr.json()); } catch {}
        try { const fr = await fetchWithAuth(`/api/influencers/${id}/finances`, { cache: "no-store" }); if (fr.ok) setFinances(await fr.json()); } catch {}
        try { const cr = await fetchWithAuth(`/api/influencers/${id}/certificates`, { cache: "no-store" }); if (cr.ok) setCerts(await cr.json()); } catch {}
        // Factories
        try { const lfr = await fetchWithAuth(`/api/influencers/${id}/factories`, { cache: "no-store" }); if (lfr.ok) setLinkedFactories(await lfr.json()); } catch {}
        const fr2 = await fetchWithAuth("/api/factories", { cache: "no-store" });
        if (fr2.ok) setFactories(await fr2.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    run();
    return () => { ignore = true; };
  }, [id, refreshKey]);

  const canComplete = (step: InfStep): boolean => {
    if (step.status === "已完成" || step.status === "阻塞" || step.status === "已停止") return false;
    if (step.step_order === 1) return true;
    const prev = steps.find(s => s.step_order === step.step_order - 1);
    return !prev || prev.status === "已完成";
  };

  const handleConfirmComplete = async (stepId: number) => {
    try {
      await fetchWithAuth(`/api/influencers/${id}/steps`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: stepId, status: "已完成", notes: confirmNote }),
      });
      setConfirmingStepId(null);
      setConfirmNote("");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  };

  const handleStepUpdate = async (stepId: number, status: string) => {
    try {
      await fetchWithAuth(`/api/influencers/${id}/steps`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: stepId, status }),
      });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  };

  const handleRollback = async (stepId: number) => {
    try {
      await fetchWithAuth(`/api/influencers/${id}/steps`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: stepId, status: "进行中" }),
      });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "撤回失败");
    }
  };

  // ── Stop ──
  const [stopModal, setStopModal] = useState<{ stepId: number; stepName: string } | null>(null);
  const [stopReason, setStopReason] = useState("");
  const [stopReasonErr, setStopReasonErr] = useState("");
  const [poolConfirming, setPoolConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);

  const confirmStop = async () => {
    if (!stopReason.trim()) { setStopReasonErr("请填写停止原因"); return; }
    if (!stopModal) return;
    setStopping(true);
    try {
      await fetchWithAuth(`/api/influencers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "已停止" }),
      });
      await fetchWithAuth(`/api/influencers/${id}/steps`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: stopModal.stepId, status: "已停止", stop_reason: stopReason }),
      });
      setStopModal(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally { setStopping(false); }
  };

  // ── Notes ──
  const handleAddNote = async (stepId: number) => {
    const content = newNotes[stepId];
    if (!content?.trim()) { setNoteErrorMsg(p => ({ ...p, [stepId]: "请填写备注内容" })); return; }
    setNoteErrorMsg(p => ({ ...p, [stepId]: "" }));
    try {
      await fetchWithAuth(`/api/influencers/${id}/steps/${stepId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, created_by: user?.name || "系统" }),
      });
      setNewNotes(p => ({ ...p, [stepId]: "" }));
      const nr = await fetchWithAuth(`/api/influencers/${id}/steps/${stepId}/notes`, { cache: "no-store" });
      const notes = await nr.json(); if (nr.ok) setStepNotes(p => ({ ...p, [stepId]: notes }));
    } catch {}
  };

  const handleDeleteNote = async () => {
    if (!deleteNoteTarget) return;
    await fetchWithAuth(`/api/influencers/${id}/steps/${deleteNoteTarget.stepId}/notes?id=${deleteNoteTarget.noteId}`, { method: "DELETE" });
    setDeleteNoteTarget(null);
    const nr = await fetchWithAuth(`/api/influencers/${id}/steps/${deleteNoteTarget.stepId}/notes`, { cache: "no-store" });
    const notes = await nr.json(); if (nr.ok) setStepNotes(p => ({ ...p, [deleteNoteTarget.stepId]: notes }));
  };

  // ── Step file upload ──
  const handleStepUpload = async (stepId: number, file: File) => {
    setStepUploading(p => ({ ...p, [stepId]: true }));
    setStepFileNames(p => ({ ...p, [stepId]: file.name }));
    try {
      const fd = new FormData(); fd.append("file", file);
      const ur = await fetch("/api/upload", { method: "POST", body: fd });
      if (!ur.ok) throw new Error("上传失败");
      const { url } = await ur.json();
      const note = `上传文件: ${file.name} (${url})`;
      const current = steps.find(s => s.id === stepId);
      const updated = current?.notes ? current.notes + "\n" + note : note;
      await fetchWithAuth(`/api/influencers/${id}/steps`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: stepId, notes: updated }),
      });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setStepUploading(p => ({ ...p, [stepId]: false }));
      setStepFileNames(p => ({ ...p, [stepId]: "" }));
    }
  };

  // ── CSV import ──
  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setCsvImporting(true); setCsvResult(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/influencers/evaluations/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导入失败");
      setCsvResult(data); reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV导入失败");
    } finally { setCsvImporting(false); e.target.value = ""; }
  };

  // ── Factory association ──
  const handleLinkFactory = async (factoryId: number) => {
    try {
      await fetchWithAuth(`/api/influencers/${id}/factories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factory_id: factoryId, relationship: "合作" }),
      });
      const lfr = await fetchWithAuth(`/api/influencers/${id}/factories`, { cache: "no-store" });
      if (lfr.ok) setLinkedFactories(await lfr.json());
    } catch (err) { setError(err instanceof Error ? err.message : "关联失败"); }
  };
  const handleUnlinkFactory = async (linkId: number) => {
    await fetchWithAuth(`/api/influencers/${id}/factories?id=${linkId}`, { method: "DELETE" });
    const lfr = await fetchWithAuth(`/api/influencers/${id}/factories`, { cache: "no-store" });
    if (lfr.ok) setLinkedFactories(await lfr.json());
  };

  // ── Finance ──
  const handleAddFinance = async () => {
    if (!newFinDesc.trim() || !newFinAmount) { setFinErrorMsg("请填写描述和金额"); return; }
    setFinErrorMsg("");
    try {
      await fetchWithAuth(`/api/influencers/${id}/finances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newFinType, amount: Number(newFinAmount),
          description: newFinDesc, payment_method: newFinMethod,
          slip_number: newFinSlip, slip_file: finSlipFile,
          status: newFinType === "income" ? "paid" : "pending",
          currency: newFinCurrency,
        }),
      });
      setNewFinDesc(""); setNewFinAmount(""); setNewFinMethod(""); setNewFinSlip(""); setFinSlipFile(""); setFinFileName("");
      reload();
    } catch (err) { setFinErrorMsg("添加失败"); }
  };

  // ── Document ──
  const handleAddDocument = async () => {
    if (!newDocName.trim()) { setDocErrorMsg("请填写文档名"); return; }
    setDocErrorMsg("");
    try {
      await fetchWithAuth(`/api/influencers/${id}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newDocName, file_url: docFileUrl, uploaded_by: user?.name || "" }),
      });
      setNewDocName(""); setDocFileUrl(""); setDocFileName(""); reload();
    } catch (err) { setDocErrorMsg("添加失败"); }
  };

  const handleDeleteDocument = async (docId: number) => {
    if (!confirm("确认删除此文档？")) return;
    await fetchWithAuth(`/api/influencers/${id}/documents?id=${docId}`, { method: "DELETE" });
    reload();
  };

  // ── Certificate ──
  const handleAddCertificate = async () => {
    if (!newCertNo.trim()) { setCertErrorMsg("请填写证书编号"); return; }
    setCertErrorMsg("");
    try {
      await fetchWithAuth(`/api/influencers/${id}/certificates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ certificate_number: newCertNo, issue_date: new Date().toISOString().slice(0, 10), file_url: certFileUrl }),
      });
      setNewCertNo(""); setCertFileUrl(""); setCertFileName(""); reload();
    } catch (err) { setCertErrorMsg("添加失败"); }
  };

  const handleSaveCertificate = async (certId: number) => {
    try {
      await fetchWithAuth(`/api/influencers/${id}/certificates/${certId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editCertFields),
      });
      setEditingCertId(null); reload();
    } catch (err) { setError("保存失败"); }
  };

  const handleDeleteCertificate = async (certId: number) => {
    if (!confirm("确认删除此证书？")) return;
    await fetchWithAuth(`/api/influencers/${id}/certificates/${certId}`, { method: "DELETE" });
    reload();
  };

  const handleConfirmPool = async () => {
    if (!inf || !confirm("确认将该达人纳入达人池？")) return;
    setPoolConfirming(true);
    try {
      await fetchWithAuth(`/api/influencers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "completed_discovery", status: "已入池" }),
      });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setPoolConfirming(false);
    }
  };

  const handleStartPhase = async (phase: string) => {
    if (!inf) return;
    try {
      setLoading(true);
      await startPhase(inf.id, phase);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动阶段失败");
    } finally {
      setLoading(false);
    }
  };

  // ── Render ──
  if (loading) return <div className="py-20 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>;
  if (error && !inf) return <div className="py-20 text-center text-sm text-[var(--destructive)]">{error}</div>;
  if (!inf) return null;

  const currentPhaseSteps = steps.filter(s => s.phase === inf.phase || (!inf.phase || inf.phase === "discovery"));
  const displaySteps = currentPhaseSteps.length > 0 ? currentPhaseSteps : steps;
  const completedCount = displaySteps.filter(s => s.status === "已完成").length;
  const totalSteps = displaySteps.length;
  const progressPct = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;
  const phases = ["discovery", "contract", "incubation"] as const;

  const totalIncome = finances.filter(f => f.type === "income").reduce((sum, f) => {
    const amt = f.currency === "THB" ? f.amount : f.amount * 5;
    return sum + amt;
  }, 0);
  const totalExpense = finances.filter(f => f.type === "expense").reduce((sum, f) => {
    const amt = f.currency === "THB" ? f.amount : f.amount * 5;
    return sum + amt;
  }, 0);

  // ── 老板推荐视图：数据展示 + 确认入池 ──
  if (inf.status === "已推荐给老板") {
    const latestEval = inf.evaluations?.[0] || {};
    return (
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.push(getBackUrl(inf))}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">{inf.name}</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{getPageTitle(inf)} · 评估数据</p>
          </div>
        </div>

        {error && <div className="rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-4 py-3 text-sm text-[var(--destructive)]">{error}</div>}

        {/* 基本信息卡片 */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6">
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-4">基本信息</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-[var(--muted-foreground)]">达人编号</p>
              <p className="text-sm font-medium text-[var(--foreground)]">{inf.code || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted-foreground)]">品类</p>
              <p className="text-sm font-medium text-[var(--foreground)]">{inf.category || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted-foreground)]">粉丝量</p>
              <p className="text-sm font-medium tabular-nums text-[var(--foreground)]">{inf.followers || "-"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-[var(--muted-foreground)]">TikTok 主页</p>
              {inf.tiktok_link ? (
                <a href={inf.tiktok_link} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-[var(--primary)] hover:underline inline-flex items-center gap-1">
                  <ExternalLink className="size-3" />{inf.tiktok_link}
                </a>
              ) : <p className="text-sm text-[var(--muted-foreground)]">-</p>}
            </div>
          </div>
        </div>

        {/* 评估数据卡片 */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6">
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-4">评估数据</h2>
          {latestEval.id ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <p className="text-xs text-[var(--muted-foreground)]">月度 GMV</p>
                  <p className="mt-1 text-sm font-medium text-[var(--foreground)]">{latestEval.gmv_amount || latestEval.gmv || "-"}</p>
                  {latestEval.gmv_tier && <p className="text-xs text-[var(--muted-foreground)]">{latestEval.gmv_tier} · {latestEval.gmv_score} 分</p>}
                </div>
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <p className="text-xs text-[var(--muted-foreground)]">平均直播时长</p>
                  <p className="mt-1 text-sm font-medium text-[var(--foreground)]">{latestEval.live_duration_tier || "-"}</p>
                  {latestEval.live_duration_score != null && <p className="text-xs text-[var(--muted-foreground)]">{latestEval.live_duration_score} 分</p>}
                </div>
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <p className="text-xs text-[var(--muted-foreground)]">直播频率</p>
                  <p className="mt-1 text-sm font-medium text-[var(--foreground)]">{latestEval.live_frequency_tier || "-"}</p>
                  {latestEval.live_frequency_score != null && <p className="text-xs text-[var(--muted-foreground)]">{latestEval.live_frequency_score} 分</p>}
                </div>
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <p className="text-xs text-[var(--muted-foreground)]">创作者专业度</p>
                  <p className="mt-1 text-sm font-medium text-[var(--foreground)]">{latestEval.professionalism_tier || "-"}</p>
                  {latestEval.professionalism_score != null && <p className="text-xs text-[var(--muted-foreground)]">{latestEval.professionalism_score} 分</p>}
                </div>
              </div>

              {/* 总分 + 最终评级 + GMV占比 */}
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-[var(--secondary)] p-3 text-center">
                  <p className="text-xs text-[var(--muted-foreground)]">直播间 GMV 占比</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--foreground)]">{latestEval.live_stream_ratio || "-"}</p>
                </div>
                <div className="rounded-lg bg-[var(--secondary)] p-3 text-center">
                  <p className="text-xs text-[var(--muted-foreground)]">总分</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--foreground)]">{latestEval.total_score != null ? `${latestEval.total_score} / 65` : "-"}</p>
                </div>
                <div className="rounded-lg p-3 text-center" style={{ background: latestEval.final_rating?.startsWith("A") ? "oklch(0.93 0.03 155)" : latestEval.final_rating?.startsWith("B") ? "oklch(0.94 0.03 240)" : "oklch(0.95 0.05 85)" }}>
                  <p className="text-xs text-[var(--muted-foreground)]">最终评级</p>
                  <p className={`mt-1 text-lg font-bold ${
                    latestEval.final_rating?.startsWith("A") ? "text-emerald-700" :
                    latestEval.final_rating?.startsWith("B") ? "text-blue-700" : "text-amber-700"
                  }`}>{latestEval.final_rating || "-"}</p>
                </div>
              </div>
            </>
          ) : (
            <p className="py-4 text-sm text-center text-[var(--muted-foreground)]">暂无评估数据</p>
          )}
        </div>

        {/* 确认入池 */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6">
          <p className="text-sm text-[var(--foreground)] mb-4">确认该达人通过评估，将其纳入达人池？入池后达人将出现在签约跟进和品牌孵化列表。</p>
          <Button size="sm" onClick={handleConfirmPool} disabled={poolConfirming} className="gap-1">
            {poolConfirming ? "处理中..." : "确认入池"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Preview overlay */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center cursor-pointer" onClick={() => setPreviewUrl(null)}
          onKeyDown={(e) => { if (e.key === "Escape") setPreviewUrl(null); }}>
          <img src={previewUrl} className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl" />
        </div>
      )}

      {/* Delete note modal */}
      {deleteNoteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setDeleteNoteTarget(null)}>
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-medium text-[var(--foreground)]">确认删除此备注？</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)] line-clamp-2">{deleteNoteTarget.content}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleteNoteTarget(null)}>取消</Button>
              <Button variant="destructive" size="sm" onClick={handleDeleteNote}>确认删除</Button>
            </div>
          </div>
        </div>
      )}

      {/* Stop modal */}
      {stopModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setStopModal(null)}>
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-[var(--foreground)]">停止合作</h3>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">当前步骤: {stopModal.stepName}</p>
            <div className="mt-4">
              <label className="text-sm font-medium">停止原因 <span className="text-red-500">*</span></label>
              <textarea value={stopReason} onChange={e => { setStopReason(e.target.value); setStopReasonErr(""); }}
                placeholder="请填写停止合作的具体原因..." rows={3}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)] resize-none" autoFocus />
              {stopReasonErr && <p className="mt-1 text-xs text-[var(--destructive)]">{stopReasonErr}</p>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStopModal(null)} disabled={stopping}>取消</Button>
              <Button variant="destructive" size="sm" onClick={confirmStop} disabled={stopping}>{stopping ? "处理中..." : "确认停止"}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Factory modal */}
      {factoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setFactoryModal(false)}>
          <div className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-[var(--foreground)] flex items-center gap-2"><Building className="size-5" />关联工厂</h3>
            {linkedFactories.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-[var(--muted-foreground)] mb-2">已关联 ({linkedFactories.length})</p>
                <div className="space-y-1">
                  {linkedFactories.map((lf: any) => (
                    <div key={lf.id} className="flex items-center justify-between rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                      <span>{lf.factory_name}</span>
                      <Button size="sm" variant="ghost" className="h-6 text-xs text-red-500" onClick={() => handleUnlinkFactory(lf.id)}>移除</Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-3">
              <p className="text-xs font-medium text-[var(--muted-foreground)] mb-2">可选工厂</p>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {factories.filter((f: any) => !linkedFactories.some((lf: any) => lf.factory_id === f.id)).map((f: any) => (
                  <div key={f.id} className="flex items-center justify-between rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                    <div><span className="font-medium">{f.name}</span>{f.category && <span className="ml-2 text-xs text-[var(--muted-foreground)]">{f.category}</span>}</div>
                    <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => handleLinkFactory(f.id)}>关联</Button>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex justify-end"><Button variant="ghost" size="sm" onClick={() => setFactoryModal(false)}>关闭</Button></div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.push(getBackUrl(inf))} aria-label="返回达人列表">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">{inf.name}</h1>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", stepStatusClass[inf.status] || "bg-gray-100")}>{inf.status}</span>
            {inf.category && <span className="text-xs text-[var(--muted-foreground)]">{inf.category}</span>}
            {inf.followers && <span className="text-xs text-[var(--muted-foreground)]">{inf.followers} 粉丝</span>}
            <span className="text-xs text-[var(--muted-foreground)]">· 阶段: {inf.phase?.replace("completed_", "").replace("_", " ")} · 已完成 {completedCount}/{totalSteps}</span>
          </div>
          {inf.tiktok_link && (
            <a href={inf.tiktok_link} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--primary)] hover:underline break-all">
              <ExternalLink className="size-3" />{inf.tiktok_link}
            </a>
          )}
          {/* Phase action buttons */}
          {inf.phase === "completed_discovery" && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-teal-600 dark:text-teal-400 font-medium">已入池</span>
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleStartPhase("contract")}><Play className="size-3" />开始签约</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleStartPhase("incubation")}><Sparkles className="size-3" />开始孵化</Button>
            </div>
          )}
        </div>
      </div>

      {error && <div className="rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-4 py-3 text-sm text-[var(--destructive)]">{error}</div>}
      {csvResult && (
        <div className="rounded-md bg-green-50 dark:bg-green-950/30 px-4 py-3 text-sm border border-green-200 dark:border-green-800">
          <p className="font-medium text-green-700 dark:text-green-300">CSV 导入成功: {csvResult.imported}/{csvResult.total} 条</p>
          {csvResult.skipped.length > 0 && (
            <details className="mt-1"><summary className="text-xs text-green-600 dark:text-green-400 cursor-pointer">跳过 {csvResult.skipped.length} 条</summary>
              <ul className="mt-1 text-xs text-[var(--muted-foreground)] space-y-0.5">{csvResult.skipped.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      {/* Two-column layout: steps + sidebar */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Steps */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Progress bar */}
          {totalSteps > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--muted-foreground)] shrink-0">已完成 {completedCount}/{totalSteps}</span>
              <div className="flex-1 h-2 rounded-full bg-[var(--muted)] overflow-hidden">
                <div className={cn("h-full rounded-full transition-all duration-300", completedCount === totalSteps ? "bg-[var(--success)]" : "bg-[var(--success)]")}
                  style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-xs font-medium shrink-0">{completedCount === totalSteps ? "全部完成" : `${progressPct}%`}</span>
            </div>
          )}

          {/* Steps by phase */}
          {phases.map(phase => {
            const phaseSteps = steps.filter(s => s.phase === phase);
            if (phaseSteps.length === 0) return null;
            return (
              <div key={phase} className={cn("rounded-xl border p-5", phaseColors[phase], phaseBgs[phase])}>
                <h3 className="text-sm font-medium mb-3">{phaseLabels[phase]}</h3>
                <div className="flex flex-col gap-0">
                  {phaseSteps.map((step, i) => {
                    const notes = stepNotes[step.id] || [];
                    const expanded = expandedSteps[step.id] || false;
                    const hasNotes = notes.length > 0;
                    const completable = canComplete(step);
                    const isOverdue = step.status === "阻塞";

                    return (
                      <div key={step.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                            step.status === "已完成" && "bg-[var(--success)] text-[var(--success-foreground)]",
                            step.status === "进行中" && "bg-[var(--primary)] text-[var(--primary-foreground)] ring-2 ring-[var(--ring)]/30",
                            step.status === "阻塞" && "bg-[var(--destructive)] text-[var(--destructive-foreground)]",
                            step.status === "已停止" && "bg-[var(--destructive)] text-[var(--destructive-foreground)]",
                            step.status === "待处理" && "bg-[var(--muted)] text-[var(--muted-foreground)]",
                          )}>{step.status === "已完成" ? "✓" : step.step_order}</div>
                          {i < phaseSteps.length - 1 && (
                            <div className={cn("w-px flex-1 min-h-[20px]", step.status === "已完成" ? "bg-[var(--success)]" : "bg-[var(--border)]")} />
                          )}
                        </div>
                        <div className="pb-5 flex-1 min-w-0">
                          {/* Step name + status tag */}
                          <div className="flex items-start gap-2 justify-between">
                            <p className={cn("text-sm", step.status === "已完成" && "line-through decoration-green-400", step.status === "已停止" && "line-through decoration-red-400")}>
                              {step.step_name}
                            </p>
                            <span className={cn("inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs", stepStatusClass[step.status])}>{step.status}</span>
                          </div>

                          {/* Assignee */}
                          <div className="mt-0.5 flex items-center gap-1">
                            <span className="text-xs text-[var(--muted-foreground)]">负责人:</span>
                            {step.assignee && step.status !== "已完成" && step.status !== "已停止" && !isClient ? (
                              editingAssigneeStepId === step.id ? (
                                <select
                                  value={step.assignee}
                                  onChange={async (e) => {
                                    const newV = e.target.value;
                                    try {
                                      await fetchWithAuth(`/api/influencers/${id}/steps`, {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ step_id: step.id, assignee: newV }),
                                      });
                                      reload();
                                    } catch {}
                                    setEditingAssigneeStepId(null);
                                  }}
                                  onBlur={() => setEditingAssigneeStepId(null)}
                                  className="rounded border border-[var(--border)] bg-[var(--background)] px-1 py-0.5 text-xs outline-none"
                                  autoFocus
                                >
                                  {employees.map(emp => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
                                </select>
                              ) : (
                                <button onClick={() => setEditingAssigneeStepId(step.id)} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:underline cursor-pointer">
                                  {step.assignee}
                                </button>
                              )
                            ) : (
                              <span className="text-xs text-[var(--muted-foreground)]">{step.assignee || "—"}</span>
                            )}
                          </div>

                          {/* Complete time */}
                          {step.status === "已完成" && step.completed_at && (
                            <p className="text-xs text-[var(--muted-foreground)]">完成于 {toThaiTime(step.completed_at)}</p>
                          )}
                          {isOverdue && step.stop_reason && (
                            <p className="text-xs text-[var(--destructive)]">🛑 {step.stop_reason}</p>
                          )}

                          {/* Action buttons */}
                          {step.status !== "已完成" && step.status !== "阻塞" && step.status !== "已停止" && !isClient && (
                            <div className="mt-2 flex items-center gap-2 flex-wrap">
                              {confirmingStepId === step.id ? (
                                <>
                                  <input
                                    value={confirmNote}
                                    onChange={e => setConfirmNote(e.target.value)}
                                    onKeyDown={e => { if (e.key === "Enter") handleConfirmComplete(step.id); if (e.key === "Escape") setConfirmingStepId(null); }}
                                    placeholder="完成备注（可选）..."
                                    className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)] w-36"
                                    autoFocus
                                  />
                                  <button onClick={() => handleConfirmComplete(step.id)} className="rounded px-2 py-0.5 text-xs bg-[var(--success)] text-[var(--success-foreground)] transition-colors">确认完成</button>
                                  <button onClick={() => { setConfirmingStepId(null); setConfirmNote(""); }} className="rounded px-2 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">取消</button>
                                </>
                              ) : (
                                <>
                                  {completable ? (
                                    <button onClick={() => { setConfirmingStepId(step.id); setConfirmNote(""); }} className="rounded border border-[color-mix(in_oklch,var(--success),var(--background)_70%)] bg-[color-mix(in_oklch,var(--success),var(--background)_92%)] px-2 py-1 text-xs text-[var(--success)] hover:bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] transition-colors">标记完成</button>
                                  ) : (
                                    <span className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] opacity-50 cursor-not-allowed select-none">需先完成前一步</span>
                                  )}
                                  <button onClick={() => handleStepUpdate(step.id, "阻塞")} className="rounded border border-[color-mix(in_oklch,var(--destructive),var(--background)_70%)] bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] px-2 py-1 text-xs text-[var(--destructive)] hover:bg-[color-mix(in_oklch,var(--destructive),var(--background)_85%)] transition-colors">标记阻塞</button>

                                  {/* CSV import at step 3 */}
                                  {step.step_order === 3 && (
                                    <>
                                      <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
                                      <button onClick={() => csvInputRef.current?.click()} disabled={csvImporting}
                                        className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-1">
                                        {csvImporting ? "导入中..." : <><UploadIcon className="size-3" />导入CSV</>}
                                      </button>
                                    </>
                                  )}

                                  {/* Factory at step 17 */}
                                  {step.step_order === 17 && (
                                    <button onClick={() => setFactoryModal(true)}
                                      className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors flex items-center gap-1">
                                      <Building className="size-3" />关联工厂 ({linkedFactories.length})
                                    </button>
                                  )}

                                  {/* Stop */}
                                  <button onClick={() => { setStopModal({ stepId: step.id, stepName: step.step_name }); setStopReason(""); setStopReasonErr(""); }}
                                    className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--destructive)] hover:bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] transition-colors">停止</button>
                                </>
                              )}
                            </div>
                          )}

                          {/* Revert button */}
                          {(step.status === "已完成" || step.status === "阻塞") && !isClient && (
                            <div className="mt-1 flex items-center gap-2">
                              {step.status === "已完成" && step.completed_at && (
                                <p className="text-xs text-[var(--muted-foreground)]">完成于 {toThaiTime(step.completed_at)}</p>
                              )}
                              <button onClick={() => handleRollback(step.id)}
                                className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
                                <Undo2 className="size-3" />撤回
                              </button>
                            </div>
                          )}

                          {/* File upload per step */}
                          <div className="mt-1 flex items-center gap-2">
                            <label className="cursor-pointer inline-flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
                              <Upload className="size-3" />
                              {stepUploading[step.id] ? stepFileNames[step.id] || "上传中..." : "附件"}
                              <input type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleStepUpload(step.id, f); e.target.value = ""; }}
                                accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx" />
                            </label>
                          </div>

                          {/* Expand notes */}
                          <button onClick={() => setExpandedSteps(p => ({ ...p, [step.id]: !expanded }))}
                            className="mt-1 flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
                            <MessageSquare className="size-3" />
                            {hasNotes && <span className="rounded-full bg-[var(--muted)] px-1.5 text-[0.65rem]">{notes.length}</span>}
                            {expanded ? "收起" : "备注"}
                          </button>

                          {expanded && (
                            <div className="mt-2 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                              {notes.length > 0 && (
                                <ul className="space-y-1.5 mb-2">
                                  {notes.map(n => (
                                    <li key={n.id} className="rounded bg-[var(--muted)] px-2.5 py-1.5 text-xs text-[var(--foreground)]">
                                      <div className="flex items-start justify-between gap-2">
                                        <p className="flex-1 whitespace-pre-wrap break-all">{n.content}</p>
                                        {!isClient && (
                                          <button onClick={() => setDeleteNoteTarget({ stepId: step.id, noteId: n.id, content: n.content })}
                                            className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] transition-colors" title="删除备注">
                                            <Trash2 className="size-3" />
                                          </button>
                                        )}
                                      </div>
                                      <p className="mt-0.5 text-[0.65rem] text-[var(--muted-foreground)]">{n.created_by} · {toThaiTime(n.created_at)}</p>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              <div className="flex gap-1.5">
                                <input value={newNotes[step.id] || ""}
                                  onChange={e => { setNewNotes(p => ({ ...p, [step.id]: e.target.value })); setNoteErrorMsg(prev => ({ ...prev, [step.id]: "" })); }}
                                  onKeyDown={e => e.key === "Enter" && handleAddNote(step.id)}
                                  placeholder="写备注..." className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                                <button onClick={() => handleAddNote(step.id)} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)]">添加</button>
                              </div>
                              {noteErrorMsg[step.id] && <p className="text-xs text-[var(--destructive)]">{noteErrorMsg[step.id]}</p>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: Sidebar panels */}
        <div className="flex flex-col gap-4">
          {/* Info card */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
            <h3 className="text-sm font-medium text-[var(--foreground)]">达人信息</h3>
            <dl className="mt-3 space-y-2 text-xs">
              {inf.line_id && <div className="flex justify-between"><dt className="text-[var(--muted-foreground)]">LINE ID</dt><dd>{inf.line_id}</dd></div>}
              {inf.contact_phone && <div className="flex justify-between"><dt className="text-[var(--muted-foreground)]">电话</dt><dd>{inf.contact_phone}</dd></div>}
              {inf.monthly_gmv && <div className="flex justify-between"><dt className="text-[var(--muted-foreground)]">月度 GMV</dt><dd>{inf.monthly_gmv}</dd></div>}
              {inf.live_stream_ratio && <div className="flex justify-between"><dt className="text-[var(--muted-foreground)]">直播占比</dt><dd>{inf.live_stream_ratio}</dd></div>}
              {inf.contact_time && <div className="flex justify-between"><dt className="text-[var(--muted-foreground)]">联系时间</dt><dd>{inf.contact_time}</dd></div>}
              {inf.reply_status && <div className="flex justify-between"><dt className="text-[var(--muted-foreground)]">回复状态</dt><dd>{inf.reply_status}</dd></div>}
              <div className="flex justify-between"><dt className="text-[var(--muted-foreground)]">创建日期</dt><dd>{toThaiTime(inf.created_at)}</dd></div>
            </dl>
            {inf.notes && <p className="mt-2 text-xs text-[var(--muted-foreground)]">{inf.notes}</p>}
          </div>

          {/* Tabs: Finances / Docs / Certs */}
          <div className="rounded-xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted),var(--background)_60%)] p-1 flex gap-1">
            {(["finances", "docs", "certs"] as const).map(tab => (
              <button key={tab} onClick={() => setSidebarTab(tab)}
                className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  sidebarTab === tab ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)]")}>
                {tab === "finances" && <><DollarSign className="mr-1 inline size-3" />费用</>}
                {tab === "docs" && <><Paperclip className="mr-1 inline size-3" />文档</>}
                {tab === "certs" && <><FileText className="mr-1 inline size-3" />证书</>}
              </button>
            ))}
          </div>

          {/* Finances panel */}
          {sidebarTab === "finances" && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium">费用记录</h3>
                <span className="text-xs text-[var(--muted-foreground)]">
                  入 ฿{totalIncome.toLocaleString()} / 出 ฿{totalExpense.toLocaleString()}
                </span>
              </div>
              {finances.length > 0 ? (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {finances.map(f => (
                    <div key={f.id} className="rounded border border-[var(--border)] p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className={cn("font-medium", f.type === "income" ? "text-[var(--success)]" : "text-[var(--destructive)]")}>
                          {f.type === "income" ? "收入" : "支出"} {f.currency === "THB" ? "฿" : "¥"}{f.amount.toLocaleString()}
                        </span>
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[0.65rem]", f.status === "paid" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700")}>
                          {f.status === "paid" ? "已付" : "待付"}
                        </span>
                      </div>
                      {f.description && <p className="mt-0.5 text-[var(--muted-foreground)]">{f.description}</p>}
                      {f.slip_file && isImageUrl(f.slip_file) && (
                        <img src={f.slip_file} alt="水单" className="mt-1 max-h-12 rounded border cursor-pointer hover:opacity-80" onClick={() => setPreviewUrl(f.slip_file)} />
                      )}
                      {f.slip_file && !isImageUrl(f.slip_file) && (
                        <a href={f.slip_file} target="_blank" className="text-[var(--primary)] hover:underline text-xs">查看水单</a>
                      )}
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-[var(--muted-foreground)]">暂无费用记录</p>}

              {/* Add finance form */}
              <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                <div className="flex gap-2">
                  <select value={newFinType} onChange={e => setNewFinType(e.target.value)} className="h-7 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs">
                    <option value="income">收入</option>
                    <option value="expense">支出</option>
                  </select>
                  <select value={newFinCurrency} onChange={e => setNewFinCurrency(e.target.value)} className="h-7 w-16 rounded border border-[var(--border)] bg-[var(--background)] px-1 text-xs">
                    <option value="CNY">¥</option>
                    <option value="THB">฿</option>
                  </select>
                  <input value={newFinAmount} onChange={e => setNewFinAmount(e.target.value)} placeholder="金额" type="number" className="flex-1 h-7 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--ring)]" />
                </div>
                <input value={newFinDesc} onChange={e => setNewFinDesc(e.target.value)} placeholder="描述" className="w-full h-7 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--ring)]" />
                <div className="flex gap-1.5 items-center">
                  <label className="shrink-0 cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)]">
                    {uploadingFin ? "上传中..." : finFileName || "选择水单"}
                    <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf" className="hidden" onChange={async e => {
                      const file = e.target.files?.[0]; if (!file) return;
                      setUploadingFin(true); setFinFileName(file.name);
                      try {
                        const fd = new FormData(); fd.append("file", file);
                        const ur = await fetch("/api/upload", { method: "POST", body: fd });
                        if (!ur.ok) throw new Error("");
                        const data = await ur.json(); setFinSlipFile(data.url);
                      } catch { setFinErrorMsg("上传失败"); setFinFileName(""); }
                      finally { setUploadingFin(false); }
                    }} disabled={uploadingFin} />
                  </label>
                  <button onClick={handleAddFinance} disabled={uploadingFin} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)] disabled:opacity-50">添加</button>
                </div>
                {finErrorMsg && <p className="text-xs text-[var(--destructive)]">{finErrorMsg}</p>}
              </div>
            </div>
          )}

          {/* Documents panel */}
          {sidebarTab === "docs" && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
              <h3 className="text-sm font-medium mb-3">文档管理</h3>
              {docs.length > 0 ? (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {docs.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between rounded border border-[var(--border)] p-2 text-xs">
                      <div className="min-w-0 flex-1 flex items-center gap-1.5">
                        {doc.file_url && isImageUrl(doc.file_url) && (
                          <img src={doc.file_url} alt={doc.name} className="max-h-10 rounded border cursor-pointer hover:opacity-80" onClick={() => setPreviewUrl(doc.file_url)} />
                        )}
                        <p className="truncate">{doc.name}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {doc.file_url && !isImageUrl(doc.file_url) && (
                          <a href={doc.file_url} target="_blank" className="text-[var(--primary)] hover:underline">查看</a>
                        )}
                        <button onClick={() => handleDeleteDocument(doc.id)} className="text-[var(--destructive)] hover:bg-[var(--destructive)]/10 rounded p-0.5"><Trash2 className="size-3" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-[var(--muted-foreground)]">暂无文档</p>}

              <div className="mt-3 flex gap-1.5 border-t border-[var(--border)] pt-3">
                <input value={newDocName} onChange={e => setNewDocName(e.target.value)} placeholder="文档名" className="flex-1 h-7 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--ring)]" />
                <label className="shrink-0 cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] flex items-center">
                  {uploadingDoc ? "..." : docFileName || "文件"}
                  <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx" onChange={async e => {
                    const file = e.target.files?.[0]; if (!file) return;
                    setUploadingDoc(true); setDocFileName(file.name);
                    try {
                      const fd = new FormData(); fd.append("file", file);
                      const ur = await fetch("/api/upload", { method: "POST", body: fd });
                      if (!ur.ok) throw new Error("");
                      const data = await ur.json(); setDocFileUrl(data.url);
                    } catch { setDocErrorMsg("上传失败"); setDocFileName(""); }
                    finally { setUploadingDoc(false); }
                  }} disabled={uploadingDoc} />
                </label>
                <button onClick={handleAddDocument} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)]">添加</button>
              </div>
              {docErrorMsg && <p className="text-xs text-[var(--destructive)]">{docErrorMsg}</p>}
            </div>
          )}

          {/* Certificates panel */}
          {sidebarTab === "certs" && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
              <h3 className="text-sm font-medium mb-3">证书管理</h3>
              {certs.length > 0 ? (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {certs.map(cert => (
                    editingCertId === cert.id ? (
                      <div key={cert.id} className="space-y-1.5 rounded border border-[var(--ring)] p-2 text-xs">
                        <input value={editCertFields.certificate_number || ""} onChange={e => setEditCertFields(p => ({ ...p, certificate_number: e.target.value }))}
                          placeholder="证书编号" className="w-full h-7 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none" />
                        <input value={editCertFields.product_name || ""} onChange={e => setEditCertFields(p => ({ ...p, product_name: e.target.value }))}
                          placeholder="产品名称" className="w-full h-7 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none" />
                        <div className="flex gap-2">
                          <button onClick={() => handleSaveCertificate(cert.id)} className="rounded bg-[var(--primary)] px-2 py-0.5 text-xs text-[var(--primary-foreground)]">保存</button>
                          <button onClick={() => setEditingCertId(null)} className="rounded border px-2 py-0.5 text-xs text-[var(--muted-foreground)]">取消</button>
                        </div>
                      </div>
                    ) : (
                      <div key={cert.id} className="flex items-center justify-between rounded border border-[var(--border)] p-2 text-xs">
                        <div className="min-w-0">
                          <p className="font-medium">{cert.certificate_number}</p>
                          {cert.product_name && <p className="text-[var(--muted-foreground)]">{cert.product_name}</p>}
                          {cert.issue_date && <p className="text-[var(--muted-foreground)]">{cert.issue_date} ~ {cert.expiry_date || "—"}</p>}
                          {cert.file_url && isImageUrl(cert.file_url) && (
                            <img src={cert.file_url} alt="证书" className="mt-1 max-h-12 rounded border cursor-pointer hover:opacity-80" onClick={() => setPreviewUrl(cert.file_url)} />
                          )}
                          {cert.file_url && !isImageUrl(cert.file_url) && (
                            <a href={cert.file_url} target="_blank" className="text-[var(--primary)] hover:underline">查看证书文件</a>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {!isClient && <button onClick={() => { setEditingCertId(cert.id); setEditCertFields({ certificate_number: cert.certificate_number, product_name: cert.product_name, issue_date: cert.issue_date, expiry_date: cert.expiry_date, notes: cert.notes, file_url: cert.file_url }); }} className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]" title="编辑"><Pencil className="size-3" /></button>}
                          {!isClient && <button onClick={() => handleDeleteCertificate(cert.id)} className="rounded p-0.5 text-[var(--destructive)] hover:bg-[var(--destructive)]/10" title="删除"><Trash2 className="size-3" /></button>}
                        </div>
                      </div>
                    )
                  ))}
                </div>
              ) : <p className="text-xs text-[var(--muted-foreground)]">暂无证书</p>}
              <div className="mt-3 flex gap-1.5 border-t border-[var(--border)] pt-3">
                <input value={newCertNo} onChange={e => setNewCertNo(e.target.value)} placeholder="证书编号" className="flex-1 h-7 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--ring)]" />
                <label className="shrink-0 cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] flex items-center">
                  {uploadingCert ? "..." : certFileName || "文件"}
                  <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={async e => {
                    const file = e.target.files?.[0]; if (!file) return;
                    setUploadingCert(true); setCertFileName(file.name);
                    try {
                      const fd = new FormData(); fd.append("file", file);
                      const ur = await fetch("/api/upload", { method: "POST", body: fd });
                      if (!ur.ok) throw new Error("");
                      const data = await ur.json(); setCertFileUrl(data.url);
                    } catch { setCertErrorMsg("上传失败"); setCertFileName(""); }
                    finally { setUploadingCert(false); }
                  }} disabled={uploadingCert} />
                </label>
                <button onClick={handleAddCertificate} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)] flex items-center gap-1"><Plus className="size-3" /></button>
              </div>
              {certErrorMsg && <p className="text-xs text-[var(--destructive)]">{certErrorMsg}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
