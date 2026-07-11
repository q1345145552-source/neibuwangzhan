"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Check, AlertTriangle, FileText, Paperclip, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const statusClass: Record<string, string> = {
  "待处理": "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  "进行中": "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  "已完成": "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  "已停止": "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

const phaseLabels: Record<string, string> = {
  discovery: "达人发现",
  contract: "签约跟进",
  incubation: "品牌孵化",
};

const phaseColors: Record<string, string> = {
  discovery: "border-pink-300 dark:border-pink-700",
  contract: "border-blue-300 dark:border-blue-700",
  incubation: "border-amber-300 dark:border-amber-700",
};

const phaseBgs: Record<string, string> = {
  discovery: "bg-pink-50 dark:bg-pink-950/30",
  contract: "bg-blue-50 dark:bg-blue-950/30",
  incubation: "bg-amber-50 dark:bg-amber-950/30",
};

interface InfluencerStep {
  id: number;
  step_name: string;
  step_order: number;
  phase: string;
  status: string;
  assignee: string;
  notes: string;
  stop_reason: string;
  completed_at: string | null;
}

interface Influencer {
  id: number;
  name: string;
  status: string;
  category: string;
  tiktok_link: string;
  followers: string;
  notes: string;
  steps: InfluencerStep[];
}

export default function InfluencerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [influencer, setInfluencer] = useState<Influencer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stopModal, setStopModal] = useState<{ stepId: number; stepName: string } | null>(null);
  const [stopReason, setStopReason] = useState("");
  const [stopReasonErr, setStopReasonErr] = useState("");
  const [stopping, setStopping] = useState(false);
  const [completingId, setCompletingId] = useState<number | null>(null);
  const [fileUploading, setFileUploading] = useState<Record<number, boolean>>({});

  const load = async () => {
    try {
      const res = await fetch(`/api/influencers/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error("加载失败");
      const data = await res.json();
      setInfluencer(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const canComplete = (step: InfluencerStep, allSteps: InfluencerStep[]): boolean => {
    if (step.status === "已完成" || step.status === "已停止") return false;
    if (step.step_order === 1) return true; // First step always completable
    const prev = allSteps.find(s => s.step_order === step.step_order - 1);
    if (!prev) return true;
    return prev.status === "已完成";
  };

  const handleComplete = async (step: InfluencerStep) => {
    setCompletingId(step.id);
    try {
      const res = await fetch(`/api/influencers/${id}/steps`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: step.id, status: "已完成" }),
      });
      if (!res.ok) throw new Error("操作失败");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setCompletingId(null);
    }
  };

  const handleStop = (step: InfluencerStep) => {
    setStopModal({ stepId: step.id, stepName: step.step_name });
    setStopReason("");
    setStopReasonErr("");
  };

  const confirmStop = async () => {
    if (!stopReason.trim()) {
      setStopReasonErr("请填写停止原因");
      return;
    }
    if (!stopModal) return;
    setStopping(true);
    try {
      // Update influencer status to 已停止
      await fetch(`/api/influencers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "已停止" }),
      });
      // Update step with stop reason
      await fetch(`/api/influencers/${id}/steps`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: stopModal.stepId, status: "已停止", stop_reason: stopReason }),
      });
      setStopModal(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setStopping(false);
    }
  };

  const handleUpload = async (stepId: number, file: File) => {
    setFileUploading(prev => ({ ...prev, [stepId]: true }));
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error("上传失败");
      const { url } = await uploadRes.json();
      
      // Save to documents table
      await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, file_type: file.type, file_url: url, order_id: "" }),
      });
      
      // Add note about file upload
      const note = `📎 上传文件: ${file.name} (${url})`;
      const currentStep = influencer?.steps.find(s => s.id === stepId);
      const updatedNotes = currentStep?.notes ? currentStep.notes + "\n" + note : note;
      
      await fetch(`/api/influencers/${id}/steps`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: stepId, notes: updatedNotes }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setFileUploading(prev => ({ ...prev, [stepId]: false }));
    }
  };

  if (loading) return <div className="py-20 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>;
  if (error && !influencer) return <div className="py-20 text-center text-sm text-[var(--destructive)]">{error}</div>;
  if (!influencer) return null;

  const steps = influencer.steps || [];
  const phases = ["discovery", "contract", "incubation"] as const;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.push("/agency/influencers")}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">
            {influencer.name}
          </h1>
          <div className="mt-1 flex items-center gap-3">
            <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[influencer.status] || "bg-gray-100")}>
              {influencer.status}
            </span>
            {influencer.category && <span className="text-xs text-[var(--muted-foreground)]">{influencer.category}</span>}
            {influencer.followers && <span className="text-xs text-[var(--muted-foreground)]">{influencer.followers} 粉丝</span>}
          </div>
          {influencer.tiktok_link && (
            <a href={influencer.tiktok_link} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-[var(--primary)] hover:underline break-all">
              {influencer.tiktok_link}
            </a>
          )}
        </div>
        <div className="text-right shrink-0">
          <span className="text-xs text-[var(--muted-foreground)]">
            完成 {steps.filter(s => s.status === "已完成").length}/{steps.length}
          </span>
        </div>
      </div>

      {error && <div className="rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-4 py-3 text-sm text-[var(--destructive)]">{error}</div>}

      {/* 19-step timeline by phase */}
      {phases.map(phase => {
        const phaseSteps = steps.filter(s => s.phase === phase);
        if (phaseSteps.length === 0) return null;
        return (
          <div key={phase} className={cn("rounded-xl border", phaseColors[phase], phaseBgs[phase])}>
            <div className="px-5 py-3 border-b border-[var(--border)]/50 flex items-center justify-between">
              <h3 className="text-sm font-medium">{phaseLabels[phase]}</h3>
              <span className="text-xs text-[var(--muted-foreground)]">
                {phaseSteps.filter(s => s.status === "已完成").length}/{phaseSteps.length} 完成
              </span>
            </div>
            <div className="p-4">
              <div className="relative">
                {phaseSteps.map((step) => {
                  const isComplete = step.status === "已完成";
                  const isStopped = step.status === "已停止";
                  const completable = canComplete(step, steps);
                  return (
                    <div key={step.id} className="relative flex gap-4 pb-5 last:pb-0">
                      {/* Timeline line & dot */}
                      <div className="flex flex-col items-center shrink-0">
                        <div className={cn(
                          "flex size-7 items-center justify-center rounded-full border-2 text-xs font-bold",
                          isComplete ? "border-green-500 bg-green-500 text-white" :
                          isStopped ? "border-red-400 bg-red-100 text-red-500 dark:bg-red-900" :
                          completable ? "border-[var(--primary)] bg-[var(--background)] text-[var(--primary)]" :
                          "border-gray-300 bg-gray-100 text-gray-400 dark:border-gray-600 dark:bg-gray-800"
                        )}>
                          {isComplete ? <Check className="size-3" /> :
                           isStopped ? <AlertTriangle className="size-3" /> :
                           step.step_order}
                        </div>
                        {step.step_order < steps.length && (
                          <div className={cn(
                            "w-px flex-1 min-h-4",
                            isComplete ? "bg-green-300 dark:bg-green-700" :
                            isStopped ? "bg-red-200 dark:bg-red-800" :
                            "bg-gray-200 dark:bg-gray-700"
                          )} />
                        )}
                      </div>
                      {/* Step content */}
                      <div className="flex-1 min-w-0 pb-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className={cn(
                            "text-sm",
                            isComplete ? "text-[var(--foreground)] line-through decoration-green-400" :
                            isStopped ? "text-[var(--muted-foreground)] line-through decoration-red-400" :
                            "text-[var(--foreground)]"
                          )}>
                            {step.step_name}
                          </p>
                          <span className={cn("inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs", statusClass[step.status])}>
                            {step.status}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
                          <span>负责人: {step.assignee || "—"}</span>
                          {step.completed_at && <span>完成于 {step.completed_at.slice(0, 10)}</span>}
                        </div>

                        {/* Notes */}
                        {step.notes && (
                          <div className="mt-2 rounded-md bg-[var(--background)]/60 px-3 py-2 text-xs text-[var(--muted-foreground)] whitespace-pre-wrap border border-[var(--border)]/50">
                            {step.notes}
                          </div>
                        )}

                        {/* Stop reason */}
                        {isStopped && step.stop_reason && (
                          <div className="mt-2 rounded-md bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                            🛑 停止原因: {step.stop_reason}
                          </div>
                        )}

                        {/* Action buttons */}
                        {!isComplete && !isStopped && (
                          <div className="mt-2 flex items-center gap-2 flex-wrap">
                            {completable ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1 border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-300"
                                onClick={() => handleComplete(step)}
                                disabled={completingId === step.id}
                              >
                                {completingId === step.id ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                                标记完成
                              </Button>
                            ) : (
                              <span className="text-xs text-[var(--muted-foreground)]">⏳ 请先完成上一步</span>
                            )}
                            
                            {/* Stop button */}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                              onClick={() => handleStop(step)}
                            >
                              <AlertTriangle className="size-3" />
                              停止合作
                            </Button>

                            {/* File upload */}
                            <label className={cn(
                              "cursor-pointer inline-flex items-center gap-1 h-7 px-2 text-xs rounded-md border border-[var(--border)] hover:bg-[var(--secondary)]",
                              fileUploading[step.id] && "opacity-50 pointer-events-none"
                            )}>
                              {fileUploading[step.id] ? <Loader2 className="size-3 animate-spin" /> : <Paperclip className="size-3" />}
                              {fileUploading[step.id] ? "上传中" : "附件"}
                              <input type="file" className="hidden" onChange={e => {
                                const f = e.target.files?.[0];
                                if (f) handleUpload(step.id, f);
                                e.target.value = "";
                              }} />
                            </label>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}

      {/* Stop reason modal */}
      {stopModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setStopModal(null)}>
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-[var(--foreground)] flex items-center gap-2">
              <AlertTriangle className="size-5 text-red-500" />
              停止合作
            </h3>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              当前步骤: {stopModal.stepName}
            </p>
            <div className="mt-4">
              <label className="text-sm font-medium text-[var(--foreground)]">
                停止原因 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={stopReason}
                onChange={e => { setStopReason(e.target.value); setStopReasonErr(""); }}
                placeholder="请填写停止合作的具体原因..."
                rows={3}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)] resize-none"
                autoFocus
              />
              {stopReasonErr && <p className="mt-1 text-xs text-[var(--destructive)]">{stopReasonErr}</p>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStopModal(null)} disabled={stopping}>取消</Button>
              <Button variant="destructive" size="sm" onClick={confirmStop} disabled={stopping}>
                {stopping ? "处理中..." : "确认停止"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
