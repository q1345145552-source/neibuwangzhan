"use client";

import { CommerceTermsSummary } from "@/components/commerce-terms";

import React, { useState, useEffect, use, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, DollarSign, Paperclip, Plus, Upload, MessageSquare, CheckCircle2, Circle, Pencil, Trash2, Edit3, Save, X, Undo2, Copy, CheckCheck, Link2, Ban } from "lucide-react";
import { StepTimer } from "@/components/step-timer";
import { useAuth } from "@/components/auth-provider";
import { CustomerPicker, customerExists, isKnownCustomer, type PoolCustomer } from "@/components/customer-picker";
import { fetchWithAuth, fetchOrder, updateStep, fetchDocuments, fetchFinances, uploadDocument, addFinance, updateFinance, deleteFinance, fetchStepNotes, addStepNote, deleteStepNote, fetchStepDocuments, markStepDocumentUploaded, fetchCertificates, addCertificate, updateCertificate, deleteCertificate, fetchEmployees, fetchBusinessTypes, updateOrder, deleteOrder, deleteDocument, type Employee } from "@/lib/api";
import { orderStatusClass, orderStatusLabel, confirmOrder } from "@/lib/api";
import type { BusinessType } from "@/lib/api";
import type { Order, OrderStep, Document, Finance, StepNote, StepDocument, Certificate } from "@/lib/api";
import { getStepDocs, subServices } from "@/lib/constants";

// 客户站同步的待分类单（2026-10-03 起可改派：换到正式业务线时服务端换成该线整套流程）
const UNCLASSIFIED_SUB = "storefront-unclassified";
import { cn, toThaiTime, formatCurrency, fileUrl } from "@/lib/utils";
import { calcWorkSeconds, formatWorkSeconds } from "@/lib/work-hours";
import { getStoredAuthToken } from "@/lib/auth-storage";
import { isStepClosed, isParallelFlow } from "@/lib/step-status";
import { COMPANY_REGISTRATION_STEP_COPY } from "@/lib/company-registration-step-copy";
import { WORK_VISA_STEP_COPY } from "@/lib/work-visa-step-copy";
import { SOCIAL_SECURITY_STEP_COPY } from "@/lib/social-security-step-copy";
import { TM_REGISTRATION_STEP_COPY } from "@/lib/tm-registration-step-copy";
import { INTERNATIONAL_TRADEMARK_STEP_COPY } from "@/lib/international-trademark-step-copy";
import { BUY_R_TRADEMARK_STEP_COPY } from "@/lib/buy-r-trademark-step-copy";
import { FDA_STEP_COPY } from "@/lib/fda-step-copy";
import { TISI_STEP_COPY } from "@/lib/tisi-step-copy";
import { CUSTOMER_ADDRESS_STEP_COPY, XIANGTAI_ADDRESS_STEP_COPY } from "@/lib/address-certification-step-copy";

const stepStatusClass: Record<string, string> = {
  "待处理": "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  "进行中": "bg-[color-mix(in_oklch,var(--info),var(--background)_85%)] text-[oklch(0.38_0.10_240)]",
  "已完成": "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  "阻塞": "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]",
  "已跳过": "bg-[var(--muted)] text-[var(--muted-foreground)]",
};

// 费用状态展示：收入显示核对结果（待核对/已到账/未到账），支出显示 已付/待付/已取消
function financeStatusText(f: Finance): string {
  if (f.type === "income") {
    if (f.status === "paid") return "已到账";
    // 核对上线前录的 pending 收入也等老板核对（2026-10-15）
    if (f.status === "待核对" || f.status === "pending") return "待核对";
    if (f.status === "未到账") return "未到账";
    return "已取消";
  }
  return f.status === "paid" ? "已付" : f.status === "pending" ? "待付" : "已取消";
}
function financeStatusClass(f: Finance): string {
  if (f.type === "income") {
    if (f.status === "paid") return "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]";
    if (f.status === "待核对" || f.status === "pending") return "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[var(--warning)]";
    if (f.status === "未到账") return "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[var(--destructive)]";
    return "bg-[var(--muted)] text-[var(--muted-foreground)]";
  }
  return f.status === "paid" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]" : f.status === "pending" ? "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[var(--warning)]" : "bg-[var(--muted)] text-[var(--muted-foreground)]";
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const isClient = user?.role === "client";
  const [order, setOrder] = useState<Order | null>(null);
  const isNativeCommerce = order?.source_system === "commerce";
  const isCommerceCancelled = isNativeCommerce && order?.status === "客户取消";
  const [steps, setSteps] = useState<OrderStep[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [finances, setFinances] = useState<Finance[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [stepNotes, setStepNotes] = useState<Record<number, StepNote[]>>({});
  const [stepDocs, setStepDocs] = useState<Record<number, StepDocument[]>>({});
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});
  const [confirmingStepId, setConfirmingStepId] = useState<number | null>(null);
  // 标阻塞、跳过都要写一句原因，记进这一步的备注（2026-10-16）
  const [reasonFor, setReasonFor] = useState<{ stepId: number; kind: "阻塞" | "已跳过" } | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [docUploading, setDocUploading] = useState<Record<number, boolean>>({});
  const [stepUploading, setStepUploading] = useState<Record<number, boolean>>({});
  const [stepFileNames, setStepFileNames] = useState<Record<number, string>>({});
  const [stepUploadErrors, setStepUploadErrors] = useState<Record<number, string>>({});
  const [newNotes, setNewNotes] = useState<Record<number, string>>({});
  const [noteErrorMsg, setNoteErrorMsg] = useState<Record<number, string>>({});
  const [deleteNoteTarget, setDeleteNoteTarget] = useState<{stepId:number, noteId:number, content:string} | null>(null);
  const [deletingNote, setDeletingNote] = useState(false);
  const [editingAssigneeStepId, setEditingAssigneeStepId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [businessTypes, setBusinessTypes] = useState<BusinessType[]>([]);

  useEffect(() => {
    if (!user || isClient) return;
    fetchEmployees().then(setEmployees).catch(() => {});
    fetchBusinessTypes().then(setBusinessTypes).catch(() => {});
  }, [user, isClient]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"finances" | "docs">("finances");
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSaving, setCancelSaving] = useState(false);
  // 取消弹窗里的报错（原来写在页面顶上，被弹窗遮罩挡住，看着像没反应）
  const [cancelError, setCancelError] = useState("");

  // ── 反馈链接 ──
  const loadFeedbackLink = async () => {
    try {
      const res = await fetchWithAuth(`/api/orders/${id}/feedback-token`);
      if (res.ok) {
        const d = await res.json();
        setFeedbackLink(d.link || null);
        setFeedbackSubmitted(d.submitted || false);
      }
    } catch {}
  };

  const generateFeedbackLink = async () => {
    try {
      const res = await fetchWithAuth(`/api/orders/${id}/feedback-token`, { method: "POST" });
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

    // 方案1：navigator.clipboard（需 HTTPS 或 localhost）
    try {
      await navigator.clipboard.writeText(feedbackLink);
      succeeded = true;
    } catch {}

    // 方案2：document.execCommand('copy') 兼容 HTTP
    if (!succeeded) {
      try {
        const ta = document.createElement("textarea");
        ta.value = feedbackLink;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        succeeded = true;
      } catch {}
    }

    if (succeeded) {
      setCopyingLink(true);
      setTimeout(() => setCopyingLink(false), 2000);
    } else {
      // 方案3：弹窗显示链接，用户手动复制
      setCopyModalLink(feedbackLink);
    }
  };

  // 人员耗时汇总（计时起点 = max(created_at, 上一步完成时间)）
  const personEntries = (() => {
  const personHours: Record<string, number> = {};
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.status === "已完成" && s.completed_at && s.assignee && s.started_at) {
        personHours[s.assignee] = (personHours[s.assignee] || 0) + calcWorkSeconds(s.started_at, s.completed_at);
      }
    }
    return Object.entries(personHours).sort((a, b) => b[1] - a[1]);
  })();
  const [newDocName, setNewDocName] = useState("");
  const [newCertNo, setNewCertNo] = useState("");
  // 签发、到期日照证书填；不再自动填「今天签发、一年后到期」，那是假日期，到期提醒会跟着错（2026-10-15）
  const [newCertIssue, setNewCertIssue] = useState("");
  const [newCertExpiry, setNewCertExpiry] = useState("");
  const [editingCertId, setEditingCertId] = useState<number | null>(null);
  const [editCertFields, setEditCertFields] = useState<Partial<Certificate>>({});
  // Finances form
  const [newFinDesc, setNewFinDesc] = useState("");
  const [newFinAmount, setNewFinAmount] = useState("");
  const [newFinType, setNewFinType] = useState("income");
  const effectiveFinType = isNativeCommerce ? "expense" : newFinType;
  const [newFinCurrency, setNewFinCurrency] = useState("CNY");
  const [exchangeRate, setExchangeRateState] = useState<number>(() => {
    if (typeof window === "undefined") return 5;
    const stored = Number(localStorage.getItem("cnyToThbRate"));
    return stored > 0 ? stored : 5;
  });
  const setExchangeRate = (rate: number) => {
    setExchangeRateState(rate);
    if (typeof window !== "undefined") localStorage.setItem("cnyToThbRate", String(rate));
  };
  const [newFinMethod, setNewFinMethod] = useState("");
  const [newFinSlip, setNewFinSlip] = useState("");
  const [finErrorMsg, setFinErrorMsg] = useState("");
  const [finFileName, setFinFileName] = useState("");
  const [uploadingFin, setUploadingFin] = useState(false);
  const [finSlipFile, setFinSlipFile] = useState("");
  const finUploadInput = useRef<HTMLInputElement>(null);
  const [docFileName, setDocFileName] = useState("");
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [certFileName, setCertFileName] = useState("");
  const [certFileUrl, setCertFileUrl] = useState("");
  const [uploadingCert, setUploadingCert] = useState(false);
  const [docFileUrl, setDocFileUrl] = useState("");
  const [docErrorMsg, setDocErrorMsg] = useState("");
  // 补件要求（2026-10-03）：只有客户网站同步过来的单才有
  const [supplementRequests, setSupplementRequests] = useState<{ id: string; name: string; description: string; created_by: string; created_at: string; submitted_at: string | null; latest_status?: string | null }[]>([]);
  const [reqName, setReqName] = useState("");
  // 客户站内申请取消（2026-10-03，规则 19/20）
  const [cancelRequests, setCancelRequests] = useState<{ id: string; line_no: number; copy_no: number; reason: string; status: "pending" | "approved" | "rejected"; decision_note: string; decided_by: string | null; decided_at: string | null; created_at: string }[]>([]);
  const [cancelReqAction, setCancelReqAction] = useState<{ id: string; mode: "approve" | "reject" } | null>(null);
  const [cancelReqNote, setCancelReqNote] = useState("");
  const [cancelReqError, setCancelReqError] = useState("");
  const [decidingCancelReq, setDecidingCancelReq] = useState(false);
  const [reqDesc, setReqDesc] = useState("");
  const [reqError, setReqError] = useState("");
  const [sendingReq, setSendingReq] = useState(false);
  const [certErrorMsg, setCertErrorMsg] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [feedbackLink, setFeedbackLink] = useState<string | null>(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [copyingLink, setCopyingLink] = useState(false);
  const [copyModalLink, setCopyModalLink] = useState<string | null>(null);
  // 编辑模式
  const [editingOrder, setEditingOrder] = useState(false);
  const [editFields, setEditFields] = useState<Partial<Order>>({});
  // 改客户（员工建的单）：从客户管理里选，没有的当场新建（2026-10-16，2A）
  const [customerPool, setCustomerPool] = useState<PoolCustomer[]>([]);
  const [editNewCustomer, setEditNewCustomer] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{id:string,name:string}|null>(null);
  const [deletingOrder, setDeletingOrder] = useState(false);
  const [orderDeleteError, setOrderDeleteError] = useState<string | null>(null);
  // 费用编辑删除
  const [editingFinanceId, setEditingFinanceId] = useState<number | null>(null);
  const [editFinanceFields, setEditFinanceFields] = useState<Partial<Finance>>({});
  const [deleteFinanceTarget, setDeleteFinanceTarget] = useState<number | null>(null);
  const [deletingFinance, setDeletingFinance] = useState(false);
  // 证书删除
  const [deleteCertTarget, setDeleteCertTarget] = useState<number | null>(null);
  const [deletingCert, setDeletingCert] = useState(false);
  const [deleteDocTarget, setDeleteDocTarget] = useState<number | null>(null);
  const [deletingDoc, setDeletingDoc] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!user) return;
    if (isClient) setSidebarTab("docs");
    let ignore = false;
    async function run() {
      try {
        const [data, docs, fins, certs] = await Promise.all([
          fetchOrder(id),
          fetchDocuments(id),
          isClient ? Promise.resolve([] as Finance[]) : fetchFinances(id),
          fetchCertificates(id),
        ]);
        if (ignore) return;
        setOrder(data);
        if (data.currency) setNewFinCurrency(data.currency);
        const sts = data.steps || [];
        setSteps(sts);
        setDocuments(docs);
        setFinances(fins);
        setCertificates(certs);

        // 一次拿全部步骤的备注和文件清单。
        // 原来是遍历步骤各发 2 个请求，10 个步骤就是 20 次往返。
        let notesMap: Record<number, StepNote[]> = {};
        let docsMap: Record<number, StepDocument[]> = {};
        try {
          if (isClient) {
            const publicSteps = await Promise.all(sts.map(async step => ({
              stepId: step.id,
              notes: await fetchStepNotes(id, step.id),
              documents: await fetchStepDocuments(id, step.id),
            })));
            for (const step of publicSteps) { notesMap[step.stepId] = step.notes; docsMap[step.stepId] = step.documents; }
          } else {
          const r = await fetchWithAuth(`/api/orders/${id}/steps/details`, { cache: "no-store" });
          if (r.ok) {
            const d = await r.json();
            notesMap = d.notes || {};
            docsMap = d.documents || {};
          }
          }
        } catch { /* 详情拿不到不影响主体展示，留空即可 */ }
        if (ignore) return;
        setStepNotes(notesMap);
        setStepDocs(docsMap);
        if (!isClient && data.source_system === "storefront") {
          try {
            const r = await fetchWithAuth(`/api/orders/${id}/supplement-requests`, { cache: "no-store" });
            if (r.ok && !ignore) setSupplementRequests(await r.json());
          } catch { /* 拿不到不影响主体展示 */ }
          try {
            const r = await fetchWithAuth(`/api/orders/${id}/cancel-requests`, { cache: "no-store" });
            if (r.ok && !ignore) setCancelRequests(await r.json());
          } catch { /* 拿不到不影响主体展示 */ }
        }
      } catch {
        if (!ignore) setError("订单加载失败");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    run();
    return () => { ignore = true; };
  }, [id, refreshKey, user, isClient]);

  const toggleExpand = (stepId: number) => {
    setExpandedSteps((prev) => ({ ...prev, [stepId]: !prev[stepId] }));
  };

  const handleAddNote = async (stepId: number) => {
    const content = newNotes[stepId];
    if (!content?.trim()) {
      setNoteErrorMsg(prev => ({ ...prev, [stepId]: "请填写备注内容" }));
      return;
    }
    setNoteErrorMsg(prev => ({ ...prev, [stepId]: "" }));
    // addStepNote 失败会 throw（403/400 等），不接住的话备注框会被清空、
    // 用户以为写成功了，实际什么都没保存
    try {
      await addStepNote(id, stepId, content, user?.name || "系统");
      setNewNotes((prev) => ({ ...prev, [stepId]: "" }));
      const notes = await fetchStepNotes(id, stepId);
      setStepNotes((prev) => ({ ...prev, [stepId]: notes }));
    } catch (err) {
      setNoteErrorMsg(prev => ({ ...prev, [stepId]: err instanceof Error ? err.message : "添加备注失败" }));
    }
  };

  const handleDeleteNote = async () => {
    if (!deleteNoteTarget) return;
    setDeletingNote(true);
    try {
      await deleteStepNote(id, deleteNoteTarget.stepId, deleteNoteTarget.noteId);
      const notes = await fetchStepNotes(id, deleteNoteTarget.stepId);
      setStepNotes((prev) => ({ ...prev, [deleteNoteTarget.stepId]: notes }));
      setDeleteNoteTarget(null);
    } catch (err) {
      console.error("删除备注失败:", err);
    } finally {
      setDeletingNote(false);
    }
  };

  const handleMarkUploaded = async (stepId: number, docId: number) => {
    try {
      await markStepDocumentUploaded(id, stepId, docId);
      const docs = await fetchStepDocuments(id, stepId);
      setStepDocs((prev) => ({ ...prev, [stepId]: docs }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "标记上传失败");
    }
  };

  const handleConfirmComplete = async (stepId: number) => {
    const noteContent = newNotes[stepId]?.trim();
    setConfirmingStepId(null);
    setNewNotes((prev) => ({ ...prev, [stepId]: "" }));
    try {
      if (noteContent) {
        await addStepNote(id, stepId, noteContent, user?.name || "系统");
      }
      await updateStep(id, stepId, { status: "已完成" });
      // 自动启动下一步（跳过的步骤不算）；公司注册那套各步互不阻塞，没有「下一步」，不自动开始（不然用不上的条件步骤也被开始、算成当前步骤和超时）
      const idx = steps.findIndex(s => s.id === stepId);
      const parallel = !!order && isParallelFlow(order.business_type_id, order.sub_service_type);
      const next = idx >= 0 && !parallel ? steps.slice(idx + 1).find(s => !isStepClosed(s.status)) || null : null;
      if (next && next.status === "待处理") {
        await updateStep(id, next.id, { status: "进行中" });
      }
      reload();
    } catch (e) { console.error("[订单] 步骤完成失败", e); setError(e instanceof Error ? e.message : "更新失败"); }
  };

  // 标阻塞 / 跳过：带原因提交
  const handleReasonSubmit = async () => {
    if (!reasonFor) return;
    const text = reasonText.trim();
    if (!text) { setError(reasonFor.kind === "已跳过" ? "跳过要写原因" : "请写一句为什么卡住"); return; }
    try {
      await updateStep(id, reasonFor.stepId, { status: reasonFor.kind, reason: text });
      // 跳过和点完成一样：顺手开始下一步（跳过的步骤不算）
      if (reasonFor.kind === "已跳过" && !(order && isParallelFlow(order.business_type_id, order.sub_service_type))) {
        const idx = steps.findIndex(s => s.id === reasonFor.stepId);
        const next = idx >= 0 ? steps.slice(idx + 1).find(s => !isStepClosed(s.status)) || null : null;
        if (next && next.status === "待处理") await updateStep(id, next.id, { status: "进行中" });
      }
      setReasonFor(null);
      setReasonText("");
      reload();
    } catch (e) { console.error("[订单] 步骤状态修改失败", e); setError(e instanceof Error ? e.message : "更新失败"); }
  };

  // 所需文件某一行直接上传：存文件、记一条「上传文件」备注（带资料名）、把这一行标成已上传
  const handleDocUpload = async (stepId: number, docId: number, docName: string, file: File) => {
    setDocUploading(p => ({ ...p, [docId]: true }));
    try {
      const fd = new FormData(); fd.append("file", file);
      const ur = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
      if (!ur.ok) throw new Error("上传失败");
      const { url } = await ur.json();
      await addStepNote(id, stepId, `上传文件: 【${docName}】${file.name} (${url})`, user?.name || "系统");
      await markStepDocumentUploaded(id, stepId, docId);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setDocUploading(p => ({ ...p, [docId]: false }));
    }
  };

  // 步骤撤回（先确认：已办完的单撤回后会变回办理中，客户站也跟着变）
  const handleRollback = async (stepId: number) => {
    const target = steps.find(s => s.id === stepId);
    // 撤回跳过的步骤：前面还有没办完的就回到「待处理」，不提前算开始
    const back = target?.status === "已跳过" && !(order && isParallelFlow(order.business_type_id, order.sub_service_type)) && steps.some(s => s.step_order < target.step_order && !isStepClosed(s.status)) ? "待处理" : "进行中";
    if (!window.confirm(`确定撤回「${target?.step_name || "这一步"}」？这一步会回到「${back}」${order?.status === "已完成" ? "，整单也会变回办理中，客户那边看到的进度会跟着变" : ""}。`)) return;
    try {
      await updateStep(id, stepId, { status: back });
      reload();
    } catch (e) { console.error("[订单] 步骤撤回失败", e); setError(e instanceof Error ? e.message : "撤回失败"); }
  };

  // 费用保存
  const handleSaveFinance = async (financeId: number) => {
    try {
      const current = finances.find(f => f.id === financeId);
      // 收入的状态只走老板核对，编辑时不提交；支出只认已付/待付/已取消（收入改成支出时默认待付）
      const { status, ...rest } = editFinanceFields;
      const nextType = editFinanceFields.type || current?.type;
      const expenseStatus = status && ["paid", "pending", "cancelled"].includes(status) ? status : "pending";
      await updateFinance(id, financeId, nextType === "expense" ? { ...rest, status: expenseStatus } : rest);
      setEditingFinanceId(null);
      setEditFinanceFields({});
      reload();
    } catch (e) { console.error("[订单] 保存费用失败", e); setError(e instanceof Error ? e.message : "保存费用失败"); }
  };

  // 费用删除
  const handleDeleteFinance = async () => {
    if (!deleteFinanceTarget) return;
    setDeletingFinance(true);
    try {
      await deleteFinance(id, deleteFinanceTarget);
      setDeleteFinanceTarget(null);
      reload();
    } catch (e) { console.error("[订单] 删除费用失败", e); setError(e instanceof Error ? e.message : "删除费用失败"); setDeletingFinance(false); setDeleteFinanceTarget(null); }
  };

  // 证书删除
  const handleDeleteCert = async () => {
    if (!deleteCertTarget) return;
    setDeletingCert(true);
    try {
      await deleteCertificate(id, deleteCertTarget);
      setDeleteCertTarget(null);
      reload();
    } catch (e) { console.error("[订单] 删除证书失败", e); setError("删除证书失败"); setDeletingCert(false); setDeleteCertTarget(null); }
  };

  const handleReviewDocument = async (documentId: number, publish: boolean) => {
    if (publish && !window.confirm("确认已核对这份资料，可向该订单客户公开？")) return;
    setDocErrorMsg("");
    try {
      const response = await fetchWithAuth(`/api/orders/${id}/documents`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: documentId, status: "已审核", ...(publish ? { direction: "us_to_client" } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "审核失败");
      reload();
    } catch (error) { setDocErrorMsg(error instanceof Error ? error.message : "审核失败"); }
  };

  // 退回客户交的资料（2026-10-03）：客户站送来的资料，原因会随审核结果发给客户，所以必须填
  const handleReturnDocument = async (doc: Document) => {
    const fromStorefront = doc.uploaded_by?.startsWith("客户站：");
    const reason = window.prompt(fromStorefront ? "退回原因（会发给客户，请写清要怎么改）：" : "退回原因（可不填）：");
    if (reason === null) return;
    if (fromStorefront && !reason.trim()) { setDocErrorMsg("请填写退回原因，客户会看到"); return; }
    setDocErrorMsg("");
    try {
      const response = await fetchWithAuth(`/api/orders/${id}/documents`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: doc.id, status: "已退回", review_note: reason.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "退回失败");
      reload();
    } catch (error) { setDocErrorMsg(error instanceof Error ? error.message : "退回失败"); }
  };

  // 发补件要求给客户网站的客户（2026-10-03）：进客户的资料待办，客户按它交的资料会回到这里
  const handleSendSupplementRequest = async () => {
    if (!reqName.trim()) { setReqError("请填写要补的资料名称"); return; }
    setSendingReq(true); setReqError("");
    try {
      const response = await fetchWithAuth(`/api/orders/${id}/supplement-requests`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: reqName.trim(), description: reqDesc.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "发送失败");
      setReqName(""); setReqDesc("");
      reload();
    } catch (error) { setReqError(error instanceof Error ? error.message : "发送失败"); }
    finally { setSendingReq(false); }
  };

  // 处理客户站内的取消申请（仅管理员）：同意 = 这张单变「客户取消」；不同意要写原因，客户能看到
  const handleDecideCancelRequest = async () => {
    if (!cancelReqAction) return;
    if (cancelReqAction.mode === "reject" && !cancelReqNote.trim()) { setCancelReqError("请填写不同意的原因（客户能看到）"); return; }
    setDecidingCancelReq(true); setCancelReqError("");
    try {
      const response = await fetchWithAuth(`/api/orders/${id}/cancel-requests`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: cancelReqAction.id, decision: cancelReqAction.mode, note: cancelReqNote.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "处理失败");
      setCancelReqAction(null); setCancelReqNote("");
      reload();
    } catch (error) { setCancelReqError(error instanceof Error ? error.message : "处理失败"); }
    finally { setDecidingCancelReq(false); }
  };

  // 文档删除
  const handleDeleteDoc = async () => {
    if (!deleteDocTarget) return;
    setDeletingDoc(true);
    try {
      await deleteDocument(id, deleteDocTarget);
      setDeleteDocTarget(null);
      reload();
    } catch (e) { console.error("[订单] 删除文档失败", e); setDocErrorMsg(e instanceof Error ? e.message : "删除文档失败"); setDeletingDoc(false); setDeleteDocTarget(null); }
  };

  const handleSaveCert = async (certId: number) => {
    try {
      await updateCertificate(id, certId, editCertFields);
      setEditingCertId(null);
      setEditCertFields({});
      reload();
    } catch (e) { console.error("[订单] 保存证书失败", e); setError("保存证书失败"); }
  };

  const handleStepUpdate = async (stepId: number, newStatus: string) => {
    try {
      await updateStep(id, stepId, { status: newStatus });
      reload();
    } catch (e) { console.error("[订单] 步骤状态修改失败", e); setError(e instanceof Error ? e.message : "更新失败"); }
  };

  // 确认订单（2026-10-19 老板拍板，防客户恶意下单）：客户网站来的单确认后才能开始办理，所有员工都能点
  const [confirming, setConfirming] = useState(false);
  const handleConfirmOrder = async () => {
    if (!order) return;
    const group = order.confirm_group_size || 1;
    const tip = `确认这是客户真实下的单？\n确认后才能开始办理；客户网站会显示「已确认」，客户就能上传资料和付款水单。${group > 1 ? `\n这笔客户订单拆出的 ${group} 张办理单会一起确认。` : ""}\n不想接的单请不要确认，由管理员取消。`;
    if (!window.confirm(tip)) return;
    setConfirming(true);
    try {
      await confirmOrder(id);
      reload();
    } catch (e) { console.error("[订单] 确认订单失败", e); setError(e instanceof Error ? e.message : "确认订单失败"); }
    finally { setConfirming(false); }
  };

  // 编辑订单
  const startEdit = () => {
    try {
      if (!order) return;
      setEditFields({
        customer_name: order.customer_name,
        business_type_id: order.business_type_id,
        responsible_person: order.responsible_person,
        description: order.description,
        total_amount: order.total_amount,
        sub_service_type: order.sub_service_type,
        address_type: order.address_type,
        monthly_rent: order.monthly_rent,
        currency: order.currency || "CNY",
        trademark_name: order.trademark_name || "",
      });
      setEditNewCustomer(false);
      if (!order.source_system && customerPool.length === 0) {
        fetchWithAuth("/api/customers").then(r => r.json()).then(d => setCustomerPool(Array.isArray(d) ? d : [])).catch(e => console.error("[编辑] 加载客户管理名单失败", e));
      }
      setEditingOrder(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "切换编辑失败";
      console.error("[编辑] 切编辑态失败:", msg, err);
      setError(msg);
    }
  };

  const handleSaveOrder = async () => {
    if (!order) return;
    const reassignTo = order.sub_service_type === UNCLASSIFIED_SUB
      ? businessTypes.find(b => b.id === Number(editFields.business_type_id) && b.name !== "待分类") : undefined;
    if (reassignTo && (subServices[reassignTo.id] || []).length > 0 && !editFields.sub_service_type) {
      setError(`改派到「${reassignTo.name}」要先选具体服务`);
      return;
    }
    if (reassignTo && !window.confirm(`确定把这张单改派到「${reassignTo.name}」？\n会换成该业务线的整套办理流程，已做的「方案确认」和写过的备注都保留。改派只能做一次。`)) return;
    const nextCustomer = String(editFields.customer_name ?? "").trim();
    const customerChanged = !order.source_system && nextCustomer !== String(order.customer_name || "").trim();
    const knownCustomer = customerChanged && (isKnownCustomer(customerPool, nextCustomer) || (!editNewCustomer && await customerExists(nextCustomer)));
    if (customerChanged && !knownCustomer && !editNewCustomer) {
      setError("客户要从下拉里选客户管理里的客户" + (user?.role === "admin" ? "，没有的点「新建客户」" : "；客户管理里还没有的，请管理员先新建"));
      return;
    }
    setSavingOrder(true);
    setError("");
    try {
      await updateOrder(id, { ...editFields, ...(customerChanged ? { customer_name: nextCustomer, new_customer: editNewCustomer && !knownCustomer } : order.source_system ? {} : { customer_name: order.customer_name }) });
      setEditingOrder(false);
      reload();
    } catch (err) {
      console.error("保存订单失败:", err);
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingOrder(false);
    }
  };

  const handleConfirmDeleteOrder = async () => {
    if (!deleteTarget) return;
    setDeletingOrder(true);
    setOrderDeleteError(null);
    try {
      await deleteOrder(deleteTarget.id);
      router.push("/orders");
    } catch (err) {
      console.error("删除订单失败:", err);
      setOrderDeleteError(err instanceof Error ? err.message : "删除失败，请重试");
      setDeletingOrder(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!order) return;
    const reason = cancelReason.trim();
    if (!reason) { setCancelError("请填写取消原因"); return; }
    setCancelSaving(true);
    setCancelError("");
    try {
      const updated = await updateOrder(order.id, { cancel: true, cancel_reason: reason });
      setOrder(updated);
      setShowCancelModal(false);
      setCancelReason("");
      reload();
    } catch (err) {
      console.error("取消订单失败:", err);
      setCancelError(err instanceof Error ? err.message : "取消订单失败");
    } finally {
      setCancelSaving(false);
    }
  };

  const handleRestoreOrder = async () => {
    if (!order) return;
    try {
      const updated = await updateOrder(order.id, { restore: true });
      setOrder(updated);
      reload();
    } catch (err) {
      console.error("恢复订单失败:", err);
      setError(err instanceof Error ? err.message : "恢复订单失败");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="animate-pulse space-y-4">
          <div className="h-7 w-48 rounded bg-[var(--muted)]" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="h-96 rounded-xl bg-[var(--muted)]" />
            <div className="h-40 rounded-xl bg-[var(--muted)]" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-[var(--muted-foreground)]">{error}</p>
        <Button variant="ghost" size="sm" className="mt-4" onClick={() => router.back()}>返回订单列表</Button>
      </div>
    );
  }

  if (!order) return null;

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-lg border border-[var(--destructive)] bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] px-4 py-3 text-sm text-[var(--destructive)] flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-3 text-[var(--destructive)] hover:opacity-70 text-lg leading-none">&times;</button>
        </div>
      )}
      {isNativeCommerce && <div className="rounded-lg border border-[var(--border)] p-3 text-sm">
        本单来自同库商城，购买资料与金额固定。此处继续办理、审核资料及记录成本；
        <a className="underline" href={order.commerce_purchase ? "/commerce#" + order.commerce_purchase.sale_id : "/commerce"}>收款请到商城账单</a>。取消审核、账单减免与实际退款也在商城统一处理；此处保留原办理资料。
        {isCommerceCancelled && <p className="mt-2 font-medium">本份服务已批准取消，办理状态已锁定；保留历史进度，仍可补充资料、备注及已发生的成本。</p>}
        <div className="mt-3"><CommerceTermsSummary terms={order.commerce_purchase?.terms}/></div>
      </div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.back()} aria-label="返回订单列表"><ArrowLeft className="size-4" aria-hidden="true" /></Button>
          <div className="flex-1">
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>{order.id}</h1>
            <div className="mt-1 flex items-center gap-2">
              <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", orderStatusClass(order))}>{orderStatusLabel(order)}</span>
              {order.confirmation && <span className="text-xs text-[var(--muted-foreground)]" title={`客户站单号 ${order.confirmation.source_order_no}`}>{order.confirmation.confirmed_by || "员工"} {toThaiTime(order.confirmation.confirmed_at)} 已确认</span>}
              {order.address_type === "xiangtai" && <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] text-[var(--primary)]">湘泰地址</span>}
              {order.address_type === "client" && order.business_type_id === 7 && <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-[color-mix(in_oklch,var(--info),var(--background)_88%)] text-[var(--info)]">客户地址</span>}
              <span className="text-xs text-[var(--muted-foreground)]">{formatCurrency(order.total_amount, order.currency)}</span>
              <span className="text-xs text-[var(--muted-foreground)]">· {steps.filter(s => isStepClosed(s.status)).length}/{steps.length} 已完成</span>
              {/* 客户网站来的单先确认，确认后才出「开始任务」（2026-10-19） */}
              {order.awaiting_confirmation && !isClient && (
                <button onClick={handleConfirmOrder} disabled={confirming} className="rounded border border-[color-mix(in_oklch,var(--success),var(--background)_55%)] bg-[var(--success)] px-3 py-1 text-xs font-medium text-[var(--success-foreground)] hover:bg-[color-mix(in_oklch,var(--success),var(--foreground)_15%)] disabled:opacity-60 transition-colors">{confirming ? "确认中…" : "确认订单"}</button>
              )}
              {/* 任务级"开始"按钮：仅第一步待处理时显示 */}
              {steps.length > 0 && steps[0].status === "待处理" && !isClient && !isCommerceCancelled && !order.awaiting_confirmation && (
                <button onClick={() => handleStepUpdate(steps[0].id, "进行中")} className="rounded border border-[color-mix(in_oklch,var(--primary),var(--background)_60%)] bg-[color-mix(in_oklch,var(--primary),var(--background)_90%)] px-3 py-1 text-xs font-medium text-[var(--primary)] hover:bg-[color-mix(in_oklch,var(--primary),var(--background)_82%)] transition-colors">开始任务</button>
              )}
            </div>
          </div>
          {!isClient && !isNativeCommerce && (
            <div className="flex items-center gap-2 shrink-0">
              {!editingOrder ? (
                <>
                  <Button variant="outline" size="sm" onClick={startEdit} className="gap-1.5"><Edit3 className="size-3.5" />编辑</Button>
                  {/* 客户站、商城来的单只有管理员能取消、恢复（接口原来就这么拦），员工这边不显示按钮 */}
                  {order.source_system && user?.role !== "admin" ? (
                    <span className="text-xs text-[var(--muted-foreground)]">客户站来的单只有管理员能取消</span>
                  ) : order.status === "客户取消" ? (
                    <Button variant="outline" size="sm" onClick={handleRestoreOrder} className="gap-1.5 text-[var(--success)] border-[var(--success)]/30 hover:bg-[var(--success)]/10"><Undo2 className="size-3.5" />恢复</Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => { setShowCancelModal(true); setCancelReason(""); setCancelError(""); setError(""); }} className="gap-1.5 text-[var(--warning)] border-[var(--warning)]/30 hover:bg-[var(--warning)]/10"><Ban className="size-3.5" />取消订单</Button>
                  )}
                  {/* 10-16 老板定：只有管理员能删订单，员工只能取消 */}
                  {user?.role === "admin" && <Button variant="outline" size="sm" onClick={() => setDeleteTarget({id:order.id, name:order.customer_name})} className="gap-1.5 text-[var(--destructive)] border-[var(--destructive)]/30 hover:bg-[var(--destructive)]/10"><Trash2 className="size-3.5" />删除</Button>}
                </>
              ) : (
                <>
                  <Button variant="default" size="sm" onClick={handleSaveOrder} disabled={savingOrder} className="gap-1.5"><Save className="size-3.5" />{savingOrder ? "保存中..." : "保存"}</Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingOrder(false)} disabled={savingOrder} className="gap-1.5"><X className="size-3.5" />取消</Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {!isClient && cancelRequests.length > 0 && (() => {
        const pending = cancelRequests.filter(r => r.status === "pending");
        const decided = cancelRequests.filter(r => r.status !== "pending");
        return (
          <section aria-label="客户取消申请" className={cn("rounded-xl border p-4", pending.length ? "border-[var(--warning)]/40 bg-[color-mix(in_oklch,var(--warning),var(--background)_92%)]" : "border-[var(--border)] bg-[var(--card)]")}>
            <h3 className="text-sm font-medium text-[var(--foreground)]">{pending.length ? "客户在客户网站申请取消这项服务" : "客户取消申请记录"}</h3>
            {pending.map(r => (
              <div key={r.id} className="mt-2 text-sm">
                <p className="text-[var(--foreground)] break-words">原因：{r.reason}</p>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">第 {r.line_no} 项服务第 {r.copy_no} 份 · 申请于 {toThaiTime(r.created_at)} · 处理前照常办理，不自动退款</p>
                {order.status === "已完成" && <p className="mt-1 text-xs font-medium text-[var(--destructive)]">注意：这张单已经办理完成，同意取消会把「已完成」改成「客户取消」。</p>}
                {user?.role === "admin" ? (
                  cancelReqAction?.id === r.id ? (
                    <div className="mt-2 space-y-2">
                      {cancelReqAction.mode === "approve"
                        ? <p className="text-xs text-[var(--foreground)]">同意后这张单{order.status === "已完成" ? "由「已完成」" : ""}变为「客户取消」，步骤原样保留，结果自动告知客户；退款另行处理。</p>
                        : <input autoFocus placeholder="不同意的原因（客户能看到）" value={cancelReqNote} onChange={(e) => { setCancelReqNote(e.target.value); setCancelReqError(""); }} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={handleDecideCancelRequest} disabled={decidingCancelReq} className={cancelReqAction.mode === "approve" ? "bg-[var(--warning)] text-[var(--warning-foreground)]" : ""}>{decidingCancelReq ? "处理中…" : cancelReqAction.mode === "approve" ? "确认同意取消" : "确认不同意"}</Button>
                        <Button variant="outline" size="sm" onClick={() => { setCancelReqAction(null); setCancelReqNote(""); setCancelReqError(""); }} disabled={decidingCancelReq}>返回</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setCancelReqAction({ id: r.id, mode: "approve" }); setCancelReqNote(""); setCancelReqError(""); }} className="text-[var(--warning)] border-[var(--warning)]/30 hover:bg-[var(--warning)]/10">同意取消</Button>
                      <Button size="sm" variant="outline" onClick={() => { setCancelReqAction({ id: r.id, mode: "reject" }); setCancelReqNote(""); setCancelReqError(""); }}>不同意</Button>
                    </div>
                  )
                ) : <p className="mt-1 text-xs text-[var(--warning)]">等管理员处理</p>}
              </div>
            ))}
            {cancelReqError && <p className="mt-2 text-xs text-[var(--destructive)]">{cancelReqError}</p>}
            {decided.length > 0 && (
              <ul className={cn("flex flex-col gap-1 text-xs text-[var(--muted-foreground)]", pending.length ? "mt-3 border-t border-[var(--border)] pt-2" : "mt-2")}>
                {decided.map(r => (
                  <li key={r.id} className="break-words">
                    {toThaiTime(r.created_at)} 申请（{r.reason}）→ <span className={r.status === "approved" ? "text-[var(--foreground)]" : ""}>{r.status === "approved" ? "已同意取消" : "未同意"}</span>{r.decision_note && `：${r.decision_note}`}{r.decided_by && ` · ${r.decided_by}`}{r.decided_at && ` ${toThaiTime(r.decided_at)}`}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })()}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Basic info */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">基本信息</h3>
            {editingOrder ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">客户名</label>
                  {order.source_system ? (
                    <input type="text" value={editFields.customer_name || ""} onChange={(e) => setEditFields(prev => ({ ...prev, customer_name: e.target.value }))} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
                  ) : (
                    <div className="mt-1">
                      <CustomerPicker value={editFields.customer_name || ""} isNew={editNewCustomer} pool={customerPool} canCreate={user?.role === "admin"} keep={order.customer_name}
                        className="h-9" onChange={(name, isNew) => { setEditFields(prev => ({ ...prev, customer_name: name })); setEditNewCustomer(isNew); }} />
                    </div>
                  )}
                </div>
                {order.business_type_id === 2 && (
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">商标名称</label>
                  <input type="text" value={editFields.trademark_name || ""} onChange={(e) => setEditFields(prev => ({ ...prev, trademark_name: e.target.value }))} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
                </div>
                )}
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">业务线</label>
                  <select value={editFields.business_type_id || ""} onChange={(e) => {
                    const businessTypeId = Number(e.target.value);
                    setEditFields(prev => {
                      if (order.sub_service_type !== UNCLASSIFIED_SUB) return { ...prev, business_type_id: businessTypeId };
                      // 待分类单换业务线：具体服务要重新选；换回待分类则保持原样
                      const backToUnclassified = businessTypes.find(b => b.id === businessTypeId)?.name === "待分类";
                      return { ...prev, business_type_id: businessTypeId, sub_service_type: backToUnclassified ? UNCLASSIFIED_SUB : "", address_type: "client" };
                    });
                  }} disabled={order.sub_service_type !== UNCLASSIFIED_SUB && steps.length > 0} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] disabled:opacity-60">
                    {businessTypes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  {/* 建单后改业务线步骤不会跟着换（2026-10-15）；待分类单走上面的改派 */}
                  {order.sub_service_type !== UNCLASSIFIED_SUB && steps.length > 0 && <p className="mt-1 text-[0.65rem] text-[var(--muted-foreground)]">建单后不能改业务线，建错了请取消这张单重新建</p>}
                </div>
                {(() => {
                  const target = order.sub_service_type === UNCLASSIFIED_SUB
                    ? businessTypes.find(b => b.id === Number(editFields.business_type_id) && b.name !== "待分类") : undefined;
                  if (!target) return null;
                  const options = subServices[target.id] || [];
                  return (
                    <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2 rounded-md border border-[var(--border)] bg-[var(--secondary)] p-3">
                      {options.length > 0 && (
                        <div>
                          <label className="text-xs text-[var(--muted-foreground)]">具体服务</label>
                          <select value={editFields.sub_service_type || ""} onChange={(e) => setEditFields(prev => ({ ...prev, sub_service_type: e.target.value }))} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]">
                            <option value="">请选择</option>
                            {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                          </select>
                        </div>
                      )}
                      {target.name === "地址认证" && (
                        <div>
                          <label className="text-xs text-[var(--muted-foreground)]">地址类型</label>
                          <select value={editFields.address_type || "client"} onChange={(e) => setEditFields(prev => ({ ...prev, address_type: e.target.value }))} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]">
                            <option value="client">客户地址</option>
                            <option value="xiangtai">湘泰地址（加签租赁合同、收首月租金两步）</option>
                          </select>
                        </div>
                      )}
                      <p className="sm:col-span-2 text-xs text-[var(--muted-foreground)]">改派后换成「{target.name}」的整套办理流程，已做的「方案确认」和写过的备注都保留。改派只能做一次。</p>
                    </div>
                  );
                })()}
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">负责人</label>
                  {/* 原来是手打的文本框，打错一个字就对不上人（「我的环节」、月报都按名字认）；改成从员工里选（2026-10-16） */}
                  <select value={editFields.responsible_person || ""} onChange={(e) => setEditFields(prev => ({ ...prev, responsible_person: e.target.value }))} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]">
                    <option value="">还没人负责</option>
                    {/* 老单上手打的名字、几个人写在一起、已离职的人不在员工列表里：保留原值可选，不会被改掉 */}
                    {(editFields.responsible_person || "").trim() && !employees.some(emp => emp.role !== "client" && emp.name === editFields.responsible_person) && (
                      <option value={editFields.responsible_person || ""}>{editFields.responsible_person}（原来填的）</option>
                    )}
                    {employees.filter(emp => emp.role !== "client").map(emp => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">金额</label>
                  <div className="mt-1 flex gap-2">
                    <input type="number" value={editFields.total_amount || 0} onChange={(e) => setEditFields(prev => ({ ...prev, total_amount: Number(e.target.value) }))} className="flex-1 h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
                    <select value={editFields.currency || "CNY"} onChange={(e) => setEditFields(prev => ({ ...prev, currency: e.target.value }))} className="h-9 w-20 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]">
                      <option value="CNY">¥ 人民币</option>
                      <option value="THB">฿ 泰铢</option>
                    </select>
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-[var(--muted-foreground)]">描述</label>
                  <textarea value={editFields.description || ""} onChange={(e) => setEditFields(prev => ({ ...prev, description: e.target.value }))} rows={2} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] resize-none" />
                </div>
              </div>
            ) : (
              <dl className="grid gap-4 sm:grid-cols-2">
                <div><dt className="text-xs text-[var(--muted-foreground)]">客户</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{order.customer_name}</dd></div>
                {order.business_type_id === 2 && order.trademark_name && <div><dt className="text-xs text-[var(--muted-foreground)]">商标名称</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{order.trademark_name}</dd></div>}
                <div><dt className="text-xs text-[var(--muted-foreground)]">负责人</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{order.responsible_person || "—"}</dd></div>
                <div><dt className="text-xs text-[var(--muted-foreground)]">金额</dt><dd className="mt-1 text-sm font-mono text-[var(--foreground)]">{formatCurrency(order.total_amount, order.currency)}</dd></div>
                <div><dt className="text-xs text-[var(--muted-foreground)]">创建日期</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{toThaiTime(order.created_at)}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs text-[var(--muted-foreground)]">描述</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{order.description || "—"}</dd></div>
              </dl>
            )}
          </div>

          {/* Progress steps with notes + required docs */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">进度追踪</h3>
            {order.awaiting_confirmation && !isClient && (
              <p role="status" className="mb-4 rounded-md border border-[color-mix(in_oklch,var(--warning),var(--background)_60%)] bg-[color-mix(in_oklch,var(--warning),var(--background)_90%)] px-3 py-2 text-xs text-[var(--foreground)]">
                这张单是客户在客户网站下的，还没确认。先核对是不是真实客户，再点上面的「确认订单」，确认后才能开始办理、发补件和给客户文件。不想接的单不要确认，由管理员取消。
              </p>
            )}
            {steps.length > 0 && (
              <div className="mb-5 flex items-center gap-3">
                <span className="text-xs text-[var(--muted-foreground)] shrink-0">已完成 {steps.filter(s => isStepClosed(s.status)).length}/{steps.length}{steps.some(s => s.status === "已跳过") ? `（其中跳过 ${steps.filter(s => s.status === "已跳过").length}）` : ""}</span>
                <div className="flex-1 h-2 rounded-full bg-[var(--muted)] overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all duration-300", steps.filter(s => isStepClosed(s.status)).length === steps.length ? "bg-[var(--success)]" : "bg-[var(--success)]")} style={{ width: `${Math.round(steps.filter(s => isStepClosed(s.status)).length / steps.length * 100)}%` }} />
                </div>
                <span className="text-xs font-medium shrink-0 text-[var(--muted-foreground)]">{steps.filter(s => isStepClosed(s.status)).length === steps.length ? "全部完成" : `${Math.round(steps.filter(s => isStepClosed(s.status)).length / steps.length * 100)}%`}</span>
              </div>
            )}
            {/* 客户评价链接 */}
            {steps.length > 0 && steps.filter(s => isStepClosed(s.status)).length === steps.length && (
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
            {(() => {
              // 收款只算老板核对过「已到账」的收入；待核对、未到账单独列出，不算已收（2026-10-15）
              const incomes = finances.filter(f => f.type === "income" && !f.commerce_refund);
              if (incomes.length === 0) return <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">收款：还没记收入</p>;
              const cur = order.currency || "CNY";
              const sumOf = (list: Finance[]) => list.reduce((n, f) => n + Number(f.amount || 0), 0);
              const arrivedRows = incomes.filter(f => f.status === "paid");
              const arrived = sumOf(arrivedRows.filter(f => (f.currency || "CNY") === cur));
              const otherCur = cur === "CNY" ? "THB" : "CNY";
              const arrivedOther = sumOf(arrivedRows.filter(f => (f.currency || "CNY") === otherCur));
              const waiting = incomes.filter(f => f.status === "待核对" || f.status === "pending").length;
              const missing = incomes.filter(f => f.status === "未到账").length;
              const due = Number(order.total_amount) || 0;
              const short = due > 0 ? Math.max(0, Math.round((due - arrived) * 100) / 100) : 0;
              const parts = [`已到账 ${formatCurrency(arrived, cur)}`];
              if (arrivedOther > 0) parts.push(`另有 ${formatCurrency(arrivedOther, otherCur)}`);
              // 商城单可能有减免，订单金额是原价：收没收够以商城账单为准，这里不比（2026-10-15）
              if (due > 0 && !isNativeCommerce) parts.push(short > 0 ? `订单 ${formatCurrency(due, cur)}，还差 ${formatCurrency(short, cur)}` : `订单 ${formatCurrency(due, cur)}，已收够`);
              if (waiting) parts.push(`${waiting} 笔待核对`);
              if (missing) parts.push(`${missing} 笔未到账`);
              const ok = (due === 0 || short === 0 || isNativeCommerce) && !waiting && !missing;
              return <p className={cn("mt-1.5 text-xs", ok ? "text-[var(--success)]" : "text-[var(--warning)]")}>收款：{parts.join("，")}</p>;
            })()}
            {/* 客户站来的单：客户站单号和客户站账单付没付（跟订单列表一致；钱到没到账还是以上面核对过的为准） */}
            {!isClient && order.source_order_no && (
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">客户站单号 {order.source_order_no}{order.client_billing ? ` · 客户站账单：${order.client_billing === "paid" ? "已付" : "未付"}` : ""}</p>
            )}
            {/* 人员耗时汇总 — see personHours computed above */}
            {personEntries.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {personEntries.map(([name, hours]) => (
                  <span key={name} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--muted)]/40 px-2.5 py-1 text-xs">
                    <span className="font-medium text-[var(--foreground)]">{name}</span>
                    <span className="text-[var(--muted-foreground)]">累计 {formatWorkSeconds(hours)}</span>
                  </span>
                ))}
              </div>
            )}
            {steps.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">暂无步骤</p>
            ) : (
              <div className="flex flex-col gap-0">
                {steps.map((step, i) => {
                  const hasPlanConfirm = steps.find(s => s.step_order === 1)?.step_name === "方案确认";
                  // 老单可能没有方案确认，待分类改派单会保留归属步骤，均不占用业务步骤的文案序号。
                  const classificationName = "确认归属并派单（客户站同步单，未匹配业务线）";
                  const companyCopyIndex = step.step_order - (hasPlanConfirm ? 1 : 0)
                    - steps.filter(s => s.step_order < step.step_order && s.step_name === classificationName).length;
                  const companyStepCopy = order.business_type_id === 1 && order.sub_service_type !== "change"
                    && order.sub_service_type !== UNCLASSIFIED_SUB && step.step_name !== classificationName
                    ? COMPANY_REGISTRATION_STEP_COPY[companyCopyIndex] : undefined;
                  const fdaStepCopy = order.business_type_id === 3 && step.step_name !== classificationName
                    ? FDA_STEP_COPY[order.sub_service_type || ""]?.[companyCopyIndex] : undefined;
                  const tisiStepCopy = order.business_type_id === 4 && order.sub_service_type !== UNCLASSIFIED_SUB
                    && step.step_name !== classificationName ? TISI_STEP_COPY[companyCopyIndex] : undefined;
                  const addressStepCopy = order.business_type_id === 7 && order.sub_service_type !== UNCLASSIFIED_SUB
                    && step.step_name !== classificationName
                    ? (order.address_type === "xiangtai" ? XIANGTAI_ADDRESS_STEP_COPY
                      : !order.address_type || order.address_type === "client" ? CUSTOMER_ADDRESS_STEP_COPY : undefined)?.[companyCopyIndex]
                    : undefined;
                  const businessStepCopy = order.business_type_id === 10 ? WORK_VISA_STEP_COPY
                    : order.business_type_id === 11 ? SOCIAL_SECURITY_STEP_COPY
                    : order.business_type_id === 2 && (order.sub_service_type === "tm-reg" || !order.sub_service_type)
                      ? TM_REGISTRATION_STEP_COPY
                    : order.business_type_id === 2 && order.sub_service_type === "international"
                      ? INTERNATIONAL_TRADEMARK_STEP_COPY
                    : order.business_type_id === 2 && order.sub_service_type === "buy-r"
                      ? BUY_R_TRADEMARK_STEP_COPY : undefined;
                  const stepCopy = addressStepCopy ?? tisiStepCopy ?? fdaStepCopy ?? companyStepCopy ?? (businessStepCopy && order.sub_service_type !== UNCLASSIFIED_SUB
                    && step.step_name !== classificationName && !(hasPlanConfirm && step.step_order === 1)
                    ? businessStepCopy[companyCopyIndex - 1] : undefined);
                  // 按流程设置建的单（带版本号）资料以库里为准，没有就是真没有，不回退程序里的清单（2026-10-16）
                  const orderHasStepDocs = Object.values(stepDocs).some(list => (list || []).length > 0) || steps.some(s => s.template_version_id != null);
                  const notes = stepNotes[step.id] || [];
                  const sd = stepDocs[step.id] || [];
                  const uploadedCount = sd.filter((d: { status?: string; uploaded?: boolean }) => d.status === "uploaded").length;
                  const docs = getStepDocs(order.business_type_id, order.sub_service_type);
                  // 模板资料按「基础步骤序号」存。只有整单都没有资料记录的老单才回退到模板（7 月中起建单就把资料写进数据库了，
                  // 新单某步没资料就是真的没有，不能再去模板里拿别的步骤的）。
                  // 9-11 起的单第一步是「方案确认」，序号要减 1 才对得上；湘泰地址另插的两步：老单在第 4、5 步，有方案确认的单在第 5、6 步。
                  const isXiangtai = order.business_type_id === 7 && order.address_type === "xiangtai";
                  const ownOrder = step.step_order - (hasPlanConfirm ? 1 : 0);
                  const baseOrder = orderHasStepDocs || (hasPlanConfirm && step.step_order === 1)
                    ? -1
                    : isXiangtai
                      ? (ownOrder === 4 || ownOrder === 5 ? -1 : ownOrder > 5 ? ownOrder - 2 : ownOrder)
                      : ownOrder;
                  const expanded = expandedSteps[step.id] || false;
                  const hasDocs = !!(docs[baseOrder]?.length);
                  const hasNotes = notes.length > 0;
                  const stepData = (() => { try { return JSON.parse(step.step_data || "{}"); } catch { return {}; } })();
                  const logistics = stepData.logistics as { step: string; status: string; note?: string }[] | undefined;

                  return (
                    <div key={step.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                          step.status === "已完成" && "bg-[var(--success)] text-[var(--success-foreground)]",
                          step.status === "进行中" && "bg-[var(--primary)] text-[var(--primary-foreground)] ring-2 ring-[var(--ring)]/30",
                          step.status === "阻塞" && "bg-[var(--destructive)] text-[var(--destructive-foreground)]",
                          (step.status === "待处理" || step.status === "已跳过") && "bg-[var(--muted)] text-[var(--muted-foreground)]"
                        )}>{step.status === "已完成" ? "✓" : step.status === "已跳过" ? "–" : step.step_order}</div>
                        {i < steps.length - 1 && <div className={cn("w-px flex-1 min-h-[20px]", isStepClosed(step.status) ? "bg-[var(--success)]" : "bg-[var(--border)]")} />}
                      </div>
                      <div className="pb-5 flex-1">
                        {step.step_order === 9 && logistics && logistics.length > 0 && (
                          <div className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-2">
                            <p className="mb-1 text-xs font-medium text-[var(--foreground)]">样品物流追踪</p>
                            <div className="flex flex-col gap-0.5">
                              {logistics.map((l, li) => (
                                <div key={li} className="flex items-center gap-1.5 text-xs">
                                  <span className={cn("size-1.5 shrink-0 rounded-full", l.status === "completed" ? "bg-[var(--success)]" : l.status === "active" ? "bg-[var(--info)] animate-pulse" : "bg-[var(--muted-foreground)]")} />
                                  <span className={l.status === "completed" ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}>{l.step}</span>
                                  {l.note && <span className="text-[var(--muted-foreground)]">— {l.note}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {stepData.hs_code && (
                          <div className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-2">
                            <p className="text-xs text-[var(--muted-foreground)]">HS码: <strong className="font-mono text-[var(--foreground)]">{stepData.hs_code}</strong></p>
                          </div>
                        )}
                        {stepData.external_check && (
                          <div className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-2">
                            <p className="text-xs text-[var(--muted-foreground)]">外部确认: <strong className="text-[var(--foreground)]">{stepData.external_check.name}</strong> — {stepData.external_check.result} ({stepData.external_check.date})</p>
                          </div>
                        )}
                        {stepData.contact_next && (
                          <div className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-2">
                            <p className="text-xs text-[var(--muted-foreground)]">清关协调: <strong className="text-[var(--foreground)]">{stepData.contact_next.name}</strong> ({stepData.contact_next.role}) — {stepData.contact_next.contact}</p>
                          </div>
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-[var(--foreground)]">{step.step_name}</p>
                          <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", stepStatusClass[step.status])}>{step.status}</span>
                          {step.approval_status && (
                            <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                              step.approval_status === "已通过" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]" :
                              step.approval_status === "需修改" ? "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[var(--destructive)]" :
                              "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]"
                            )}>{step.approval_status}</span>
                          )}
                          {step.assignee && (
                            isClient ? (
                              <span className="text-xs text-[var(--muted-foreground)]">{step.assignee}</span>
                            ) : editingAssigneeStepId !== step.id ? (
                              <button onClick={() => setEditingAssigneeStepId(step.id)} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:underline cursor-pointer">
                                {step.assignee}
                              </button>
                            ) : null
                          )}
                          {/* 模板没预设经办人的步骤（如「等待官方审核」「拿证」）原来没有入口指派，这里补上 */}
                          {!step.assignee && !isClient && !isStepClosed(step.status) && editingAssigneeStepId !== step.id && (
                            <>
                              {/* 没写经办人的步骤算这张单负责人的，会出现在负责人的「我的环节」里（2026-10-15） */}
                              {(order.responsible_person || "").trim() && <span className="text-xs text-[var(--muted-foreground)]" title="这一步没写经办人，算这张单负责人的">负责人：{order.responsible_person}</span>}
                              <button onClick={() => setEditingAssigneeStepId(step.id)} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:underline cursor-pointer">
                                + 指派经办人
                              </button>
                            </>
                          )}
                          {editingAssigneeStepId === step.id && (
                            <select
                              value={step.assignee}
                              onChange={async (e) => {
                                const newAssignee = e.target.value;
                                if (!newAssignee || newAssignee === step.assignee) { setEditingAssigneeStepId(null); return; }
                                try {
                                  await updateStep(id, step.id, { assignee: newAssignee });
                                  setEditingAssigneeStepId(null);
                                  reload();
                                } catch { /* ignore */ }
                              }}
                              onBlur={() => setEditingAssigneeStepId(null)}
                              autoFocus
                              className="rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-xs outline-none focus:border-[var(--ring)]"
                            >
                              {!step.assignee && <option value="" disabled>选择经办人</option>}
                              {/* 合作方（如 Next）、离职员工不在下拉里：放一个占位项，否则受控下拉会把第一个人显示成已选、选不中 */}
                              {step.assignee && !employees.some(emp => emp.role !== "client" && emp.name === step.assignee) && <option value={step.assignee} disabled>{step.assignee}</option>}
                              {employees.filter(emp => emp.role !== "client").map(emp => (
                                <option key={emp.id} value={emp.name}>{emp.name}</option>
                              ))}
                            </select>
                          )}
                          {sd.length > 0 && (
                            <span className={cn("text-xs", uploadedCount === sd.length ? "text-[var(--success)]" : "text-[var(--warning)]")}>文件 {uploadedCount}/{sd.length}</span>
                          )}

                          {step.submission_count > 0 && (
                            <span className="text-xs font-medium text-[var(--info)]">提交 {step.submission_count}/2 · 剩{2 - step.submission_count}次</span>
                          )}
                        </div>
                        {stepCopy && (
                          <div className="mt-1 min-w-0 space-y-1 break-words text-xs leading-5 text-[var(--muted-foreground)] max-sm:max-w-[calc(100vw-7.5rem)]">
                            <p className="font-medium text-[var(--foreground)]">{stepCopy.title}</p>
                            <p>{stepCopy.description}</p>
                          </div>
                        )}
                        {!isCommerceCancelled && !isStepClosed(step.status) && step.status !== "阻塞" && (
                          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                            {confirmingStepId === step.id ? (
                              <>
                                <input
                                  value={newNotes[step.id] || ""}
                                  onChange={(e) => { setNewNotes((p) => ({ ...p, [step.id]: e.target.value })); setNoteErrorMsg(prev => ({ ...prev, [step.id]: "" })); }}
                                  onKeyDown={(e) => { if (e.key === "Enter") handleConfirmComplete(step.id); if (e.key === "Escape") setConfirmingStepId(null); }}
                                  placeholder="完成备注（可选）..."
                                  className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)] w-40"
                                  autoFocus
                                />
                                <button onClick={() => handleConfirmComplete(step.id)} className="rounded px-2 py-0.5 text-xs bg-[var(--success)] text-[var(--success-foreground)] hover:bg-[color-mix(in_oklch,var(--success),var(--foreground)_20%)] transition-colors">确认完成</button>
                                <button onClick={() => { setConfirmingStepId(null); setNewNotes((p) => ({ ...p, [step.id]: "" })); }} className="rounded px-2 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">取消</button>
                                {/* 缺文件只提醒、不拦（有的文件是线下交的，2026-10-16） */}
                                {sd.some(d => d.status !== "uploaded") && (
                                  <span className="w-full text-xs text-[var(--warning)]">还有 {sd.filter(d => d.status !== "uploaded").length} 份文件没上传：{sd.filter(d => d.status !== "uploaded").map(d => d.document_name).join("、")}。确定这一步做完了再点完成。</span>
                                )}
                              </>
                            ) : (
                              <>
                                {(() => {
                                  // 公司注册那套各步互不阻塞；其他（含公司变更）要前面所有步骤都办完或跳过（2026-10-16 统一口径）
                                  const parallel = !!order && isParallelFlow(order.business_type_id, order.sub_service_type);
                                  const canComplete = parallel || steps.every(s => s.step_order >= step.step_order || isStepClosed(s.status));
                                  return canComplete ? (
                                    <button onClick={() => setConfirmingStepId(step.id)} className="rounded border border-[color-mix(in_oklch,var(--success),var(--background)_70%)] bg-[color-mix(in_oklch,var(--success),var(--background)_92%)] px-2 py-1 text-xs text-[var(--success)] hover:bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] transition-colors">标记完成</button>
                                  ) : (
                                    <span className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] opacity-50 cursor-not-allowed select-none">需先完成前一步</span>
                                  );
                                })()}
                                {reasonFor?.stepId === step.id ? (
                                  <>
                                    <input value={reasonText} onChange={(e) => setReasonText(e.target.value)} maxLength={200} autoFocus
                                      onKeyDown={(e) => { if (e.key === "Enter") handleReasonSubmit(); if (e.key === "Escape") { setReasonFor(null); setReasonText(""); } }}
                                      placeholder={reasonFor.kind === "已跳过" ? "为什么不用办这一步…" : "为什么卡住（等谁、缺什么）…"}
                                      className="w-48 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                                    <button onClick={handleReasonSubmit} className="rounded px-2 py-0.5 text-xs bg-[var(--primary)] text-[var(--primary-foreground)]">{reasonFor.kind === "已跳过" ? "确认跳过" : "确认卡住"}</button>
                                    <button onClick={() => { setReasonFor(null); setReasonText(""); }} className="rounded px-2 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)]">取消</button>
                                  </>
                                ) : (
                                  <>
                                    <button onClick={() => { setReasonFor({ stepId: step.id, kind: "阻塞" }); setReasonText(""); }} className="rounded border border-[color-mix(in_oklch,var(--destructive),var(--background)_70%)] bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] px-2 py-1 text-xs text-[var(--destructive)] hover:bg-[color-mix(in_oklch,var(--destructive),var(--background)_85%)] transition-colors">标记阻塞</button>
                                    {/* 用不上的步骤（如「如需补资料」）跳过，不用假装点完成；第一步、最后一步不能跳 */}
                                    {!isClient && step.step_order !== steps[0]?.step_order && step.step_order !== steps[steps.length - 1]?.step_order
                                      && ((!!order && isParallelFlow(order.business_type_id, order.sub_service_type)) || steps.every(s => s.step_order >= step.step_order || isStepClosed(s.status))) && (
                                      <button onClick={() => { setReasonFor({ stepId: step.id, kind: "已跳过" }); setReasonText(""); }} className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors" title="这一步这张单用不上">跳过</button>
                                    )}
                                  </>
                                )}
                                {sd.length > 0 && (
                                  <span className={cn("text-xs", uploadedCount === sd.length ? "text-[var(--success)]" : "text-[var(--warning)]")}>文件 {uploadedCount}/{sd.length}</span>
                                )}
                              </>
                            )}
                            <StepTimer created_at={step.created_at} completed_at={step.completed_at} status={step.status} prev_completed_at={i > 0 ? steps[i-1].completed_at : null} started_at={step.started_at} className="ml-1" />
                          </div>
                        )}
                        {(isStepClosed(step.status) || step.status === "阻塞") && (
                          <div className="mt-1 flex items-center gap-2">
                            {step.status === "已完成" && step.completed_at && (
                              <div className="flex items-center gap-3">
                                <StepTimer created_at={step.created_at} completed_at={step.completed_at} status="已完成" prev_completed_at={i > 0 ? steps[i-1].completed_at : null} started_at={step.started_at} />
                              </div>
                            )}
                            {!isClient && !isCommerceCancelled && (
                              <button onClick={() => handleRollback(step.id)} className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
                                <Undo2 className="size-3" />撤回
                              </button>
                            )}
                          </div>
                        )}

                        {/* Step file upload */}
                        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                          <label className={cn(
                            "shrink-0 cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors inline-flex items-center gap-1",
                            stepUploading[step.id] && "opacity-50 pointer-events-none"
                          )}>
                            <Upload className="size-3" />
                            {stepUploading[step.id] ? stepFileNames[step.id] || "上传中..." : "附件"}
                            <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx" onChange={async e => {
                              const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
                              const stepId = step.id;
                              setStepUploading(p => ({ ...p, [stepId]: true }));
                              setStepFileNames(p => ({ ...p, [stepId]: file.name }));
                              setStepUploadErrors(p => ({ ...p, [stepId]: "" }));
                              try {
                                const fd = new FormData(); fd.append("file", file);
                                const ur = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
                                if (!ur.ok) throw new Error("上传失败");
                                const { url } = await ur.json();
                                const note = "上传文件: " + file.name + " (" + url + ")";
                                const nr = await fetchWithAuth("/api/orders/" + id + "/steps/" + stepId + "/notes", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ content: note }),
                                });
                                if (!nr.ok) throw new Error("保存失败");
                                setStepUploadErrors(p => ({ ...p, [stepId]: "" }));
                                reload();
                              } catch (err) {
                                const msg = err instanceof Error ? err.message : String(err);
                                console.error("[订单步骤附件上传失败]", { stepId, fileName: file.name, error: msg });
                                setStepUploadErrors(p => ({ ...p, [stepId]: msg }));
                                setError(msg);
                              } finally {
                                setStepUploading(p => ({ ...p, [stepId]: false }));
                                setStepFileNames(p => ({ ...p, [stepId]: "" }));
                              }
                            }} />
                          </label>
                          {stepUploadErrors[step.id] && (
                            <span className="text-xs text-[var(--destructive)]">{stepUploadErrors[step.id]}</span>
                          )}
                        </div>

                        {/* Expand/collapse for notes + docs */}
                        <button onClick={() => toggleExpand(step.id)} className="mt-1 flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
                          <MessageSquare className="size-3" />
                          {hasNotes && <span className="rounded-full bg-[var(--muted)] px-1.5 text-[0.65rem]">{notes.length}</span>}
                          {expanded ? "收起" : "备注 & 所需文件"}
                        </button>

                        {expanded && (
                          <div className="mt-3 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                            {/* 步骤说明（模板备注） */}
                            {(step.notes || "") && (() => { const isWarning = (step.notes||"").startsWith("⚠️"); return (
                              <div className={isWarning ? "rounded-md border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-800 dark:bg-amber-950/30" : "rounded-md border border-[var(--border)] bg-[var(--muted)]/50 p-2.5"}>
                                <div className="flex items-start gap-1.5">
                                  <span className="shrink-0 text-sm">{isWarning ? "⚠️" : "📋"}</span>
                                  <p className={"text-xs leading-relaxed "+(isWarning ? "text-amber-800 dark:text-amber-200 font-medium" : "text-[var(--foreground)]")}>{(step.notes||"").replace(/^[⚠️📋]\s*/,"")}</p>
                                </div>
                              </div>
                            ); })()}
                            {/* Notes */}
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
                                        {!isClient && (
                                          <button onClick={() => setDeleteNoteTarget({stepId: step.id, noteId: n.id, content: n.content})} className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] transition-colors" title="删除备注"><Trash2 className="size-3" /></button>
                                        )}
                                      </div>
                                      <p className="mt-0.5 text-[0.65rem] text-[var(--muted-foreground)]">{n.created_by} · {toThaiTime(n.created_at)}</p>
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

                            {/* Required documents：优先用数据库里该步骤的清单（新订单创建时生成），老订单回退到模板配置 */}
                            {(sd.length > 0 || docs[baseOrder]?.length > 0) && (
                              <div className="border-t border-[var(--border)] pt-3">
                                <h4 className="mb-2 text-xs font-medium text-[var(--foreground)]">所需文件</h4>
                                <ul className="space-y-1">
                                  {(sd.length > 0 ? sd.map((d) => d.document_name) : docs[baseOrder]).map((docName, di) => {
                                    const existingDoc = sd.find((d) => d.document_name === docName);
                                    const isUploaded = existingDoc?.status === "uploaded";
                                    return (
                                      <li key={di} className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-[var(--muted)]">
                                        <div className="flex items-center gap-1.5">
                                          {isUploaded ? <CheckCircle2 className="size-3 text-[var(--success)]" /> : <Circle className="size-3 text-[var(--muted-foreground)]" />}
                                          <span className={isUploaded ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}>{docName}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                          {notes.filter(n => n.content.startsWith(`上传文件: 【${docName}】`)).map(n => {
                                            const m = n.content.match(/上传文件:\s*【[^】]*】(.+?)\s*\(\/api\/files\/([^)]+)\)/);
                                            return m ? <a key={n.id} href={"/api/files/" + m[2] + "?token=" + (getStoredAuthToken() || "")} target="_blank" rel="noopener noreferrer" className="max-w-[120px] truncate text-[0.65rem] text-[var(--primary)] hover:underline" title={m[1]}>{m[1]}</a> : null;
                                          })}
                                          {!isClient && existingDoc && (
                                            <label className={cn("cursor-pointer rounded px-1.5 py-0.5 text-[0.65rem] text-[var(--primary)] hover:bg-[var(--muted)]", docUploading[existingDoc.id] && "pointer-events-none opacity-50")} title="上传这份文件，传完自动打勾">
                                              {docUploading[existingDoc.id] ? "上传中…" : isUploaded ? "再传一份" : "上传"}
                                              <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleDocUpload(step.id, existingDoc.id, docName, f); }} />
                                            </label>
                                          )}
                                          {!isClient && !isUploaded && existingDoc && (
                                            <button onClick={() => handleMarkUploaded(step.id, existingDoc.id)} className="rounded px-1.5 py-0.5 text-[0.65rem] text-[var(--success)] hover:bg-[color-mix(in_oklch,var(--success),var(--background)_90%)]" title="文件在线下交了，不用传">标记已上传</button>
                                          )}
                                        </div>
                                      </li>
                                    );
                                  })}
                                </ul>
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
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-4">
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--muted)] p-0.5">
            {!isClient && <button onClick={() => setSidebarTab("finances")} className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors", sidebarTab === "finances" ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)]")}><DollarSign className="mr-1 inline size-3" />费用</button>}
            <button onClick={() => setSidebarTab("docs")} className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors", sidebarTab === "docs" ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)]")}><Paperclip className="mr-1 inline size-3" />文档</button>
          </div>

          {!isClient && sidebarTab === "finances" && (() => {
              const toTHB = (amount: number, cur?: string) => cur === "CNY" ? amount * (exchangeRate || 1) : amount;
              // 收入只把核对过「已到账」的算进收入，待核对单列；支出照旧（2026-10-15）
              const totalIncomeRaw = finances.filter(f => f.type === "income" && f.status === "paid").reduce((s, f) => s + toTHB(f.amount, f.currency), 0);
              const waitingIncomeRaw = finances.filter(f => f.type === "income" && (f.status === "待核对" || f.status === "pending")).reduce((s, f) => s + toTHB(f.amount, f.currency), 0);
              const totalExpenseRaw = finances.filter(f => f.type === "expense" && f.status !== "cancelled").reduce((s, f) => s + toTHB(f.amount, f.currency), 0);
              const pendingPayRaw = finances.filter(f => f.type === "expense" && f.status === "pending").reduce((s, f) => s + toTHB(f.amount, f.currency), 0);
              const totalIncome = Math.round(totalIncomeRaw);
              const waitingIncome = Math.round(waitingIncomeRaw);
              const totalExpense = Math.round(totalExpenseRaw);
              const pendingPay = Math.round(pendingPayRaw);
              return (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              {isNativeCommerce ? <div className="mb-3 space-y-2 text-xs">
                <p>商城收款与成本按原币种分别列示，不自动换汇。</p>
                {["CNY", "THB"].filter(currency => currency === "CNY" || finances.some(f => f.currency === currency)).map(currency => {
                  const rows = finances.filter(f => (f.currency || "CNY") === currency && !f.commerce_refund);
                  const refunded = finances.filter(f=>f.commerce_refund && (f.currency || "CNY")===currency).reduce((n,f)=>n+Number(f.amount),0);
                  const sum = (type: string, status?: string) => rows.filter(f => f.type === type && (status ? f.status === status : f.status !== "cancelled")).reduce((total, f) => total + Math.round(f.amount * 100), 0) / 100;
                  return <div key={currency} className="rounded border border-[var(--border)] p-2">
                    <p>已收款 {formatCurrency(sum("income", "paid"), currency)}</p>
                    <p>已退款 {formatCurrency(refunded, currency)}（单列，不算办理成本）</p>
                    <p>成本合计 {formatCurrency(sum("expense"), currency)}</p>
                    <p>待付成本 {formatCurrency(sum("expense", "pending"), currency)}</p>
                  </div>;
                })}
              </div> : <>
              {/* Exchange rate input */}
              <div className="mb-3 flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5">
                <span className="text-xs text-[var(--muted-foreground)] shrink-0">汇率 1¥ =</span>
                <input type="number" step="0.01" min="0" value={exchangeRate} onChange={(e) => setExchangeRate(Number(e.target.value) || 0)} className="w-16 text-xs font-mono bg-transparent outline-none text-[var(--foreground)]" />
                <span className="text-xs text-[var(--muted-foreground)]">฿</span>
                <span className="text-[0.65rem] text-[var(--muted-foreground)] ml-auto">全部折合泰铢</span>
              </div>
              {finances.length > 0 && (
                <div className="mb-4 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-[color-mix(in_oklch,var(--success),var(--background)_90%)] px-3 py-2 text-center">
                    <p className="text-[0.6rem] text-[var(--success)]">已到账收入</p>
                    <p className="mt-0.5 text-xs font-mono font-medium text-[var(--success)]">฿{totalIncome.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] px-3 py-2 text-center">
                    <p className="text-[0.6rem] text-[var(--warning)]">待核对收入</p>
                    <p className="mt-0.5 text-xs font-mono font-medium text-[var(--warning)]">฿{waitingIncome.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] px-3 py-2 text-center">
                    <p className="text-[0.6rem] text-[var(--destructive)]">总支出</p>
                    <p className="mt-0.5 text-xs font-mono font-medium text-[var(--destructive)]">฿{totalExpense.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] px-3 py-2 text-center">
                    <p className="text-[0.6rem] text-[var(--warning)]">待付支出</p>
                    <p className="mt-0.5 text-xs font-mono font-medium text-[var(--warning)]">฿{pendingPay.toLocaleString()}</p>
                  </div>
                </div>
              )}
              </>}
              {finances.length === 0 ? <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">暂无费用记录</p> : (
                <ul className="flex flex-col gap-2">
                  {finances.map((f) => {
                    // 核对过的收入（含核对上线前就记成已付的老记录）：员工只能补描述/付款方式/流水号，金额币种类型只有管理员能改
                    const moneyLocked = f.type === "income" && (f.status === "paid" || f.status === "未到账") && user?.role !== "admin";
                    return (
                    <li key={f.id} className="rounded-md p-2 transition-colors hover:bg-[var(--secondary)]">
                      {editingFinanceId === f.id ? (
                        <div className="space-y-1.5">
                          <div className="flex gap-1.5">
                            <select disabled={isNativeCommerce || moneyLocked} value={editFinanceFields.type || f.type} onChange={(e) => setEditFinanceFields(p => ({ ...p, type: e.target.value }))} className="w-16 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1 text-xs outline-none focus:border-[var(--ring)]">
                              {!isNativeCommerce && <option value="income">收入</option>}
                              <option value="expense">支出</option>
                            </select>
                            <input type="number" disabled={moneyLocked} value={editFinanceFields.amount ?? f.amount} onChange={(e) => setEditFinanceFields(p => ({ ...p, amount: Number(e.target.value) }))} className="w-24 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)] disabled:opacity-60" />
                            {(editFinanceFields.type || f.type) === "income" ? (
                              <span className={cn("inline-flex items-center rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium", financeStatusClass({ ...f, type: "income", status: f.type === "income" ? f.status : "待核对" }))} title="收入到没到账在「费用管理」→「待核对」里核对">{f.type === "income" ? financeStatusText(f) : "待核对"}</span>
                            ) : (
                            <select value={editFinanceFields.status && f.type === "expense" ? editFinanceFields.status : f.type === "expense" ? f.status : "pending"} onChange={(e) => setEditFinanceFields(p => ({ ...p, status: e.target.value }))} className="w-16 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1 text-xs outline-none focus:border-[var(--ring)]">
                              <option value="paid">已付</option>
                              <option value="pending">待付</option>
                              <option value="cancelled">已取消</option>
                            </select>
                            )}
                            <select disabled={moneyLocked} value={editFinanceFields.currency || f.currency || "CNY"} onChange={(e) => setEditFinanceFields(p => ({ ...p, currency: e.target.value }))} className="w-16 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1 text-xs outline-none focus:border-[var(--ring)] disabled:opacity-60">
                              <option value="CNY">¥</option>
                              <option value="THB">฿</option>
                            </select>
                          </div>
                          <input value={editFinanceFields.description ?? f.description ?? ""} onChange={(e) => setEditFinanceFields(p => ({ ...p, description: e.target.value }))} placeholder="描述…" className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                          <div className="flex gap-1.5">
                            <input value={editFinanceFields.payment_method ?? f.payment_method ?? ""} onChange={(e) => setEditFinanceFields(p => ({ ...p, payment_method: e.target.value }))} placeholder="付款方式" className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                            <input value={editFinanceFields.slip_number ?? f.slip_number ?? ""} onChange={(e) => setEditFinanceFields(p => ({ ...p, slip_number: e.target.value }))} placeholder="流水号" className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                          </div>
                          <div className="flex gap-1.5">
                            <button onClick={() => handleSaveFinance(f.id)} className="rounded px-2 py-1 text-xs bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_20%)]">保存</button>
                            <button onClick={() => { setEditingFinanceId(null); setEditFinanceFields({}); }} className="rounded px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)]">取消</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[0.6rem] font-medium", f.type === "income" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]" : "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[var(--destructive)]")}>{f.commerce_refund ? "退款" : f.type === "income" ? "收入" : "支出"}</span>
                            <span className="text-xs font-mono font-medium text-[var(--foreground)]">{f.type === "income" ? "+" : "-"}{formatCurrency(f.amount, f.currency)}</span>
                            <span className={cn("inline-flex rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium ml-auto", financeStatusClass(f))}>{financeStatusText(f)}</span>
                            {!isClient && (!isNativeCommerce || (f.type === "expense" && !f.commerce_refund)) && (
                              <div className="flex items-center gap-0.5">
                                <button onClick={() => { setEditingFinanceId(f.id); setEditFinanceFields({ type: f.type, amount: f.amount, description: f.description, payment_method: f.payment_method, slip_number: f.slip_number, status: f.status }); }} className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors" title="编辑"><Pencil className="size-3" /></button>
                                <button onClick={() => setDeleteFinanceTarget(f.id)} className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] transition-colors" title="删除"><Trash2 className="size-3" /></button>
                              </div>
                            )}
                          </div>
                          {f.description && <p className="mt-0.5 text-xs text-[var(--foreground)]">{f.description}</p>}
                          {f.type === "income" && f.status === "未到账" && f.verify_note && (
                            <p className="mt-0.5 text-[0.65rem] text-[var(--destructive)]">未到账原因：{f.verify_note}</p>
                          )}
                          {(f.payment_method || f.slip_number) && <p className="mt-0.5 text-[0.65rem] text-[var(--muted-foreground)]">{f.payment_method || ""}{f.payment_method && f.slip_number && " · "}{f.slip_number ? "流水号 " + f.slip_number : ""}</p>}
                          {f.slip_file && (
                            <p className="mt-0.5">
                              {/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(f.slip_file) ? (
                                <img src={fileUrl(f.slip_file)} alt="水单" className="max-h-16 rounded border border-[var(--border)] cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setPreviewUrl(f.slip_file ?? null)} />
                              ) : (
                                <a href={fileUrl(f.slip_file)} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--primary)] hover:underline">查看水单</a>
                              )}
                            </p>
                          )}
                        </>
                      )}
                    </li>
                    );
                  })}
                </ul>
              )}
              {!isClient && (
              <div className="mt-3 space-y-1.5">
                <div className="flex gap-1.5">
                  <input placeholder="描述…" value={newFinDesc} onChange={(e) => { setNewFinDesc(e.target.value); setFinErrorMsg(""); }} className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                  <input type="number" placeholder="金额" value={newFinAmount} onChange={(e) => { setNewFinAmount(e.target.value); setFinErrorMsg(""); }} className="w-20 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                  <select disabled={isNativeCommerce} value={effectiveFinType} onChange={(e) => setNewFinType(e.target.value)} className="w-16 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1 text-xs outline-none focus:border-[var(--ring)]">
                    {!isNativeCommerce && <option value="income">收入</option>}
                    <option value="expense">支出</option>
                  </select>
                  <select value={newFinCurrency} onChange={(e) => setNewFinCurrency(e.target.value)} className="w-16 rounded-md border border-[var(--border)] bg-[var(--background)] px-1 py-1 text-xs outline-none focus:border-[var(--ring)]">
                    <option value="CNY">¥</option>
                    <option value="THB">฿</option>
                  </select>
                </div>
                <div className="flex max-w-[calc(100vw-4.5rem)] flex-wrap items-center gap-1.5 sm:max-w-full">
                  <input placeholder="付款方式（可选）" value={newFinMethod} onChange={(e) => setNewFinMethod(e.target.value)} className="min-w-0 flex-1 basis-28 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                  <input placeholder="流水单号（可选）" value={newFinSlip} onChange={(e) => setNewFinSlip(e.target.value)} className="min-w-0 flex-1 basis-28 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                  <button type="button" onClick={() => finUploadInput.current?.click()} disabled={uploadingFin} aria-live="polite" className={cn("inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-wait disabled:opacity-60", finSlipFile ? "border-green-300 bg-green-100 text-green-700 hover:bg-green-200 dark:border-green-700 dark:bg-green-900/40 dark:text-green-300" : "border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] hover:bg-[var(--muted)]")}>
                    {uploadingFin ? "上传中…" : finSlipFile ? "已上传 ✓" : "上传截图"}
                  </button>
                  <input ref={finUploadInput} aria-label="费用截图文件" type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" disabled={uploadingFin} onChange={async (e) => {
                    const input = e.currentTarget;
                    const file = input.files?.[0];
                    if (!file) return;
                    setUploadingFin(true);
                    setFinErrorMsg("");
                    setFinSlipFile("");
                    setFinFileName("");
                    try {
                      const form = new FormData();
                      form.append("file", file);
                      const res = await fetchWithAuth("/api/upload", { method: "POST", body: form });
                      const data = await res.json().catch(() => null);
                      if (!res.ok) throw new Error(typeof data?.error === "string" && data.error.trim() ? data.error : `上传失败（HTTP ${res.status}）`);
                      if (typeof data?.url !== "string" || !data.url.trim()) throw new Error("上传失败：服务器未返回文件地址");
                      setFinSlipFile(data.url);
                      setFinFileName(file.name);
                    } catch (err) {
                      console.error("水单上传失败:", err);
                      setFinErrorMsg(err instanceof Error ? err.message : "上传失败，请重试");
                    } finally {
                      setUploadingFin(false);
                      input.value = "";
                    }
                  }} />
                  {(uploadingFin || finFileName) && <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[120px] self-center">{uploadingFin ? "上传中..." : finFileName}</span>}
                  <button onClick={async () => { if (!newFinDesc.trim() || !newFinAmount) { setFinErrorMsg("请填写描述和金额"); return; } if (!finSlipFile) { setFinErrorMsg("请先上传截图"); return; } setFinErrorMsg(""); try { await addFinance(id, { type: effectiveFinType, amount: Number(newFinAmount), description: newFinDesc, payment_method: newFinMethod, slip_number: newFinSlip, slip_file: finSlipFile, status: effectiveFinType === "income" ? "待核对" : "pending", currency: newFinCurrency }); setNewFinDesc(""); setNewFinAmount(""); setNewFinMethod(""); setNewFinSlip(""); setFinSlipFile(""); setFinFileName(""); reload(); } catch (err) { console.error("添加费用失败:", err); setFinErrorMsg(err instanceof Error ? err.message : "添加费用失败"); } }} disabled={uploadingFin} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_20%)] disabled:opacity-50">{uploadingFin ? "上传中..." : "添加"}</button>
                </div>
                {finErrorMsg && <p role="alert" className="mt-1 max-w-[calc(100vw-4.5rem)] break-words text-xs text-[var(--destructive)] sm:max-w-full">{finErrorMsg}</p>}
              </div>
              )}
            </div>
            );})()}

          {sidebarTab === "docs" && (
            <div className="flex flex-col gap-4">
              {/* Client-provided docs */}
              {(() => {
                const clientDocs = documents;
                return (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <h4 className="mb-3 text-[0.65rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)] border-b border-[var(--border)] pb-2">往来资料</h4>
                {clientDocs.length === 0 ? <p className="py-2 text-center text-xs text-[var(--muted-foreground)]">暂无</p> : (
                  <ul className="flex flex-col gap-2">
                    {clientDocs.map((doc) => (
                      <li key={doc.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md p-2 transition-colors hover:bg-[var(--secondary)]">
                        <FileText className="size-3.5 shrink-0 text-[var(--muted-foreground)]" />
                        <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-[var(--foreground)]">{doc.name}{doc.file_url && (
                          /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(doc.file_url) ? (
                            <img src={fileUrl(doc.file_url)} alt={doc.name} className="max-h-10 rounded border border-[var(--border)] cursor-pointer hover:opacity-80 transition-opacity ml-1.5" onClick={() => setPreviewUrl(doc.file_url ?? null)} />
                          ) : (
                            <> <a href={fileUrl(doc.file_url)} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--primary)] hover:underline">查看文件</a></>
                          )
                        )}</p>
                          <span className={cn("text-xs", doc.status === "已审核" ? "text-[var(--success)]" : doc.status === "已退回" ? "text-[var(--destructive)]" : "text-[var(--warning)]")}>{doc.status}</span>
                          {doc.uploaded_by?.startsWith("客户站：") && <span className="ml-1.5 text-xs text-[var(--muted-foreground)]">来自客户站</span>}</div>
                        {!isClient && (
                          // 操作按钮单独一行：这一栏很窄，和名称挤一行会把名称压成一列字（2026-10-03 加「退回」后）
                          <div className="flex w-full flex-wrap items-center justify-end gap-1 pl-5">
                          {doc.status !== "已审核" && <button onClick={() => handleReviewDocument(doc.id, false)} className="shrink-0 rounded px-1.5 py-0.5 text-xs text-[var(--success)] hover:bg-[var(--muted)]">审核通过</button>}
                          {doc.direction !== "us_to_client" && doc.status !== "已退回" && <button onClick={() => handleReturnDocument(doc)} className="shrink-0 rounded px-1.5 py-0.5 text-xs text-[var(--destructive)] hover:bg-[var(--muted)]">退回</button>}
                          {!(doc.publication_verified === 1 && doc.direction === "us_to_client" && doc.status === "已审核") && <button onClick={() => handleReviewDocument(doc.id, true)} className="shrink-0 rounded px-1.5 py-0.5 text-xs text-[var(--primary)] hover:bg-[var(--muted)]">核对后对客公开</button>}
                          {!doc.live_submission && <button onClick={() => setDeleteDocTarget(doc.id)} className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] transition-colors" title="删除文档"><Trash2 className="size-3" /></button>}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {!isClient && (
                <div className="mt-3 space-y-1.5">
                <div className="flex gap-2">
                  <input placeholder="文档名…" value={newDocName} onChange={(e) => { setNewDocName(e.target.value); setDocErrorMsg(""); }} className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                  <label className="shrink-0 cursor-pointer rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
                    {uploadingDoc ? "上传中..." : "选择文件"}
                    <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; setUploadingDoc(true); setDocFileName(file.name); try { const form = new FormData(); form.append("file", file); const res = await fetchWithAuth("/api/upload", { method: "POST", body: form }); if (!res.ok) throw new Error(""); const data = await res.json(); setDocFileUrl(data.url); } catch (err) { console.error("文档上传失败:", err); setDocErrorMsg("文件上传失败"); setDocFileName(""); } finally { setUploadingDoc(false); } }} disabled={uploadingDoc} />
                  </label>
                  <button onClick={async () => { if (!newDocName.trim()) { setDocErrorMsg("请填写文档名"); return; } setDocErrorMsg(""); try { await uploadDocument(id, { name: newDocName, uploaded_by: "Bam", direction: "client_to_us", file_url: docFileUrl }); setNewDocName(""); setDocFileUrl(""); setDocFileName(""); reload(); } catch (err) { console.error("添加文档失败:", err); } }} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_20%)]">添加</button>
                </div>
                {docFileName && <p className="text-xs text-[var(--muted-foreground)]">已选择: {docFileName}</p>}
                </div>
                )}
                {docErrorMsg && <p className="mt-1 text-xs text-[var(--destructive)]">{docErrorMsg}</p>}
                {!isClient && order.source_system === "storefront" && (
                  <div className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-3">
                    <p className="text-xs font-medium text-[var(--foreground)]">要求客户补件 <span className="font-normal text-[var(--muted-foreground)]">（发到客户网站的资料待办）</span></p>
                    <input placeholder="要补的资料名称，如：最新营业执照" value={reqName} onChange={(e) => { setReqName(e.target.value); setReqError(""); }} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                    <input placeholder="说明（客户能看到，可不填）" value={reqDesc} onChange={(e) => setReqDesc(e.target.value)} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                    <div className="flex justify-end">
                      <button onClick={handleSendSupplementRequest} disabled={sendingReq} className="rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_20%)] disabled:opacity-50">{sendingReq ? "发送中…" : "发给客户"}</button>
                    </div>
                    {reqError && <p className="text-xs text-[var(--destructive)]">{reqError}</p>}
                    {supplementRequests.length > 0 && (
                      <ul className="flex flex-col gap-1">
                        {supplementRequests.map((r) => (
                          <li key={r.id} className="rounded-md bg-[var(--secondary)] px-2 py-1.5 text-xs">
                            <p className="font-medium text-[var(--foreground)]">{r.name}{r.description && <span className="font-normal text-[var(--muted-foreground)]"> — {r.description}</span>}</p>
                            <p className="mt-0.5 text-[0.65rem] text-[var(--muted-foreground)]">
                              {r.created_by} · {toThaiTime(r.created_at)} · {r.submitted_at && r.latest_status === "已退回"
                                ? <span className="text-[var(--warning)]">已退回，等客户重交</span>
                                : <span className={r.submitted_at ? "text-[var(--success)]" : "text-[var(--warning)]"}>{r.submitted_at ? `客户已交（${toThaiTime(r.submitted_at)}）` : "等客户交"}</span>}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              );})()}

              {/* Our issued docs (certificates) */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <h4 className="mb-3 text-[0.65rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)] border-b border-[var(--border)] pb-2">我方出具</h4>
                {certificates.length === 0 ? <p className="py-2 text-center text-xs text-[var(--muted-foreground)]">暂无</p> : (
                  <ul className="flex flex-col gap-2">
                    {certificates.map((cert) => {
                      const expDate = cert.expiry_date ? new Date(cert.expiry_date) : null;
                      const now = new Date();
                      const diffDays = expDate ? Math.ceil((expDate.getTime() - now.getTime()) / 86400000) : null;
                      const dynStatus = !expDate ? "valid" : diffDays! < 0 ? "expired" : diffDays! <= 30 ? "expiring" : "valid";
                      const isEditing = editingCertId === cert.id;
                      const fields = isEditing ? editCertFields : cert;
                      return (
                      <li key={cert.id} className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                        {isEditing ? (
                          <div className="space-y-2">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div><label className="text-[0.65rem] text-[var(--muted-foreground)]">证书编号</label><input value={fields.certificate_number || ""} onChange={(e) => setEditCertFields((p) => ({ ...p, certificate_number: e.target.value }))} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" /></div>
                              <div><label className="text-[0.65rem] text-[var(--muted-foreground)]">产品名称</label><input value={fields.product_name || ""} onChange={(e) => setEditCertFields((p) => ({ ...p, product_name: e.target.value }))} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" /></div>
                              <div><label className="text-[0.65rem] text-[var(--muted-foreground)]">签发日期</label><input type="date" value={fields.issue_date || ""} onChange={(e) => setEditCertFields((p) => ({ ...p, issue_date: e.target.value }))} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" /></div>
                              <div><label className="text-[0.65rem] text-[var(--muted-foreground)]">到期日期</label><input type="date" value={fields.expiry_date || ""} onChange={(e) => setEditCertFields((p) => ({ ...p, expiry_date: e.target.value }))} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" /></div>
                              <div><label className="text-[0.65rem] text-[var(--muted-foreground)]">NSW注册号</label><input value={fields.nsw_registration || ""} onChange={(e) => setEditCertFields((p) => ({ ...p, nsw_registration: e.target.value }))} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" /></div>
                              <div><label className="text-[0.65rem] text-[var(--muted-foreground)]">NSW下载</label><select value={fields.nsw_download_status || ""} onChange={(e) => setEditCertFields((p) => ({ ...p, nsw_download_status: e.target.value }))} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]"><option value="">—</option><option value="未下载">未下载</option><option value="已下载">已下载</option><option value="下载中">下载中</option></select></div>
                            </div>
                            <div><label className="text-[0.65rem] text-[var(--muted-foreground)]">备注</label><input value={fields.notes || ""} onChange={(e) => setEditCertFields((p) => ({ ...p, notes: e.target.value }))} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" /></div>
                            <div><label className="text-[0.65rem] text-[var(--muted-foreground)]">证书文件</label><div className="flex items-center gap-1.5"><label className="shrink-0 cursor-pointer rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">{uploadingCert ? "上传中..." : fields.file_url ? "重新上传" : "选择文件"}<input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; setUploadingCert(true); setCertFileName(file.name); try { const form = new FormData(); form.append("file", file); const res = await fetchWithAuth("/api/upload", { method: "POST", body: form }); if (!res.ok) throw new Error(""); const data = await res.json(); setEditCertFields((p) => ({ ...p, file_url: data.url })); } catch (err) { console.error("证书上传失败:", err); setCertFileName(""); } finally { setUploadingCert(false); } }} disabled={uploadingCert} /></label>{fields.file_url && !certFileName && <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[150px]">已上传: {fields.file_url.split("/").pop()}</span>}{certFileName && <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[150px]">新: {certFileName}</span>}</div></div>
                            <div className="flex gap-1.5">
                              <button onClick={() => handleSaveCert(cert.id)} className="rounded px-2 py-1 text-xs bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_20%)]">保存</button>
                              <button onClick={() => { if (isClient) return; setEditingCertId(null); setEditCertFields({}); }} className="rounded px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)]">取消</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-medium text-[var(--foreground)]">{cert.certificate_number}</p>
                            {cert.file_url && (
                            <p className="mt-0.5">
                              {/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(cert.file_url) ? (
                                <img src={fileUrl(cert.file_url)} alt="证书" className="max-h-12 rounded border border-[var(--border)] cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setPreviewUrl(cert.file_url ?? null)} />
                              ) : (
                                <a href={fileUrl(cert.file_url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--primary)] hover:bg-[var(--muted)] transition-colors">查看证书文件</a>
                              )}
                            </p>
                          )}
                              <div className="flex items-center gap-1.5">
                                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[0.65rem] font-medium", dynStatus === "expiring" ? "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[var(--warning)]" : dynStatus === "expired" ? "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[var(--destructive)]" : "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]")}>{dynStatus === "expiring" ? "即将到期" : dynStatus === "expired" ? "已过期" : "有效"}</span>
                                <button onClick={() => { if (isClient) return; setEditingCertId(cert.id); setEditCertFields({ certificate_number: cert.certificate_number, product_name: cert.product_name, issue_date: cert.issue_date, expiry_date: cert.expiry_date, nsw_registration: cert.nsw_registration, nsw_download_status: cert.nsw_download_status, notes: cert.notes, status: cert.status, file_url: cert.file_url }); setCertFileName(""); setCertFileUrl(""); }} className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors" title="编辑证书"><Pencil className="size-3" /></button>
                                <button onClick={() => setDeleteCertTarget(cert.id)} className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] transition-colors" title="删除证书"><Trash2 className="size-3" /></button>
                              </div>
                            </div>
                            {cert.product_name && <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{cert.product_name}</p>}
                            <div className="mt-1 flex gap-3 text-xs text-[var(--muted-foreground)]">
                              <span>签发: {cert.issue_date || "—"}</span>
                              <span>到期: {cert.expiry_date || "—"}</span>
                            </div>
                            {dynStatus === "expiring" && diffDays != null && <p className="mt-1 text-xs font-medium text-[var(--destructive)]">⚠ 距到期还有 {diffDays} 天</p>}
                            {dynStatus === "expired" && diffDays != null && <p className="mt-1 text-xs font-medium text-[var(--destructive)]">⚠ 已过期 {Math.abs(diffDays)} 天，请尽快续期</p>}
                          </>
                        )}
                      </li>
                      );
                    })}
                  </ul>
                )}
                {!isClient && (<>
                <div className="mt-3 flex gap-2">
                  <input placeholder="证书编号…" value={newCertNo} onChange={(e) => { setNewCertNo(e.target.value); setCertErrorMsg(""); }} className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                  <button onClick={async () => { if (!newCertNo.trim()) { setCertErrorMsg("请填写证书编号"); return; } if (newCertIssue && newCertExpiry && newCertExpiry < newCertIssue) { setCertErrorMsg("到期日不能早于签发日"); return; } setCertErrorMsg(""); try { await addCertificate(id, { certificate_number: newCertNo, issue_date: newCertIssue, expiry_date: newCertExpiry, file_url: certFileUrl }); setNewCertNo(""); setNewCertIssue(""); setNewCertExpiry(""); setCertFileUrl(""); setCertFileName(""); reload(); } catch (err) { console.error("添加证书失败:", err); setCertErrorMsg(err instanceof Error ? err.message : "添加证书失败"); } }} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)]" title="添加证书"><Plus className="size-3" /></button>
                </div>
                <div className="flex flex-wrap gap-1.5 items-center text-xs text-[var(--muted-foreground)]">
                  <label className="flex items-center gap-1">签发<input type="date" value={newCertIssue} onChange={(e) => { setNewCertIssue(e.target.value); setCertErrorMsg(""); }} className="rounded-md border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-xs outline-none focus:border-[var(--ring)]" /></label>
                  <label className="flex items-center gap-1">到期<input type="date" value={newCertExpiry} onChange={(e) => { setNewCertExpiry(e.target.value); setCertErrorMsg(""); }} className="rounded-md border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-xs outline-none focus:border-[var(--ring)]" /></label>
                  <span>照证书上的填；没有到期日就空着</span>
                </div>
                <div className="flex gap-1.5 items-center"><label className="shrink-0 cursor-pointer rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">{uploadingCert ? "上传中..." : "选择证书文件"}<input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; setUploadingCert(true); setCertFileName(file.name); try { const form = new FormData(); form.append("file", file); const res = await fetchWithAuth("/api/upload", { method: "POST", body: form }); if (!res.ok) throw new Error(""); const data = await res.json(); setCertFileUrl(data.url); } catch (err) { console.error("证书上传失败:", err); setCertErrorMsg("文件上传失败"); setCertFileName(""); } finally { setUploadingCert(false); } }} disabled={uploadingCert} /></label>{certFileName && <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[120px]">{certFileName}</span>}</div>
                </>
                )}
                {certErrorMsg && <p className="mt-1 text-xs text-[var(--destructive)]">{certErrorMsg}</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 删除备注确认弹窗 */}
      {deleteNoteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteNoteTarget(null)}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-[var(--foreground)]">确认删除备注</h3>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">确定要删除这条备注吗？此操作不可恢复。</p>
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

      {/* 删除费用确认弹窗 */}
      {deleteFinanceTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteFinanceTarget(null)}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-[var(--foreground)]">确认删除费用</h3>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">确定要删除这笔费用记录吗？此操作不可恢复。</p>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setDeleteFinanceTarget(null)} disabled={deletingFinance} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50">取消</button>
              <button onClick={handleDeleteFinance} disabled={deletingFinance} className="rounded-lg bg-[var(--destructive)] px-4 py-2 text-sm font-medium text-white hover:bg-[color-mix(in_oklch,var(--destructive),var(--foreground)_20%)] transition-colors disabled:opacity-50">
                {deletingFinance ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除证书确认弹窗 */}
      {deleteCertTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteCertTarget(null)}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-[var(--foreground)]">确认删除证书</h3>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">确定要删除这份证书吗？此操作不可恢复。</p>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setDeleteCertTarget(null)} disabled={deletingCert} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50">取消</button>
              <button onClick={handleDeleteCert} disabled={deletingCert} className="rounded-lg bg-[var(--destructive)] px-4 py-2 text-sm font-medium text-white hover:bg-[color-mix(in_oklch,var(--destructive),var(--foreground)_20%)] transition-colors disabled:opacity-50">
                {deletingCert ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除文档确认弹窗 */}
      {deleteDocTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteDocTarget(null)}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-[var(--foreground)]">确认删除文档</h3>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">确定要删除这份文档吗？此操作不可恢复。</p>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setDeleteDocTarget(null)} disabled={deletingDoc} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50">取消</button>
              <button onClick={handleDeleteDoc} disabled={deletingDoc} className="rounded-lg bg-[var(--destructive)] px-4 py-2 text-sm font-medium text-white hover:bg-[color-mix(in_oklch,var(--destructive),var(--foreground)_20%)] transition-colors disabled:opacity-50">
                {deletingDoc ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 取消订单弹窗 */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!cancelSaving) setShowCancelModal(false); }}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-[var(--foreground)]">取消订单</h3>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              取消后订单状态变为「客户取消」，下方步骤全部原样保留。请填写取消原因（必填）：
            </p>
            <textarea
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="例如：客户选了别家 / 客户预算不够 / 客户不做了"
              rows={3}
              className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
            />
            {cancelError && <p role="alert" className="mt-2 text-sm text-[var(--destructive)]">{cancelError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowCancelModal(false)} disabled={cancelSaving}>取消</Button>
              <Button size="sm" onClick={handleCancelOrder} disabled={cancelSaving} className="bg-[var(--warning)] text-[var(--warning-foreground)]">{cancelSaving ? "取消中…" : "确认取消"}</Button>
            </div>
          </div>
        </div>
      )}

      {/* 删除订单确认弹窗 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setDeleteTarget(null); setOrderDeleteError(null); }}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-[var(--foreground)]">确认删除订单</h3>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              确定要删除订单 <span className="font-mono font-medium text-[var(--foreground)]">{deleteTarget.id}</span>（{deleteTarget.name}）吗？此操作会同时删除所有关联的步骤、文档、费用和证书，且不可恢复。
            </p>
            {orderDeleteError && <p className="mt-3 text-sm text-[var(--destructive)]">{orderDeleteError}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => { setDeleteTarget(null); setOrderDeleteError(null); }} disabled={deletingOrder} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50">取消</button>
              <button onClick={handleConfirmDeleteOrder} disabled={deletingOrder} className="rounded-lg bg-[var(--destructive)] px-4 py-2 text-sm font-medium text-white hover:bg-[color-mix(in_oklch,var(--destructive),var(--foreground)_20%)] transition-colors disabled:opacity-50">
                {deletingOrder ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 复制链接弹窗（HTTP 兼容降级方案） */}
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
                <input
                  type="text"
                  value={copyModalLink}
                  readOnly
                  className="flex-1 bg-transparent text-sm font-mono outline-none select-all"
                  onFocus={e => e.target.select()}
                  autoFocus
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(copyModalLink).catch(() => {});
                    setCopyModalLink(null);
                    setCopyingLink(true);
                    setTimeout(() => setCopyingLink(false), 2000);
                  }}
                >
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
