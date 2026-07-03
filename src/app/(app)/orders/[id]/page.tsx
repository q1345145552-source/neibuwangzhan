"use client";

import { useState, useEffect, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, DollarSign, Paperclip, Plus, Upload, MessageSquare, CheckCircle2, Circle, Pencil, Trash2, Edit3, Save, X, Undo2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { fetchOrder, updateStep, fetchDocuments, fetchFinances, uploadDocument, addFinance, updateFinance, deleteFinance, fetchStepNotes, addStepNote, deleteStepNote, fetchStepDocuments, markStepDocumentUploaded, fetchCertificates, addCertificate, updateCertificate, deleteCertificate, fetchEmployees, fetchBusinessTypes, updateOrder, deleteOrder, deleteDocument, type Employee } from "@/lib/api";
import { statusClass, statusLabels } from "@/lib/api";
import type { BusinessType } from "@/lib/api";
import type { Order, OrderStep, Document, Finance, StepNote, StepDocument, Certificate } from "@/lib/api";
import { getStepTimes, getStepDocs } from "@/lib/constants";
import { cn, toThaiTime, formatCurrency } from "@/lib/utils";

const stepStatusClass: Record<string, string> = {
  "待处理": "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  "进行中": "bg-[color-mix(in_oklch,var(--info),var(--background)_85%)] text-[oklch(0.38_0.10_240)]",
  "已完成": "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  "阻塞": "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]",
};

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [steps, setSteps] = useState<OrderStep[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [finances, setFinances] = useState<Finance[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [stepNotes, setStepNotes] = useState<Record<number, StepNote[]>>({});
  const [stepDocs, setStepDocs] = useState<Record<number, StepDocument[]>>({});
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});
  const [confirmingStepId, setConfirmingStepId] = useState<number | null>(null);
  const [newNotes, setNewNotes] = useState<Record<number, string>>({});
  const [noteErrorMsg, setNoteErrorMsg] = useState<Record<number, string>>({});
  const [deleteNoteTarget, setDeleteNoteTarget] = useState<{stepId:number, noteId:number, content:string} | null>(null);
  const [deletingNote, setDeletingNote] = useState(false);
  const [editingAssigneeStepId, setEditingAssigneeStepId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [businessTypes, setBusinessTypes] = useState<BusinessType[]>([]);

  useEffect(() => {
    fetchEmployees().then(setEmployees).catch(() => {});
    fetchBusinessTypes().then(setBusinessTypes).catch(() => {});
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"finances" | "docs">("finances");
  const [newDocName, setNewDocName] = useState("");
  const [newCertNo, setNewCertNo] = useState("");
  const [editingCertId, setEditingCertId] = useState<number | null>(null);
  const [editCertFields, setEditCertFields] = useState<Partial<Certificate>>({});
  // Finances form
  const [newFinDesc, setNewFinDesc] = useState("");
  const [newFinAmount, setNewFinAmount] = useState("");
  const [newFinType, setNewFinType] = useState("income");
  const [newFinCurrency, setNewFinCurrency] = useState("CNY");
  const [exchangeRate, setExchangeRate] = useState<number>(5);
  const [newFinMethod, setNewFinMethod] = useState("");
  const [newFinSlip, setNewFinSlip] = useState("");
  const [finErrorMsg, setFinErrorMsg] = useState("");
  const [finFileName, setFinFileName] = useState("");
  const [uploadingFin, setUploadingFin] = useState(false);
  const [finSlipFile, setFinSlipFile] = useState("");
  const [docFileName, setDocFileName] = useState("");
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [certFileName, setCertFileName] = useState("");
  const [certFileUrl, setCertFileUrl] = useState("");
  const [uploadingCert, setUploadingCert] = useState(false);
  const [docFileUrl, setDocFileUrl] = useState("");
  const [docErrorMsg, setDocErrorMsg] = useState("");
  const [certErrorMsg, setCertErrorMsg] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { user } = useAuth();
  const isClient = user?.role === "client";
  const [nowMs] = useState(() => Date.now());
  // 编辑模式
  const [editingOrder, setEditingOrder] = useState(false);
  const [editFields, setEditFields] = useState<Partial<Order>>({});
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
    let ignore = false;
    async function run() {
      try {
        const [data, docs, fins, certs] = await Promise.all([
          fetchOrder(id),
          fetchDocuments(id),
          fetchFinances(id),
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

        const notesMap: Record<number, StepNote[]> = {};
        const docsMap: Record<number, StepDocument[]> = {};
        await Promise.all(sts.map(async (s) => {
          notesMap[s.id] = await fetchStepNotes(id, s.id).catch(() => []);
          docsMap[s.id] = await fetchStepDocuments(id, s.id).catch(() => []);
        }));
        if (ignore) return;
        setStepNotes(notesMap);
        setStepDocs(docsMap);
      } catch {
        if (!ignore) setError("订单加载失败");
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

  const handleAddNote = async (stepId: number) => {
    const content = newNotes[stepId];
    if (!content?.trim()) {
      setNoteErrorMsg(prev => ({ ...prev, [stepId]: "请填写备注内容" }));
      return;
    }
    setNoteErrorMsg(prev => ({ ...prev, [stepId]: "" }));
    await addStepNote(id, stepId, content, user?.name || "系统");
    setNewNotes((prev) => ({ ...prev, [stepId]: "" }));
    const notes = await fetchStepNotes(id, stepId);
    setStepNotes((prev) => ({ ...prev, [stepId]: notes }));
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
    await markStepDocumentUploaded(id, stepId, docId);
    const docs = await fetchStepDocuments(id, stepId);
    setStepDocs((prev) => ({ ...prev, [stepId]: docs }));
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
      reload();
    } catch { setError("更新失败"); }
  };

  // 步骤撤回
  const handleRollback = async (stepId: number) => {
    try {
      await updateStep(id, stepId, { status: "进行中" });
      reload();
    } catch { setError("撤回失败"); }
  };

  // 费用保存
  const handleSaveFinance = async (financeId: number) => {
    try {
      await updateFinance(id, financeId, editFinanceFields);
      setEditingFinanceId(null);
      setEditFinanceFields({});
      reload();
    } catch { setError("保存费用失败"); }
  };

  // 费用删除
  const handleDeleteFinance = async () => {
    if (!deleteFinanceTarget) return;
    setDeletingFinance(true);
    try {
      await deleteFinance(id, deleteFinanceTarget);
      setDeleteFinanceTarget(null);
      reload();
    } catch { setError("删除费用失败"); setDeletingFinance(false); setDeleteFinanceTarget(null); }
  };

  // 证书删除
  const handleDeleteCert = async () => {
    if (!deleteCertTarget) return;
    setDeletingCert(true);
    try {
      await deleteCertificate(id, deleteCertTarget);
      setDeleteCertTarget(null);
      reload();
    } catch { setError("删除证书失败"); setDeletingCert(false); setDeleteCertTarget(null); }
  };

  // 文档删除
  const handleDeleteDoc = async () => {
    if (!deleteDocTarget) return;
    setDeletingDoc(true);
    try {
      await deleteDocument(id, deleteDocTarget);
      setDeleteDocTarget(null);
      reload();
    } catch { setError("删除文档失败"); setDeletingDoc(false); setDeleteDocTarget(null); }
  };

  const handleSaveCert = async (certId: number) => {
    try {
      await updateCertificate(id, certId, editCertFields);
      setEditingCertId(null);
      setEditCertFields({});
      reload();
    } catch { setError("保存证书失败"); }
  };

  const handleStepUpdate = async (stepId: number, newStatus: string) => {
    try {
      await updateStep(id, stepId, { status: newStatus });
      reload();
    } catch { setError("更新失败"); }
  };

  // 调试：监控 editingOrder 变化
  useEffect(() => {
    console.log("[调试] editingOrder 状态变化:", editingOrder, "order 存在:", !!order);
  }, [editingOrder]);

  // 编辑订单
  const startEdit = () => {
    try {
      console.log("[编辑] startEdit 被调用, order:", order?.id);
      if (!order) { console.log("[编辑] order 为空，退出"); return; }
      console.log("[编辑] 设置 editFields, edingOrder 当前:", editingOrder);
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
      console.log("[编辑] editFields 已设置完，准备切 editingOrder = true");
      setEditingOrder(true);
      console.log("[编辑] editingOrder 已设为 true");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "切换编辑失败";
      console.error("[编辑] 切编辑态失败:", msg, err);
      setError(msg);
    }
  };

  const handleSaveOrder = async () => {
    if (!order) return;
    setSavingOrder(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("authToken")}` },
        body: JSON.stringify(editFields),
      });
      const data = await res.json();
      console.log("[保存订单] 响应:", res.status, data);
      if (!res.ok) throw new Error(data.error || data.message || `服务器错误 ${res.status}`);
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.back()} aria-label="返回订单列表"><ArrowLeft className="size-4" aria-hidden="true" /></Button>
          <div className="flex-1">
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>{order.id}</h1>
            <div className="mt-1 flex items-center gap-2">
              <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[order.status])}>{statusLabels[order.status]}</span>
              {order.address_type === "xiangtai" && <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] text-[var(--primary)]">湘泰地址</span>}
              {order.address_type === "client" && order.business_type_id === 7 && <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-[color-mix(in_oklch,var(--info),var(--background)_88%)] text-[var(--info)]">客户地址</span>}
              <span className="text-xs text-[var(--muted-foreground)]">{formatCurrency(order.total_amount, order.currency)}</span>
              <span className="text-xs text-[var(--muted-foreground)]">· {steps.filter(s => s.status === "已完成").length}/{steps.length} 已完成</span>
            </div>
          </div>
          {!isClient && (
            <div className="flex items-center gap-2 shrink-0">
              {!editingOrder ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => { console.log("[编辑按钮] 被点击"); startEdit(); }} className="gap-1.5"><Edit3 className="size-3.5" />编辑</Button>
                  <Button variant="outline" size="sm" onClick={() => setDeleteTarget({id:order.id, name:order.customer_name})} className="gap-1.5 text-[var(--destructive)] border-[var(--destructive)]/30 hover:bg-[var(--destructive)]/10"><Trash2 className="size-3.5" />删除</Button>
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

      {error && <div role="alert" className="rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-4 py-3 text-sm text-[var(--destructive)]">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Basic info */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">基本信息</h3>
            {editingOrder ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">客户名</label>
                  <input type="text" value={editFields.customer_name || ""} onChange={(e) => setEditFields(prev => ({ ...prev, customer_name: e.target.value }))} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
                </div>
                {order.business_type_id === 2 && (
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">商标名称</label>
                  <input type="text" value={editFields.trademark_name || ""} onChange={(e) => setEditFields(prev => ({ ...prev, trademark_name: e.target.value }))} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
                </div>
                )}
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">业务线</label>
                  <select value={editFields.business_type_id || ""} onChange={(e) => setEditFields(prev => ({ ...prev, business_type_id: Number(e.target.value) }))} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]">
                    {businessTypes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">负责人</label>
                  <input type="text" value={editFields.responsible_person || ""} onChange={(e) => setEditFields(prev => ({ ...prev, responsible_person: e.target.value }))} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
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
            {steps.length > 0 && (
              <div className="mb-5 flex items-center gap-3">
                <span className="text-xs text-[var(--muted-foreground)] shrink-0">已完成 {steps.filter(s => s.status === "已完成").length}/{steps.length}</span>
                <div className="flex-1 h-2 rounded-full bg-[var(--muted)] overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all duration-300", steps.filter(s => s.status === "已完成").length === steps.length ? "bg-[var(--success)]" : "bg-[var(--success)]")} style={{ width: `${Math.round(steps.filter(s => s.status === "已完成").length / steps.length * 100)}%` }} />
                </div>
                <span className="text-xs font-medium shrink-0 text-[var(--muted-foreground)]">{steps.filter(s => s.status === "已完成").length === steps.length ? "全部完成" : `${Math.round(steps.filter(s => s.status === "已完成").length / steps.length * 100)}%`}</span>
              </div>
            )}
            {(() => {
              const pendingCount = finances.filter(f => f.status === "pending").length;
              const totalFinCount = finances.length;
              if (totalFinCount === 0) return <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">付款：暂无记录</p>;
              const allPaid = pendingCount === 0;
              return <p className={cn("mt-1.5 text-xs", allPaid ? "text-[var(--success)]" : "text-[var(--warning)]")}>付款：已付 {totalFinCount - pendingCount}/{totalFinCount}，待付 {pendingCount} 项</p>;
            })()}
            {steps.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">暂无步骤</p>
            ) : (
              <div className="flex flex-col gap-0">
                {steps.map((step, i) => {
                  const notes = stepNotes[step.id] || [];
                  const sd = stepDocs[step.id] || [];
                  const uploadedCount = sd.filter((d: { status?: string; uploaded?: boolean }) => d.status === "uploaded").length;
                  const times = getStepTimes(order.business_type_id, order.sub_service_type);
                  const docs = getStepDocs(order.business_type_id, order.sub_service_type);
                  const est = times[step.step_order];
                  const expanded = expandedSteps[step.id] || false;
                  const hasDocs = !!(docs[step.step_order]?.length);
                  const hasNotes = notes.length > 0;
                  const isOverdue = step.deadline && new Date(step.deadline) < new Date(nowMs) && step.status !== "已完成";
                  // TISI step 8: show elapsed days
                  const isWaiting = step.step_name.includes("等待") && step.status === "进行中";
                  const elapsedDays = isWaiting ? Math.floor((nowMs - new Date(step.created_at).getTime()) / 86400000) : 0;
                  const isExceeded = isWaiting && elapsedDays > 60;
                  const over14Days = isWaiting && elapsedDays > 14 && step.step_name.includes("官员");
                  const over30Days = isWaiting && elapsedDays > 30 && step.step_name.includes("检测");
                  const stepData = (() => { try { return JSON.parse(step.step_data || "{}"); } catch { return {}; } })();
                  const logistics = stepData.logistics as { step: string; status: string; note?: string }[] | undefined;

                  return (
                    <div key={step.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                          step.status === "已完成" && "bg-[var(--success)] text-[var(--success-foreground)]",
                          step.status === "进行中" && "bg-[var(--primary)] text-[var(--primary-foreground)] ring-2 ring-[var(--ring)]/30",
                          step.status === "阻塞" && "bg-[var(--destructive)] text-[var(--destructive-foreground)]",
                          step.status === "待处理" && "bg-[var(--muted)] text-[var(--muted-foreground)]"
                        )}>{step.status === "已完成" ? "✓" : step.step_order}</div>
                        {i < steps.length - 1 && <div className={cn("w-px flex-1 min-h-[20px]", step.status === "已完成" ? "bg-[var(--success)]" : "bg-[var(--border)]")} />}
                      </div>
                      <div className="pb-5 flex-1">
                        {isOverdue && <p className="mb-1 text-xs font-medium text-[var(--destructive)]">⚠ 逾期 — 截止 {step.deadline?.slice(0, 10)}</p>}
                        {over14Days && <p className="mb-1 text-xs font-medium text-[var(--warning)]">⚠ 已等 {elapsedDays} 天，建议 Fern 主动跟进</p>}
                        {over30Days && <p className="mb-1 text-xs font-medium text-[var(--warning)]">⚠ 检测已 {elapsedDays} 天，建议跟进进度</p>}
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
                          {editingAssigneeStepId === step.id && (
                            <select
                              value={step.assignee}
                              onChange={async (e) => {
                                const newAssignee = e.target.value;
                                if (newAssignee === step.assignee) { setEditingAssigneeStepId(null); return; }
                                try {
                                  await updateStep(id, step.id, { status: step.status, assignee: newAssignee });
                                  setEditingAssigneeStepId(null);
                                  reload();
                                } catch { /* ignore */ }
                              }}
                              onBlur={() => setEditingAssigneeStepId(null)}
                              autoFocus
                              className="rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-xs outline-none focus:border-[var(--ring)]"
                            >
                              {employees.map(emp => (
                                <option key={emp.id} value={emp.name}>{emp.name}</option>
                              ))}
                            </select>
                          )}
                          {est && <span className="text-xs text-[var(--muted-foreground)]">⏱ {est}</span>}
                          {sd.length > 0 && (
                            <span className={cn("text-xs", uploadedCount === sd.length ? "text-[var(--success)]" : "text-[var(--warning)]")}>文件 {uploadedCount}/{sd.length}</span>
                          )}

                          {step.submission_count > 0 && (
                            <span className="text-xs font-medium text-[var(--info)]">提交 {step.submission_count}/2 · 剩{2 - step.submission_count}次</span>
                          )}
                        </div>
                        {step.status !== "已完成" && step.status !== "阻塞" && (
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
                              </>
                            ) : (
                              <>
                                {(() => {
                                  const isCompanyReg = order?.business_type_id === 1;
                                  const prevStep = steps.find(s => s.step_order === step.step_order - 1);
                                  const canComplete = isCompanyReg || !prevStep || prevStep.status === "已完成";
                                  return canComplete ? (
                                    <button onClick={() => setConfirmingStepId(step.id)} className="rounded border border-[color-mix(in_oklch,var(--success),var(--background)_70%)] bg-[color-mix(in_oklch,var(--success),var(--background)_92%)] px-2 py-1 text-xs text-[var(--success)] hover:bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] transition-colors">标记完成</button>
                                  ) : (
                                    <span className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] opacity-50 cursor-not-allowed select-none">需先完成前一步</span>
                                  );
                                })()}
                                <button onClick={() => handleStepUpdate(step.id, "阻塞")} className="rounded border border-[color-mix(in_oklch,var(--destructive),var(--background)_70%)] bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] px-2 py-1 text-xs text-[var(--destructive)] hover:bg-[color-mix(in_oklch,var(--destructive),var(--background)_85%)] transition-colors">标记阻塞</button>
                                {sd.length > 0 && (
                                  <span className={cn("text-xs", uploadedCount === sd.length ? "text-[var(--success)]" : "text-[var(--warning)]")}>文件 {uploadedCount}/{sd.length}</span>
                                )}
                              </>
                            )}
                            {isWaiting && (
                              <span className={cn("text-xs font-medium", isExceeded ? "text-[var(--destructive)]" : "text-[var(--info)]")}>
                                ⏳ {elapsedDays} 天{isExceeded && "（超期）"}
                              </span>
                            )}
                          </div>
                        )}
                        {(step.status === "已完成" || step.status === "阻塞") && (
                          <div className="mt-1 flex items-center gap-2">
                            {step.status === "已完成" && step.completed_at && (
                              <p className="text-xs text-[var(--muted-foreground)]">完成于 {toThaiTime(step.completed_at)}</p>
                            )}
                            {!isClient && (
                              <button onClick={() => handleRollback(step.id)} className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
                                <Undo2 className="size-3" />撤回
                              </button>
                            )}
                          </div>
                        )}

                        {/* Expand/collapse for notes + docs */}
                        <button onClick={() => toggleExpand(step.id)} className="mt-1 flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
                          <MessageSquare className="size-3" />
                          {hasNotes && <span className="rounded-full bg-[var(--muted)] px-1.5 text-[0.65rem]">{notes.length}</span>}
                          {expanded ? "收起" : "备注 & 所需文件"}
                        </button>

                        {expanded && (
                          <div className="mt-3 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
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
                                        <p className="flex-1">{n.content}</p>
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

                            {/* Required documents */}
                            {docs[step.step_order]?.length > 0 && (
                              <div className="border-t border-[var(--border)] pt-3">
                                <h4 className="mb-2 text-xs font-medium text-[var(--foreground)]">所需文件</h4>
                                <ul className="space-y-1">
                                  {docs[step.step_order].map((docName, di) => {
                                    const existingDoc = sd.find((d) => d.document_name === docName);
                                    const isUploaded = existingDoc?.status === "uploaded";
                                    return (
                                      <li key={di} className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-[var(--muted)]">
                                        <div className="flex items-center gap-1.5">
                                          {isUploaded ? <CheckCircle2 className="size-3 text-[var(--success)]" /> : <Circle className="size-3 text-[var(--muted-foreground)]" />}
                                          <span className={isUploaded ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}>{docName}</span>
                                        </div>
                                        {!isUploaded && existingDoc && (
                                          <button onClick={() => handleMarkUploaded(step.id, existingDoc.id)} className="rounded px-1.5 py-0.5 text-[0.65rem] text-[var(--success)] hover:bg-[color-mix(in_oklch,var(--success),var(--background)_90%)]">标记已上传</button>
                                        )}
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
            <button onClick={() => setSidebarTab("finances")} className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors", sidebarTab === "finances" ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)]")}><DollarSign className="mr-1 inline size-3" />费用</button>
            <button onClick={() => setSidebarTab("docs")} className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors", sidebarTab === "docs" ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)]")}><Paperclip className="mr-1 inline size-3" />文档</button>
          </div>

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
              {/* Exchange rate input */}
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
                            <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[0.6rem] font-medium", f.type === "income" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]" : "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[var(--destructive)]")}>{f.type === "income" ? "收入" : "支出"}</span>
                            <span className="text-xs font-mono font-medium text-[var(--foreground)]">{f.type === "income" ? "+" : "-"}{formatCurrency(f.amount, f.currency)}</span>
                            <span className={cn("inline-flex rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium ml-auto", f.status === "paid" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]" : f.status === "pending" ? "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[var(--warning)]" : "bg-[var(--muted)] text-[var(--muted-foreground)]")}>{f.status === "paid" ? "已付" : f.status === "pending" ? "待付" : "已取消"}</span>
                            {!isClient && (
                              <div className="flex items-center gap-0.5">
                                <button onClick={() => { setEditingFinanceId(f.id); setEditFinanceFields({ type: f.type, amount: f.amount, description: f.description, payment_method: f.payment_method, slip_number: f.slip_number, status: f.status }); }} className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors" title="编辑"><Pencil className="size-3" /></button>
                                <button onClick={() => setDeleteFinanceTarget(f.id)} className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] transition-colors" title="删除"><Trash2 className="size-3" /></button>
                              </div>
                            )}
                          </div>
                          {f.description && <p className="mt-0.5 text-xs text-[var(--foreground)]">{f.description}</p>}
                          {(f.payment_method || f.slip_number) && <p className="mt-0.5 text-[0.65rem] text-[var(--muted-foreground)]">{f.payment_method || ""}{f.payment_method && f.slip_number && " · "}{f.slip_number ? "流水号 " + f.slip_number : ""}</p>}
                          {f.slip_file && (
                            <p className="mt-0.5">
                              {/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(f.slip_file) ? (
                                <img src={f.slip_file} alt="水单" className="max-h-16 rounded border border-[var(--border)] cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setPreviewUrl(f.slip_file ?? null)} />
                              ) : (
                                <a href={f.slip_file} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--primary)] hover:underline">查看水单</a>
                              )}
                            </p>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!isClient && (
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
                    <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; setUploadingFin(true); setFinFileName(file.name); try { const form = new FormData(); form.append("file", file); const res = await fetch("/api/upload", { method: "POST", body: form, headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` } }); if (!res.ok) throw new Error(""); const data = await res.json(); setFinSlipFile(data.url); await addFinance(id, { type: newFinType, amount: Number(newFinAmount || "0"), description: newFinDesc, payment_method: newFinMethod, slip_number: newFinSlip, slip_file: data.url, status: newFinType === "income" ? "paid" : "pending", currency: newFinCurrency }); setNewFinDesc(""); setNewFinAmount(""); setNewFinMethod(""); setNewFinSlip(""); setFinSlipFile(""); setFinFileName(""); reload(); } catch (err) { console.error("水单上传失败:", err); setFinErrorMsg("上传失败"); setFinFileName(""); } finally { setUploadingFin(false); } }} disabled={uploadingFin} />
                  </label>
                  {(uploadingFin || finFileName) && <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[120px] self-center">{uploadingFin ? "上传中..." : finFileName}</span>}
                  <button onClick={async () => { if (!newFinDesc.trim() || !newFinAmount) { setFinErrorMsg("请填写描述和金额"); return; } setFinErrorMsg(""); try { await addFinance(id, { type: newFinType, amount: Number(newFinAmount), description: newFinDesc, payment_method: newFinMethod, slip_number: newFinSlip, slip_file: finSlipFile, status: newFinType === "income" ? "paid" : "pending", currency: newFinCurrency }); setNewFinDesc(""); setNewFinAmount(""); setNewFinMethod(""); setNewFinSlip(""); setFinSlipFile(""); setFinFileName(""); reload(); } catch (err) { console.error("添加费用失败:", err); } }} disabled={uploadingFin} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_20%)] disabled:opacity-50">{uploadingFin ? "上传中..." : "添加"}</button>
                </div>
                {finErrorMsg && <p className="mt-1 text-xs text-[var(--destructive)]">{finErrorMsg}</p>}
              </div>
              )}
            </div>
            );})()}

          {sidebarTab === "docs" && (
            <div className="flex flex-col gap-4">
              {/* Client-provided docs */}
              {(() => {
                const clientDocs = documents.filter(d => !d.direction || d.direction === "client_to_us");
                return (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <h4 className="mb-3 text-[0.65rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)] border-b border-[var(--border)] pb-2">客户提供</h4>
                {clientDocs.length === 0 ? <p className="py-2 text-center text-xs text-[var(--muted-foreground)]">暂无</p> : (
                  <ul className="flex flex-col gap-2">
                    {clientDocs.map((doc) => (
                      <li key={doc.id} className="flex items-center gap-2 rounded-md p-2 transition-colors hover:bg-[var(--secondary)]">
                        <FileText className="size-3.5 shrink-0 text-[var(--muted-foreground)]" />
                        <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-[var(--foreground)]">{doc.name}{doc.file_url && (
                          /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(doc.file_url) ? (
                            <img src={doc.file_url} alt={doc.name} className="max-h-10 rounded border border-[var(--border)] cursor-pointer hover:opacity-80 transition-opacity ml-1.5" onClick={() => setPreviewUrl(doc.file_url ?? null)} />
                          ) : (
                            <> <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--primary)] hover:underline">查看文件</a></>
                          )
                        )}</p>
                          <span className={cn("text-xs", doc.status === "已审核" ? "text-[var(--success)]" : "text-[var(--warning)]")}>{doc.status}</span></div>
                        {!isClient && (
                          <button onClick={() => setDeleteDocTarget(doc.id)} className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] transition-colors" title="删除文档"><Trash2 className="size-3" /></button>
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
                    <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; setUploadingDoc(true); setDocFileName(file.name); try { const form = new FormData(); form.append("file", file); const res = await fetch("/api/upload", { method: "POST", body: form, headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` } }); if (!res.ok) throw new Error(""); const data = await res.json(); setDocFileUrl(data.url); } catch (err) { console.error("文档上传失败:", err); setDocErrorMsg("文件上传失败"); setDocFileName(""); } finally { setUploadingDoc(false); } }} disabled={uploadingDoc} />
                  </label>
                  <button onClick={async () => { if (!newDocName.trim()) { setDocErrorMsg("请填写文档名"); return; } setDocErrorMsg(""); try { await uploadDocument(id, { name: newDocName, uploaded_by: "Bam", direction: "client_to_us", file_url: docFileUrl }); setNewDocName(""); setDocFileUrl(""); setDocFileName(""); reload(); } catch (err) { console.error("添加文档失败:", err); } }} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_20%)]">添加</button>
                </div>
                {docFileName && <p className="text-xs text-[var(--muted-foreground)]">已选择: {docFileName}</p>}
                </div>
                )}
                {docErrorMsg && <p className="mt-1 text-xs text-[var(--destructive)]">{docErrorMsg}</p>}
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
                            <div className="grid grid-cols-2 gap-2">
                              <div><label className="text-[0.65rem] text-[var(--muted-foreground)]">证书编号</label><input value={fields.certificate_number || ""} onChange={(e) => setEditCertFields((p) => ({ ...p, certificate_number: e.target.value }))} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" /></div>
                              <div><label className="text-[0.65rem] text-[var(--muted-foreground)]">产品名称</label><input value={fields.product_name || ""} onChange={(e) => setEditCertFields((p) => ({ ...p, product_name: e.target.value }))} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" /></div>
                              <div><label className="text-[0.65rem] text-[var(--muted-foreground)]">签发日期</label><input type="date" value={fields.issue_date || ""} onChange={(e) => setEditCertFields((p) => ({ ...p, issue_date: e.target.value }))} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" /></div>
                              <div><label className="text-[0.65rem] text-[var(--muted-foreground)]">到期日期</label><input type="date" value={fields.expiry_date || ""} onChange={(e) => setEditCertFields((p) => ({ ...p, expiry_date: e.target.value }))} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" /></div>
                              <div><label className="text-[0.65rem] text-[var(--muted-foreground)]">NSW注册号</label><input value={fields.nsw_registration || ""} onChange={(e) => setEditCertFields((p) => ({ ...p, nsw_registration: e.target.value }))} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" /></div>
                              <div><label className="text-[0.65rem] text-[var(--muted-foreground)]">NSW下载</label><select value={fields.nsw_download_status || ""} onChange={(e) => setEditCertFields((p) => ({ ...p, nsw_download_status: e.target.value }))} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]"><option value="">—</option><option value="未下载">未下载</option><option value="已下载">已下载</option><option value="下载中">下载中</option></select></div>
                            </div>
                            <div><label className="text-[0.65rem] text-[var(--muted-foreground)]">备注</label><input value={fields.notes || ""} onChange={(e) => setEditCertFields((p) => ({ ...p, notes: e.target.value }))} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" /></div>
                            <div><label className="text-[0.65rem] text-[var(--muted-foreground)]">证书文件</label><div className="flex items-center gap-1.5"><label className="shrink-0 cursor-pointer rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">{uploadingCert ? "上传中..." : fields.file_url ? "重新上传" : "选择文件"}<input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; setUploadingCert(true); setCertFileName(file.name); try { const form = new FormData(); form.append("file", file); const res = await fetch("/api/upload", { method: "POST", body: form, headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` } }); if (!res.ok) throw new Error(""); const data = await res.json(); setEditCertFields((p) => ({ ...p, file_url: data.url })); } catch (err) { console.error("证书上传失败:", err); setCertFileName(""); } finally { setUploadingCert(false); } }} disabled={uploadingCert} /></label>{fields.file_url && !certFileName && <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[150px]">已上传: {fields.file_url.split("/").pop()}</span>}{certFileName && <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[150px]">新: {certFileName}</span>}</div></div>
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
                                <img src={cert.file_url} alt="证书" className="max-h-12 rounded border border-[var(--border)] cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setPreviewUrl(cert.file_url ?? null)} />
                              ) : (
                                <a href={cert.file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--primary)] hover:bg-[var(--muted)] transition-colors">查看证书文件</a>
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
                  <button onClick={async () => { if (!newCertNo.trim()) { setCertErrorMsg("请填写证书编号"); return; } setCertErrorMsg(""); try { await addCertificate(id, { certificate_number: newCertNo, issue_date: new Date().toISOString().slice(0, 10), expiry_date: new Date(Date.now() + 365*86400000).toISOString().slice(0, 10), file_url: certFileUrl }); setNewCertNo(""); setCertFileUrl(""); setCertFileName(""); reload(); } catch (err) { console.error("添加证书失败:", err); } }} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)]"><Plus className="size-3" /></button>
                </div>
                <div className="flex gap-1.5 items-center"><label className="shrink-0 cursor-pointer rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">{uploadingCert ? "上传中..." : "选择证书文件"}<input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; setUploadingCert(true); setCertFileName(file.name); try { const form = new FormData(); form.append("file", file); const res = await fetch("/api/upload", { method: "POST", body: form, headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` } }); if (!res.ok) throw new Error(""); const data = await res.json(); setCertFileUrl(data.url); } catch (err) { console.error("证书上传失败:", err); setCertErrorMsg("文件上传失败"); setCertFileName(""); } finally { setUploadingCert(false); } }} disabled={uploadingCert} /></label>{certFileName && <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[120px]">{certFileName}</span>}</div>
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
          <img src={previewUrl} alt="预览" className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl" />
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
    </div>
  );
}