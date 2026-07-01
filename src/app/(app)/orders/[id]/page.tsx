"use client";

import { useState, useEffect, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, DollarSign, Paperclip, Plus, Upload, MessageSquare, CheckCircle2, Circle, Pencil } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { fetchOrder, updateStep, fetchDocuments, fetchFinances, uploadDocument, addFinance, fetchStepNotes, addStepNote, fetchStepDocuments, markStepDocumentUploaded, fetchCertificates, addCertificate, updateCertificate } from "@/lib/api";
import { statusClass, statusLabels } from "@/lib/api";
import type { Order, OrderStep, Document, Finance, StepNote, StepDocument, Certificate } from "@/lib/api";
import { getStepTimes, getStepDocs } from "@/lib/constants";
import { cn } from "@/lib/utils";

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
  const [newFinMethod, setNewFinMethod] = useState("");
  const [newFinSlip, setNewFinSlip] = useState("");
  const [finErrorMsg, setFinErrorMsg] = useState("");
  const [docErrorMsg, setDocErrorMsg] = useState("");
  const [certErrorMsg, setCertErrorMsg] = useState("");
  const { user } = useAuth();
  const isClient = user?.role === "client";

  const load = useCallback(async () => {
    try {
      const [data, docs, fins, certs] = await Promise.all([
        fetchOrder(id),
        fetchDocuments(id),
        fetchFinances(id),
        fetchCertificates(id),
      ]);
      setOrder(data);
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
      setStepNotes(notesMap);
      setStepDocs(docsMap);
    } catch {
      setError("订单加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = (stepId: number) => {
    setExpandedSteps((prev) => ({ ...prev, [stepId]: !prev[stepId] }));
  };

  const handleAddNote = async (stepId: number) => {
    const content = newNotes[stepId];
    if (!content?.trim()) return;
    await addStepNote(id, stepId, content, "Bam");
    setNewNotes((prev) => ({ ...prev, [stepId]: "" }));
    const notes = await fetchStepNotes(id, stepId);
    setStepNotes((prev) => ({ ...prev, [stepId]: notes }));
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
        await addStepNote(id, stepId, noteContent, "Bam");
      }
      await updateStep(id, stepId, { status: "已完成" });
      load();
    } catch { setError("更新失败"); }
  };

  const handleSaveCert = async (certId: number) => {
    try {
      await updateCertificate(id, certId, editCertFields);
      setEditingCertId(null);
      setEditCertFields({});
      load();
    } catch { setError("保存证书失败"); }
  };

  const handleStepUpdate = async (stepId: number, newStatus: string) => {
    try {
      await updateStep(id, stepId, { status: newStatus });
      load();
    } catch { setError("更新失败"); }
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
          <div>
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>{order.id}</h1>
            <div className="mt-1 flex items-center gap-2">
              <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[order.status])}>{statusLabels[order.status]}</span>
              {order.address_type === "xiangtai" && <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] text-[var(--primary)]">湘泰地址</span>}
              {order.address_type === "client" && order.business_type_id === 7 && <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-[color-mix(in_oklch,var(--info),var(--background)_88%)] text-[var(--info)]">客户地址</span>}
              <span className="text-xs text-[var(--muted-foreground)]">¥{order.total_amount.toLocaleString()}</span>
              <span className="text-xs text-[var(--muted-foreground)]">· {steps.filter(s => s.status === "已完成").length}/{steps.length} 已完成</span>
            </div>
          </div>
        </div>
      </div>

      {error && <div role="alert" className="rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-4 py-3 text-sm text-[var(--destructive)]">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Basic info */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">基本信息</h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div><dt className="text-xs text-[var(--muted-foreground)]">客户</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{order.customer_name}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">负责人</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{order.responsible_person || "—"}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">金额</dt><dd className="mt-1 text-sm font-mono text-[var(--foreground)]">¥{order.total_amount.toLocaleString()}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">创建日期</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{order.created_at?.slice(0, 10)}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-[var(--muted-foreground)]">描述</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{order.description || "—"}</dd></div>
            </dl>
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
                  const uploadedCount = sd.filter((d: any) => d.status === "uploaded").length;
                  const times = getStepTimes(order.business_type_id, order.sub_service_type);
                  const docs = getStepDocs(order.business_type_id, order.sub_service_type);
                  const est = times[step.step_order];
                  const expanded = expandedSteps[step.id] || false;
                  const hasDocs = !!(docs[step.step_order]?.length);
                  const hasNotes = notes.length > 0;
                  const isOverdue = step.deadline && new Date(step.deadline) < new Date() && step.status !== "已完成";
                  // TISI step 8: show elapsed days
                  const isWaiting = step.step_name.includes("等待") && step.status === "进行中";
                  const elapsedDays = isWaiting ? Math.floor((Date.now() - new Date(step.created_at).getTime()) / 86400000) : 0;
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
                          {step.assignee && <span className="text-xs text-[var(--muted-foreground)]">{step.assignee}</span>}
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
                                  onChange={(e) => setNewNotes((p) => ({ ...p, [step.id]: e.target.value }))}
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
                                <button onClick={() => setConfirmingStepId(step.id)} className="rounded border border-[color-mix(in_oklch,var(--success),var(--background)_70%)] bg-[color-mix(in_oklch,var(--success),var(--background)_92%)] px-2 py-1 text-xs text-[var(--success)] hover:bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] transition-colors">标记完成</button>
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
                        {step.status === "已完成" && step.completed_at && (
                          <p className="mt-1 text-xs text-[var(--muted-foreground)]">完成于 {step.completed_at.slice(0, 16).replace("T", " ")}</p>
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
                                      <p>{n.content}</p>
                                      <p className="mt-0.5 text-[0.65rem] text-[var(--muted-foreground)]">{n.created_by} · {n.created_at?.slice(0, 16)}</p>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              <div className="flex gap-1.5">
                                <input value={newNotes[step.id] || ""} onChange={(e) => setNewNotes((p) => ({ ...p, [step.id]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && handleAddNote(step.id)} placeholder="写备注..." className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                                <button onClick={() => handleAddNote(step.id)} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_15%)]">添加</button>
                              </div>
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
              const totalIncome = finances.filter(f => f.type === "income").reduce((s, f) => s + f.amount, 0);
              const totalExpense = finances.filter(f => f.type === "expense").reduce((s, f) => s + f.amount, 0);
              const pendingPay = finances.filter(f => f.status === "pending").reduce((s, f) => s + f.amount, 0);
              return (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              {finances.length > 0 && (
                <div className="mb-4 grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-[color-mix(in_oklch,var(--success),var(--background)_90%)] px-3 py-2 text-center">
                    <p className="text-[0.6rem] text-[var(--success)]">总收入</p>
                    <p className="mt-0.5 text-xs font-mono font-medium text-[var(--success)]">¥{totalIncome.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] px-3 py-2 text-center">
                    <p className="text-[0.6rem] text-[var(--destructive)]">总支出</p>
                    <p className="mt-0.5 text-xs font-mono font-medium text-[var(--destructive)]">¥{totalExpense.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] px-3 py-2 text-center">
                    <p className="text-[0.6rem] text-[var(--warning)]">待付余额</p>
                    <p className="mt-0.5 text-xs font-mono font-medium text-[var(--warning)]">¥{pendingPay.toLocaleString()}</p>
                  </div>
                </div>
              )}
              {finances.length === 0 ? <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">暂无费用记录</p> : (
                <ul className="flex flex-col gap-2">
                  {finances.map((f) => (
                    <li key={f.id} className="rounded-md p-2 transition-colors hover:bg-[var(--secondary)]">
                      <div className="flex items-center gap-2">
                        <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[0.6rem] font-medium", f.type === "income" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]" : "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[var(--destructive)]")}>{f.type === "income" ? "收入" : "支出"}</span>
                        <span className="text-xs font-mono font-medium text-[var(--foreground)]">{f.type === "income" ? "+" : "-"}¥{f.amount.toLocaleString()}</span>
                        <span className={cn("inline-flex rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium ml-auto", f.status === "paid" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]" : f.status === "pending" ? "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[var(--warning)]" : "bg-[var(--muted)] text-[var(--muted-foreground)]")}>{f.status === "paid" ? "已付" : f.status === "pending" ? "待付" : "已取消"}</span>
                      </div>
                      {f.description && <p className="mt-0.5 text-xs text-[var(--foreground)]">{f.description}</p>}
                      {(f.payment_method || f.slip_number) && <p className="mt-0.5 text-[0.65rem] text-[var(--muted-foreground)]">{f.payment_method || ""}{f.payment_method && f.slip_number && " · "}{f.slip_number ? "流水号 " + f.slip_number : ""}</p>}
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
                </div>
                <div className="flex gap-1.5">
                  <input placeholder="付款方式（可选）" value={newFinMethod} onChange={(e) => setNewFinMethod(e.target.value)} className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                  <input placeholder="流水单号（可选）" value={newFinSlip} onChange={(e) => setNewFinSlip(e.target.value)} className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                  <button onClick={async () => { if (!newFinDesc.trim() || !newFinAmount) { setFinErrorMsg("请填写描述和金额"); return; } setFinErrorMsg(""); await addFinance(id, { type: newFinType, amount: Number(newFinAmount), description: newFinDesc, payment_method: newFinMethod, slip_number: newFinSlip }); setNewFinDesc(""); setNewFinAmount(""); setNewFinMethod(""); setNewFinSlip(""); load(); }} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_20%)]">添加</button>
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
                        <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-[var(--foreground)]">{doc.name}</p>
                          <span className={cn("text-xs", doc.status === "已审核" ? "text-[var(--success)]" : "text-[var(--warning)]")}>{doc.status}</span></div>
                      </li>
                    ))}
                  </ul>
                )}
                {!isClient && (
                <div className="mt-3 flex gap-2">
                  <input placeholder="文档名…" value={newDocName} onChange={(e) => { setNewDocName(e.target.value); setDocErrorMsg(""); }} className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                  <button onClick={async () => { if (!newDocName.trim()) { setDocErrorMsg("请填写文档名"); return; } setDocErrorMsg(""); await uploadDocument(id, { name: newDocName, uploaded_by: "Bam", direction: "client_to_us" }); setNewDocName(""); load(); }} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_20%)]">添加</button>
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
                            <div className="flex gap-1.5">
                              <button onClick={() => handleSaveCert(cert.id)} className="rounded px-2 py-1 text-xs bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_20%)]">保存</button>
                              <button onClick={() => { if (isClient) return; setEditingCertId(null); setEditCertFields({}); }} className="rounded px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)]">取消</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-medium text-[var(--foreground)]">{cert.certificate_number}</p>
                              <div className="flex items-center gap-1.5">
                                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[0.65rem] font-medium", dynStatus === "expiring" ? "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[var(--warning)]" : dynStatus === "expired" ? "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[var(--destructive)]" : "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]")}>{dynStatus === "expiring" ? "即将到期" : dynStatus === "expired" ? "已过期" : "有效"}</span>
                                <button onClick={() => { if (isClient) return; setEditingCertId(cert.id); setEditCertFields({ certificate_number: cert.certificate_number, product_name: cert.product_name, issue_date: cert.issue_date, expiry_date: cert.expiry_date, nsw_registration: cert.nsw_registration, nsw_download_status: cert.nsw_download_status, notes: cert.notes, status: cert.status }); }} className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors" title="编辑证书"><Pencil className="size-3" /></button>
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
                {!isClient && (
                <div className="mt-3 flex gap-2">
                  <input placeholder="证书编号…" value={newCertNo} onChange={(e) => { setNewCertNo(e.target.value); setCertErrorMsg(""); }} className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                  <button onClick={async () => { if (!newCertNo.trim()) { setCertErrorMsg("请填写证书编号"); return; } setCertErrorMsg(""); await addCertificate(id, { certificate_number: newCertNo, issue_date: new Date().toISOString().slice(0, 10), expiry_date: new Date(Date.now() + 365*86400000).toISOString().slice(0, 10) }); setNewCertNo(""); load(); }} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)]"><Plus className="size-3" /></button>
                </div>
                )}
                {certErrorMsg && <p className="mt-1 text-xs text-[var(--destructive)]">{certErrorMsg}</p>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}