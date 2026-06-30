"use client";

import { useState, useEffect, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, DollarSign, Paperclip, Plus, Upload, MessageSquare, CheckCircle2, Circle } from "lucide-react";
import { fetchOrder, updateStep, fetchDocuments, fetchFinances, uploadDocument, addFinance, fetchStepNotes, addStepNote, fetchStepDocuments, markStepDocumentUploaded } from "@/lib/api";
import { statusClass, statusLabels } from "@/lib/api";
import type { Order, OrderStep, Document, Finance, StepNote, StepDocument } from "@/lib/api";
import { stepTimeEstimates, stepRequiredDocs } from "@/lib/constants";
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
  const [stepNotes, setStepNotes] = useState<Record<number, StepNote[]>>({});
  const [stepDocs, setStepDocs] = useState<Record<number, StepDocument[]>>({});
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});
  const [newNotes, setNewNotes] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"docs" | "finances">("docs");
  const [newDocName, setNewDocName] = useState("");
  const [newFinType, setNewFinType] = useState("income");
  const [newFinAmount, setNewFinAmount] = useState("");
  const [newFinDesc, setNewFinDesc] = useState("");

  const load = useCallback(async () => {
    try {
      const [data, docs, fins] = await Promise.all([
        fetchOrder(id),
        fetchDocuments(id),
        fetchFinances(id),
      ]);
      setOrder(data);
      const sts = data.steps || [];
      setSteps(sts);
      setDocuments(docs);
      setFinances(fins);

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
        <Button variant="ghost" size="sm" className="mt-4" onClick={() => router.push("/orders")}>返回订单列表</Button>
      </div>
    );
  }

  if (!order) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.push("/orders")} aria-label="返回订单列表"><ArrowLeft className="size-4" aria-hidden="true" /></Button>
          <div>
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>{order.id}</h1>
            <div className="mt-1 flex items-center gap-2">
              <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[order.status])}>{statusLabels[order.status]}</span>
              <span className="text-xs text-[var(--muted-foreground)]">¥{order.total_amount.toLocaleString()}</span>
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
            <h3 className="mb-5 text-sm font-medium text-[var(--foreground)]">进度追踪</h3>
            {steps.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">暂无步骤</p>
            ) : (
              <div className="flex flex-col gap-0">
                {steps.map((step, i) => {
                  const notes = stepNotes[step.id] || [];
                  const sd = stepDocs[step.id] || [];
                  const est = stepTimeEstimates[step.step_order];
                  const expanded = expandedSteps[step.id] || false;
                  const hasNotes = notes.length > 0;
                  const hasDocs = sd.length > 0 || stepRequiredDocs[step.step_order];

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
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-[var(--foreground)]">{step.step_name}</p>
                          <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", stepStatusClass[step.status])}>{step.status}</span>
                          {step.assignee && <span className="text-xs text-[var(--muted-foreground)]">{step.assignee}</span>}
                          {est && <span className="text-xs text-[var(--muted-foreground)]">⏱ {est}</span>}
                        </div>
                        {step.status !== "已完成" && step.status !== "阻塞" && expanded && (
                          <div className="mt-1.5 flex gap-1.5">
                            <button onClick={() => handleStepUpdate(step.id, "已完成")} className="rounded px-2 py-0.5 text-xs text-[var(--success)] hover:bg-[color-mix(in_oklch,var(--success),var(--background)_90%)] transition-colors">标记完成</button>
                            <button onClick={() => handleStepUpdate(step.id, "阻塞")} className="rounded px-2 py-0.5 text-xs text-[var(--destructive)] hover:bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] transition-colors">标记阻塞</button>
                          </div>
                        )}

                        {/* Expand/collapse for notes + docs */}
                        <button onClick={() => toggleExpand(step.id)} className="mt-1 flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
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
                            {stepRequiredDocs[step.step_order] && (
                              <div className="border-t border-[var(--border)] pt-3">
                                <h4 className="mb-2 text-xs font-medium text-[var(--foreground)]">所需文件</h4>
                                <ul className="space-y-1">
                                  {stepRequiredDocs[step.step_order].map((docName, di) => {
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
            <button onClick={() => setSidebarTab("docs")} className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors", sidebarTab === "docs" ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)]")}><Paperclip className="mr-1 inline size-3" />文档</button>
            <button onClick={() => setSidebarTab("finances")} className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors", sidebarTab === "finances" ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)]")}><DollarSign className="mr-1 inline size-3" />费用</button>
          </div>

          {sidebarTab === "docs" && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              {documents.length === 0 ? <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">暂无文档</p> : (
                <ul className="flex flex-col gap-2">
                  {documents.map((doc) => (
                    <li key={doc.id} className="flex items-center gap-2 rounded-md p-2 transition-colors hover:bg-[var(--secondary)]">
                      <FileText className="size-3.5 shrink-0 text-[var(--muted-foreground)]" />
                      <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-[var(--foreground)]">{doc.name}</p>
                        <span className={cn("text-xs", doc.status === "已审核" ? "text-[var(--success)]" : "text-[var(--warning)]")}>{doc.status}</span></div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex gap-2">
                <input placeholder="文档名…" value={newDocName} onChange={(e) => setNewDocName(e.target.value)} className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                <button onClick={async () => { if (newDocName.trim()) { await uploadDocument(id, { name: newDocName, uploaded_by: "Bam" }); setNewDocName(""); load(); } }} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_20%)]"><Upload className="size-3" /></button>
              </div>
            </div>
          )}

          {sidebarTab === "finances" && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              {finances.length === 0 ? <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">暂无费用记录</p> : (
                <ul className="flex flex-col gap-3">
                  {finances.map((fin) => (
                    <li key={fin.id} className="flex items-center justify-between border-b border-[var(--border)] pb-2 last:border-0 last:pb-0">
                      <div><p className="text-xs font-medium text-[var(--foreground)]">{fin.description}</p><span className={cn("text-xs", fin.status === "paid" ? "text-[var(--success)]" : "text-[var(--warning)]")}>{fin.status === "paid" ? "已付" : "未付"}</span></div>
                      <p className={cn("text-xs font-mono tabular-nums", fin.type === "income" ? "text-[var(--success)]" : "text-[var(--destructive)]")}>{fin.type === "income" ? "+" : "-"}¥{fin.amount.toLocaleString()}</p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex gap-2">
                <select value={newFinType} onChange={(e) => setNewFinType(e.target.value)} className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none"><option value="income">收入</option><option value="expense">支出</option></select>
                <input type="number" placeholder="金额" value={newFinAmount} onChange={(e) => setNewFinAmount(e.target.value)} className="w-20 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                <input placeholder="说明" value={newFinDesc} onChange={(e) => setNewFinDesc(e.target.value)} className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)]" />
                <button onClick={async () => { if (newFinAmount) { await addFinance(id, { type: newFinType, amount: Number(newFinAmount), description: newFinDesc }); setNewFinAmount(""); setNewFinDesc(""); load(); } }} className="shrink-0 rounded-md bg-[var(--primary)] px-2 py-1 text-xs text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_20%)]"><Plus className="size-3" /></button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
