"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";
import { apiCall } from "@/lib/api-call";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, X, Lightbulb } from "lucide-react";

interface Idea {
  id: number;
  title: string;
  content: string;
  category: string;
  source: string;
  is_boss: number;
  status: string;
  bonus_amount: number;
  currency: string;
  related_feature: string;
  rejection_reason: string;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = ["产品功能", "业务改进", "新业务", "其他"] as const;

const TRANSITIONS: Record<string, Record<string, string>> = {
  "待评估": { "已采纳": "adopt", "已拒绝": "reject" },
  "已采纳": { "进行中": "start" },
  "进行中": { "已实现": "complete" },
  "已拒绝": { "待评估": "reopen" },
};

const STATUS_BADGE: Record<string, string> = {
  "待评估": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "已采纳": "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  "已拒绝": "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  "进行中": "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "已实现": "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};

export default function IdeasPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const ideaIdParam = useSearchParams().get("idea");
  const listRequest = useRef(0);

  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "board">("list");

  const visibleIdeas = isAdmin ? ideas : ideas.filter((idea) => idea.is_boss === 0);
  const boardStatuses = isAdmin
    ? ["待评估", "已采纳", "进行中", "已实现", "已拒绝"]
    : ["待评估", "已采纳", "进行中", "已实现"];
  const statStatuses = ["待评估", "进行中", "已采纳", "已实现", "已拒绝"];
  const groupedIdeas = Object.fromEntries(
    statStatuses.map((status) => [status, visibleIdeas.filter((idea) => idea.status === status)])
  );

  const [formOpen, setFormOpen] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formCategory, setFormCategory] = useState("产品功能");
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);

  // 老板处理：采纳 / 拒绝 / 已实现
  const [actionModal, setActionModal] = useState<{ id: number; type: "adopt" | "reject" | "complete" } | null>(null);
  const [bonusAmount, setBonusAmount] = useState("");
  const [bonusCurrency, setBonusCurrency] = useState("THB");
  const [relatedFeature, setRelatedFeature] = useState("");
  const [actionErr, setActionErr] = useState("");
  const [acting, setActing] = useState(false);
  const actionInFlight = useRef(false);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [target, setTarget] = useState<{ key: string; idea: Idea } | null>(null);
  const [targetOpen, setTargetOpen] = useState(false);
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetError, setTargetError] = useState("");
  const [targetReload, setTargetReload] = useState(0);
  const targetIdea = target?.key === ideaIdParam ? target.idea : null;
  const [actionViewport, setActionViewport] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!actionModal || !viewport) { setActionViewport(null); return; }
    const update = () => setActionViewport({ left: viewport.offsetLeft, top: viewport.offsetTop, width: viewport.width, height: viewport.height });
    update(); viewport.addEventListener("resize", update); viewport.addEventListener("scroll", update);
    return () => { viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update); };
  }, [actionModal]);

  const load = () => {
    const run = ++listRequest.current;
    setLoading(true);
    fetchWithAuth("/api/ideas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (run === listRequest.current) setIdeas(Array.isArray(d) ? d : []); })
      .catch(() => { if (run === listRequest.current) setIdeas([]); })
      .finally(() => { if (run === listRequest.current) setLoading(false); });
  };

  useEffect(() => { setIdeas([]); load(); return () => { ++listRequest.current; }; }, [user?.name, isAdmin]);

  // 独立按编号查真实记录，权限与列表一致；不依赖慢列表，也不从通知文字猜目标。
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setTarget(null); setTargetOpen(false); setTargetError(""); setTargetLoading(false);
    setActionModal(null); setFormOpen(false); setActionErr("");
    if (ideaIdParam === null || !user) return;
    if (!/^[1-9]\d*$/.test(ideaIdParam) || !Number.isSafeInteger(Number(ideaIdParam))) {
      setTargetError("想法编号无效，请返回想法列表查看。"); return;
    }
    setTargetLoading(true);
    fetchWithAuth(`/api/ideas/${ideaIdParam}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 403 || response.status === 404
          ? "想法不存在或你无权查看。" : "想法加载失败，请重试。");
        const idea: Idea = await response.json();
        if (idea.id !== Number(ideaIdParam) || (!isAdmin && idea.is_boss !== 0)) throw new Error("想法不存在或你无权查看。");
        if (active) { setTarget({ key: ideaIdParam, idea }); setTargetOpen(true); }
      })
      .catch(error => { if (active) setTargetError(error instanceof Error ? error.message : "想法加载失败，请重试。"); })
      .finally(() => { if (active) setTargetLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [ideaIdParam, user?.name, isAdmin, targetReload]);

  const openCreate = () => {
    setFormTitle("");
    setFormContent("");
    setFormCategory("产品功能");
    setFormErr("");
    setFormOpen(true);
  };

  const submit = async () => {
    if (!formTitle.trim()) { setFormErr("请填写标题"); return; }
    if (!formContent.trim()) { setFormErr("请填写内容"); return; }
    setSaving(true);
    const ok = await apiCall("/api/ideas", {
      method: "POST",
      body: { title: formTitle, content: formContent, category: formCategory },
      onError: (m) => setFormErr(m),
    });
    setSaving(false);
    if (ok) { setFormOpen(false); setFormErr(""); load(); }
  };

  const openAdopt = (id: number) => { setBonusAmount(""); setBonusCurrency("THB"); setActionErr(""); setActionModal({ id, type: "adopt" }); };
  const openComplete = (id: number) => { setRelatedFeature(""); setActionErr(""); setActionModal({ id, type: "complete" }); };

  const doAction = async (id: number, action: string, extra?: Record<string, unknown>) => {
    if (!isAdmin || actionInFlight.current) return;
    actionInFlight.current = true;
    setActing(true);
    const ok = await apiCall(`/api/ideas/${id}`, { method: "PATCH", body: { action, ...extra }, onError: (m) => setActionErr(m) });
    actionInFlight.current = false; setActing(false);
    if (ok) { setActionModal(null); setActionErr(""); load(); setTargetReload(value => value + 1); }
  };

  const confirmReject = (id: number) => { setRejectionReason(""); setActionErr(""); setActionModal({ id, type: "reject" }); };
  const confirmStart = async (id: number) => { if (!confirm("确定推进到进行中？")) return; await doAction(id, "start"); };

  const submitAdopt = async () => {
    const amt = Number(bonusAmount);
    if (!bonusAmount.trim() || !Number.isFinite(amt) || amt < 0) { setActionErr("请填写奖金金额"); return; }
    if (!["THB", "CNY"].includes(bonusCurrency)) { setActionErr("请选择币种"); return; }
    await doAction(actionModal!.id, "adopt", { bonus_amount: amt, currency: bonusCurrency });
  };

  const submitComplete = async () => {
    if (!relatedFeature.trim()) { setActionErr("请填写关联功能"); return; }
    await doAction(actionModal!.id, "complete", { related_feature: relatedFeature });
  };

  const submitReject = async () => {
    if (!rejectionReason.trim()) { setActionErr("请填写拒绝原因"); return; }
    await doAction(actionModal!.id, "reject", { rejection_reason: rejectionReason.trim() });
  };

  const dropAction = (status: string) => {
    const idea = ideas.find((item) => item.id === draggedId);
    return isAdmin && !acting && !actionModal && idea ? TRANSITIONS[idea.status]?.[status] : undefined;
  };

  const handleDrop = (status: string) => {
    const action = dropAction(status);
    const id = draggedId;
    setDraggedId(null);
    if (!action || id === null) return;
    if (action === "adopt") openAdopt(id);
    else if (action === "reject") confirmReject(id);
    else if (action === "complete") openComplete(id);
    else void doAction(id, action);
  };

  const actionButtons = (idea: Idea) => isAdmin && (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {idea.status === "待评估" && <>
        <Button size="xs" disabled={acting} onClick={() => openAdopt(idea.id)}>采纳</Button>
        <Button size="xs" variant="outline" disabled={acting} onClick={() => confirmReject(idea.id)}>拒绝</Button>
      </>}
      {idea.status === "已采纳" && <Button size="xs" disabled={acting} onClick={() => confirmStart(idea.id)}>进行中</Button>}
      {idea.status === "进行中" && <Button size="xs" disabled={acting} onClick={() => openComplete(idea.id)}>已实现</Button>}
      {idea.status === "已拒绝" && <Button size="xs" variant="outline" disabled={acting} onClick={() => doAction(idea.id, "reopen")}>重新评估</Button>}
    </div>
  );

  const bonusLabel = (i: Idea) => {
    if (typeof i.bonus_amount !== "number" || !Number.isFinite(i.bonus_amount) || !["THB", "CNY"].includes(i.currency)) return "采纳奖金信息未完整记录";
    return i.bonus_amount > 0 ? `采纳奖金：${i.bonus_amount} ${i.currency}（仅为获批奖金，付款需另行确认）` : `本次采纳无奖金（${i.bonus_amount} ${i.currency}）`;
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 [contain:inline-size]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">想法记录</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{isAdmin ? "记录你的好想法，也看看员工提的点子" : "有好点子就提出来"}</p>
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="size-4" />{isAdmin ? "记想法" : "提点子"}
        </Button>
      </div>

      <div role="group" aria-label="想法视图" className="flex gap-2">
        <Button size="sm" variant={view === "list" ? "default" : "outline"} aria-pressed={view === "list"} onClick={() => setView("list")}>列表</Button>
        <Button size="sm" variant={view === "board" ? "default" : "outline"} aria-pressed={view === "board"} onClick={() => setView("board")}>看板</Button>
      </div>

      {actionErr && !actionModal && <p role="alert" className="text-sm text-[var(--destructive)]">{actionErr}</p>}
      {targetLoading && <p role="status" className="text-sm text-[var(--muted-foreground)]">正在打开通知对应的想法…</p>}
      {targetError && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"><p>{targetError}</p><a href="/ideas" className="mt-2 inline-block underline">返回想法列表</a></div>}
      {targetIdea && !targetOpen && <Button variant="outline" className="min-h-11 self-start" onClick={() => setTargetOpen(true)}>查看通知对应的想法</Button>}

      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
      ) : view === "board" ? (
        <div className="flex min-w-0 flex-col gap-4">
          <div aria-label="想法统计" className="grid grid-cols-5 gap-2">
            {statStatuses.map((status) => (
              <div key={status} data-idea-stat={status} data-count={groupedIdeas[status].length} className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-center">
                <div className="text-xs text-[var(--muted-foreground)]">{status}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{groupedIdeas[status].length}</div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto pb-2">
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${boardStatuses.length}, minmax(240px, 1fr))` }}>
              {boardStatuses.map((status) => (
                <section key={status}
                  onDragOver={(e) => { if (dropAction(status)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } else { e.dataTransfer.dropEffect = "none"; } }}
                  onDrop={(e) => { e.preventDefault(); handleDrop(status); }}
                  data-idea-column={status} aria-label={status} className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 p-3">
                  <h2 className="mb-3 flex items-center justify-between gap-2 text-sm font-medium">
                    <span className={cn("rounded-full px-2 py-1", STATUS_BADGE[status])}>{status}</span>
                    <span className="text-[var(--muted-foreground)]">{groupedIdeas[status].length} 条</span>
                  </h2>
                  <div className="flex flex-col gap-3">
                    {groupedIdeas[status].map((idea) => (
                      <article key={idea.id} data-idea-id={idea.id}
                        draggable={isAdmin && !acting && !actionModal && !!TRANSITIONS[idea.status]}
                        onDragStart={(e) => {
                          if (!isAdmin || acting || actionModal || !TRANSITIONS[idea.status]) { e.preventDefault(); return; }
                          e.dataTransfer.setData("text/plain", String(idea.id));
                          e.dataTransfer.effectAllowed = "move";
                          setDraggedId(idea.id);
                          setActionErr("");
                        }}
                        onDragEnd={() => setDraggedId(null)}
                        className="min-w-0 break-words rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                        <h3 className="text-sm font-medium">{idea.title}</h3>
                        <span className="mt-2 inline-block rounded-full bg-[var(--muted)]/40 px-2 py-0.5 text-xs">{idea.category}</span>
                        <p className="mt-2 text-xs text-[var(--muted-foreground)]">来源：{idea.source}{idea.is_boss === 1 && "（老板）"}</p>
                        <p className="mt-1 text-xs text-[var(--muted-foreground)]">{toThaiTime(idea.created_at)}</p>
                        {status === "已采纳" && <p className="mt-2 text-xs font-medium text-amber-600">{bonusLabel(idea)}</p>}
                        {status === "已实现" && <p className="mt-2 text-xs">关联功能：{idea.related_feature || "未填写"}</p>}
                        {status === "已拒绝" && <p className="mt-2 whitespace-pre-wrap text-xs">拒绝原因：{idea.rejection_reason || "未填写"}</p>}
                        {actionButtons(idea)}
                      </article>
                    ))}
                    {groupedIdeas[status].length === 0 && <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">暂无想法</p>}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : visibleIdeas.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">还没有想法，点右上角记录/提一个</p>
      ) : (
        <div className="flex flex-col gap-2">
          {visibleIdeas.map((i) => (
            <div key={i.id} data-idea-id={i.id} className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 [overflow-wrap:anywhere]">
              <div className="flex flex-wrap items-center gap-2">
                <Lightbulb className="size-4 text-amber-500" />
                <span className="text-sm font-medium text-[var(--foreground)]">{i.title}</span>
                <span className="rounded-full bg-[var(--muted)]/40 px-2 py-0.5 text-xs text-[var(--foreground)]">{i.category}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_BADGE[i.status] || "")}>{i.status}</span>
                {i.status === "已采纳" && (
                  <span className="text-xs font-medium text-amber-600">{bonusLabel(i)}</span>
                )}
              </div>
              {i.status === "已拒绝" && <p className="mt-2 whitespace-pre-wrap text-xs text-red-600">拒绝原因：{i.rejection_reason || "历史记录未保存拒绝原因"}</p>}
              {i.content && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--foreground)]">{i.content}</p>}
              {i.status === "已实现" && i.related_feature && (
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">关联功能：{i.related_feature}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  <span>来源：{i.source}{i.is_boss === 1 && "（老板）"}</span>
                  <span>·</span>
                  <span>{toThaiTime(i.created_at)}</span>
                </div>
                {actionButtons(i)}
              </div>
            </div>
          ))}
        </div>
      )}

      {targetOpen && targetIdea && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setTargetOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label={`想法详情：${targetIdea.title}`} className="max-h-[88dvh] w-full min-w-0 max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl [overflow-wrap:anywhere]" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 text-base font-semibold">{targetIdea.title}</h3><button aria-label="关闭想法详情" className="flex size-11 shrink-0 items-center justify-center" onClick={() => setTargetOpen(false)}><X className="size-5" /></button></div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className={cn("rounded-full px-2 py-1", STATUS_BADGE[targetIdea.status])}>{targetIdea.status}</span><span>{targetIdea.category}</span><span>来源：{targetIdea.source}{targetIdea.is_boss === 1 && "（老板）"}</span></div>
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">{toThaiTime(targetIdea.created_at)}</p>
            {["已采纳", "进行中", "已实现"].includes(targetIdea.status) && <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{bonusLabel(targetIdea)}</p>}
            {targetIdea.status === "已拒绝" && <p className="mt-3 whitespace-pre-wrap rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">拒绝原因：{targetIdea.rejection_reason || "历史记录未保存拒绝原因"}</p>}
            <p className="mt-4 whitespace-pre-wrap text-sm">{targetIdea.content}</p>
            <Button variant="outline" className="mt-4 min-h-11" onClick={() => setTargetOpen(false)}>关闭</Button>
          </div>
        </div>
      )}

      {/* 录入弹窗 */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFormOpen(false)}>
          <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-[var(--foreground)]">{isAdmin ? "记录想法" : "提交点子"}</h3>
              <button onClick={() => setFormOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium">标题 <span className="text-[var(--destructive)]">*</span></label>
                <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="一句话说清这个想法" className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
              <div>
                <label className="text-xs font-medium">分类</label>
                <select value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 text-sm outline-none focus:border-[var(--ring)]">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">内容 <span className="text-[var(--destructive)]">*</span></label>
                <textarea value={formContent} onChange={(e) => setFormContent(e.target.value)} rows={5} placeholder="具体说说这个想法" className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
            </div>

            {formErr && <p className="mt-2 text-xs text-[var(--destructive)]">{formErr}</p>}
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={submit} disabled={saving}>{saving ? "提交中…" : "提交"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>取消</Button>
            </div>
          </div>
        </div>
      )}

      {/* 老板处理弹窗：采纳 / 拒绝 / 已实现 */}
      {actionModal && (
        <div style={actionViewport ? { left: actionViewport.left, top: actionViewport.top, width: actionViewport.width, height: actionViewport.height, right: "auto", bottom: "auto" } : undefined} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!actionInFlight.current) setActionModal(null); }}>
          <div role="dialog" aria-modal="true" aria-label={actionModal.type === "adopt" ? "采纳想法" : actionModal.type === "reject" ? "拒绝想法" : "标记已实现"} style={actionViewport ? { maxHeight: Math.max(0, actionViewport.height - 32) } : undefined} className="max-h-[88dvh] w-full min-w-0 max-w-sm overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-[var(--foreground)]">{actionModal.type === "adopt" ? "采纳想法" : actionModal.type === "reject" ? "拒绝想法" : "标记已实现"}</h3>
              <button onClick={() => { if (!acting) setActionModal(null); }} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            {actionModal.type === "adopt" ? (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium">采纳奖金金额 *</label>
                    <input aria-label="采纳奖金金额" type="number" value={bonusAmount} onChange={(e) => setBonusAmount(e.target.value)} placeholder="0" className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">币种 *</label>
                    <select aria-label="采纳奖金币种" value={bonusCurrency} onChange={(e) => setBonusCurrency(e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 text-sm outline-none focus:border-[var(--ring)]">
                      <option value="THB">泰铢</option>
                      <option value="CNY">人民币</option>
                    </select>
                  </div>
                </div>
              </div>
            ) : actionModal.type === "reject" ? (
              <div className="mt-4">
                <label className="text-xs font-medium">拒绝原因 *</label>
                <textarea aria-label="拒绝原因" value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} rows={3} className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" />
              </div>
            ) : (
              <div className="mt-4">
                <label className="text-xs font-medium">关联功能 <span className="text-[var(--destructive)]">*</span></label>
                <input value={relatedFeature} onChange={(e) => setRelatedFeature(e.target.value)} placeholder="做成了哪个功能" className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
            )}

            {actionErr && <p role="alert" className="mt-2 text-xs text-[var(--destructive)]">{actionErr}</p>}
            <div className="mt-4 flex gap-2">
              <Button size="sm" className="min-h-11" onClick={actionModal.type === "adopt" ? submitAdopt : actionModal.type === "reject" ? submitReject : submitComplete} disabled={acting}>{acting ? "处理中…" : "确认"}</Button>
              <Button variant="ghost" size="sm" onClick={() => { if (!acting) setActionModal(null); }}>取消</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
