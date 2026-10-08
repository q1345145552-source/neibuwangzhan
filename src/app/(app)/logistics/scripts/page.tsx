"use client";

import { useState, useEffect, useMemo } from "react";
import { fetchWithAuth } from "@/lib/api";
import { apiCall } from "@/lib/api-call";
import { useAuth } from "@/components/auth-provider";
import { toThaiTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Edit3, Copy, ChevronDown, ChevronRight, Search, X, Check, Pin, PinOff, ThumbsDown, ArrowUp, ArrowDown, Eye } from "lucide-react";

interface ScriptItem {
  id: number;
  question_id: number;
  version_name: string;
  content: string;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_by?: string;
  updated_at?: string;
  copy_count?: number;
  feedback_count?: number;
}
interface QuestionItem {
  id: number;
  question: string;
  category_id: number;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_by?: string;
  updated_at?: string;
  scripts: ScriptItem[];
}
interface CategoryItem {
  id: number;
  name: string;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_by?: string;
  updated_at?: string;
  questions: QuestionItem[];
}
interface ScriptRef {
  script: ScriptItem;
  question: string;
  category_name: string;
}

export default function LogisticsScriptsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [pinned, setPinned] = useState<ScriptRef[]>([]);
  const [recent, setRecent] = useState<ScriptRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [err, setErr] = useState("");

  const [catModalOpen, setCatModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [editCatId, setEditCatId] = useState<number | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [questionModal, setQuestionModal] = useState<{ categoryId: number | null } | null>(null);
  const [questionForm, setQuestionForm] = useState({ question: "", category_id: "" });
  const [editQuestionId, setEditQuestionId] = useState<number | null>(null);
  const [scriptModal, setScriptModal] = useState<{ questionId: number } | null>(null);
  const [scriptForm, setScriptForm] = useState({ version_name: "标准版", content: "" });
  const [editScriptId, setEditScriptId] = useState<number | null>(null);
  // 反馈
  const [feedbackModal, setFeedbackModal] = useState<{ scriptId: number } | null>(null);
  const [feedbackReason, setFeedbackReason] = useState("");
  const [feedbackDetail, setFeedbackDetail] = useState<{ scriptId: number; items: { id: number; user_name: string; reason: string; created_at: string }[] } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/logistics-script/tree", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "加载失败"); setCategories([]); setPinned([]); setRecent([]); }
      else {
        setCategories(Array.isArray(data.categories) ? data.categories : []);
        setPinned(Array.isArray(data.pinned) ? data.pinned : []);
        setRecent(Array.isArray(data.recent) ? data.recent : []);
      }
    } catch { setCategories([]); setPinned([]); setRecent([]); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const pinnedIds = useMemo(() => new Set(pinned.map((p) => p.script.id)), [pinned]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return categories
      .filter((cat) => categoryFilter === "all" || String(cat.id) === categoryFilter)
      .map((cat) => ({
        ...cat,
        questions: cat.questions.filter((q) => !kw || q.question.toLowerCase().includes(kw)),
      }))
      .filter((cat) => cat.questions.length > 0);
  }, [categories, search, categoryFilter]);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 编辑痕迹：改过显示最后更新人/时间，否则显示创建人/时间
  const trailText = (r: { updated_by?: string; updated_at?: string; created_by?: string; created_at?: string }) => {
    const by = r.updated_by || r.created_by || "";
    const raw = r.updated_at || r.created_at || "";
    const d = raw ? (toThaiTime(raw) || raw).slice(0, 10) : "";
    if (!by && !d) return "";
    return r.updated_by ? `最后更新 ${by} ${d}` : `创建 ${by} ${d}`;
  };

  const writeClipboard = async (text: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  const handleCopy = async (s: ScriptItem) => {
    try {
      await writeClipboard(s.content);
      setCopiedId(s.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      alert("复制失败，请手动复制");
    }
    try {
      await fetchWithAuth("/api/logistics-script/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script_id: s.id }),
      });
      load();
    } catch { /* 记录失败不影响复制 */ }
  };

  const handlePin = async (scriptId: number) => {
    await apiCall("/api/logistics-script/pin", { method: "POST", body: { script_id: scriptId } });
    load();
  };

  const handleReorder = async (type: "category" | "question" | "script", id: number, direction: "up" | "down") => {
    await apiCall("/api/logistics-script/reorder", { method: "POST", body: { type, id, direction } });
    load();
  };

  const openFeedback = (scriptId: number) => { setFeedbackModal({ scriptId }); setFeedbackReason(""); setErr(""); };
  const submitFeedback = async () => {
    if (!feedbackModal) return;
    const ok = await apiCall("/api/logistics-script/feedback", { method: "POST", body: { script_id: feedbackModal.scriptId, reason: feedbackReason.trim() }, onError: (m) => setErr(m) });
    if (ok) { setFeedbackModal(null); setErr(""); load(); }
  };
  const openFeedbackDetail = async (scriptId: number) => {
    try {
      const res = await fetchWithAuth(`/api/logistics-script/feedback?script_id=${scriptId}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setFeedbackDetail({ scriptId, items: Array.isArray(data) ? data : [] });
    } catch {}
  };

  // ── 分类 CRUD ──
  const createCategory = async () => {
    const name = newCatName.trim();
    if (!name) { setErr("请填写分类名"); return; }
    const ok = await apiCall("/api/logistics-script/categories", { method: "POST", body: { name, sort_order: 0 }, onError: (m) => setErr(m) });
    if (ok) { setNewCatName(""); setErr(""); load(); }
  };
  const renameCategory = async (id: number) => {
    const name = editCatName.trim();
    if (!name) { setErr("请填写分类名"); return; }
    const ok = await apiCall("/api/logistics-script/categories", { method: "PATCH", body: { id, name }, onError: (m) => setErr(m) });
    if (ok) { setEditCatId(null); setEditCatName(""); setErr(""); load(); }
  };
  const deleteCategory = async (id: number) => {
    if (!confirm("确定删除该分类？其下的问题和话术会一起删除。")) return;
    const ok = await apiCall(`/api/logistics-script/categories?id=${id}`, { method: "DELETE" });
    if (ok) load();
  };

  // ── 问题 CRUD ──
  const openQuestionCreate = (categoryId: number | null) => {
    setEditQuestionId(null);
    setQuestionForm({ question: "", category_id: categoryId != null ? String(categoryId) : "" });
    setErr("");
    setQuestionModal({ categoryId });
  };
  const openQuestionEdit = (q: QuestionItem) => {
    setEditQuestionId(q.id);
    setQuestionForm({ question: q.question, category_id: String(q.category_id) });
    setErr("");
    setQuestionModal({ categoryId: q.category_id });
  };
  const saveQuestion = async () => {
    if (!questionForm.question.trim()) { setErr("请填写问题"); return; }
    if (!questionForm.category_id) { setErr("请选择分类"); return; }
    const payload = { question: questionForm.question.trim(), category_id: Number(questionForm.category_id), sort_order: 0 };
    const ok = await apiCall("/api/logistics-script/questions", {
      method: editQuestionId ? "PATCH" : "POST",
      body: editQuestionId ? { id: editQuestionId, ...payload } : payload,
      onError: (m) => setErr(m),
    });
    if (ok) { setQuestionModal(null); setErr(""); load(); }
  };
  const deleteQuestion = async (id: number) => {
    if (!confirm("确定删除该问题？其下的话术会一起删除。")) return;
    const ok = await apiCall(`/api/logistics-script/questions?id=${id}`, { method: "DELETE" });
    if (ok) load();
  };

  // ── 话术 CRUD ──
  const openScriptCreate = (questionId: number) => {
    setEditScriptId(null);
    setScriptForm({ version_name: "标准版", content: "" });
    setErr("");
    setScriptModal({ questionId });
  };
  const openScriptEdit = (s: ScriptItem) => {
    setEditScriptId(s.id);
    setScriptForm({ version_name: s.version_name, content: s.content });
    setErr("");
    setScriptModal({ questionId: s.question_id });
  };
  const saveScript = async () => {
    if (!scriptForm.content.trim()) { setErr("请填写话术内容"); return; }
    const payload = { version_name: scriptForm.version_name.trim() || "标准版", content: scriptForm.content, sort_order: 0 };
    const ok = await apiCall("/api/logistics-script/scripts", {
      method: editScriptId ? "PATCH" : "POST",
      body: editScriptId ? { id: editScriptId, ...payload } : { question_id: scriptModal?.questionId, ...payload },
      onError: (m) => setErr(m),
    });
    if (ok) { setScriptModal(null); setErr(""); load(); }
  };
  const deleteScript = async (id: number) => {
    if (!confirm("确定删除该话术？")) return;
    const ok = await apiCall(`/api/logistics-script/scripts?id=${id}`, { method: "DELETE" });
    if (ok) load();
  };

  const scriptCard = (ref: ScriptRef, showContext: boolean, showReorder: boolean) => {
    const s = ref.script;
    const isPinned = pinnedIds.has(s.id);
    return (
      <div key={s.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
        {showContext && (
          <div className="mb-1 flex items-center gap-1.5 text-[0.65rem] text-[var(--muted-foreground)]">
            <span>{ref.category_name}</span>
            <span>·</span>
            <span className="truncate">{ref.question}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">{s.version_name}</span>
            <span className="text-xs text-[var(--muted-foreground)]">已用 {s.copy_count ?? 0} 次</span>
            {(s.feedback_count ?? 0) > 0 && (
              <button onClick={() => openFeedbackDetail(s.id)} className="text-xs text-red-500 hover:underline" title="查看反馈详情">
                {s.feedback_count} 人反馈不好用
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleCopy(s)}>
              {copiedId === s.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copiedId === s.id ? "已复制" : "复制"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handlePin(s.id)} title={isPinned ? "取消置顶" : "置顶"}>
              {isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openFeedback(s.id)} title="反馈不好用">
              <ThumbsDown className="size-3.5" />
            </Button>
            {isAdmin && (
              <>
                {showReorder && (
                  <>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleReorder("script", s.id, "up")} title="上移"><ArrowUp className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleReorder("script", s.id, "down")} title="下移"><ArrowDown className="size-3.5" /></Button>
                  </>
                )}
                {(s.feedback_count ?? 0) > 0 && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openFeedbackDetail(s.id)} title="反馈详情"><Eye className="size-3.5" /></Button>
                )}
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openScriptEdit(s)}><Edit3 className="size-3" /></Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500" onClick={() => deleteScript(s.id)}><Trash2 className="size-3" /></Button>
              </>
            )}
          </div>
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--foreground)]">{s.content}</p>
        <p className="mt-1.5 text-[0.65rem] text-[var(--muted-foreground)]">{trailText(s)}</p>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Link href="/logistics"><Button variant="ghost" size="icon-sm"><ArrowLeft className="size-4" /></Button></Link>
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">话术模板</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">物流客服标准回复话术</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索问题关键词"
            className="h-9 w-52 rounded-md border border-[var(--border)] bg-[var(--background)] pl-8 pr-3 text-sm outline-none focus:border-[var(--ring)]"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]"
        >
          <option value="all">全部分类</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={() => { setCatModalOpen(true); setNewCatName(""); setEditCatId(null); setErr(""); }} className="gap-1.5">
            <Plus className="size-3.5" />管理分类
          </Button>
        )}
      </div>

      {err && <p className="text-xs text-[var(--destructive)]">{err}</p>}

      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
      ) : (
        <div className="flex flex-col gap-5">
          {pinned.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
              <div className="flex items-center gap-2 border-b border-[var(--border)] bg-amber-50/60 px-4 py-2.5 dark:bg-amber-950/10">
                <Pin className="size-4 text-amber-600" />
                <span className="text-sm font-semibold text-[var(--foreground)]">我的常用</span>
              </div>
              <div className="space-y-2 p-3">{pinned.map((p) => scriptCard(p, true, false))}</div>
            </div>
          )}

          {recent.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
              <div className="flex items-center gap-2 border-b border-[var(--border)] bg-blue-50/60 px-4 py-2.5 dark:bg-blue-950/10">
                <Copy className="size-4 text-blue-600" />
                <span className="text-sm font-semibold text-[var(--foreground)]">最近使用</span>
              </div>
              <div className="space-y-2 p-3">{recent.map((r) => scriptCard(r, true, false))}</div>
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无话术模板</p>
          ) : (
            filtered.map((cat, catIdx) => (
              <div key={cat.id} className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
                <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--muted)]/30 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--foreground)]">{cat.name}</span>
                    <span className="text-[0.65rem] text-[var(--muted-foreground)]">{trailText(cat)}</span>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleReorder("category", cat.id, "up")} title="上移"><ArrowUp className="size-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleReorder("category", cat.id, "down")} title="下移"><ArrowDown className="size-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openQuestionCreate(cat.id)}>
                        <Plus className="size-3.5" />新建问题
                      </Button>
                    </div>
                  )}
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {cat.questions.map((q) => (
                    <div key={q.id}>
                      <div className="flex items-center gap-2 px-4 py-3">
                        <button onClick={() => toggleExpand(q.id)} className="flex flex-1 items-center gap-2 text-left transition-colors">
                          <span className="flex-1 min-w-0 break-words text-sm text-[var(--foreground)]">{q.question}</span>
                          {expanded.has(q.id) ? <ChevronDown className="size-4 shrink-0 text-[var(--muted-foreground)]" /> : <ChevronRight className="size-4 shrink-0 text-[var(--muted-foreground)]" />}
                        </button>
                        {isAdmin && (
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleReorder("question", q.id, "up")} title="上移"><ArrowUp className="size-3.5" /></Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleReorder("question", q.id, "down")} title="下移"><ArrowDown className="size-3.5" /></Button>
                          </div>
                        )}
                      </div>
                      {expanded.has(q.id) && (
                        <div className="space-y-2 bg-[var(--muted)]/10 px-4 py-3">
                          <p className="text-[0.65rem] text-[var(--muted-foreground)]">{trailText(q)}</p>
                          {q.scripts.length === 0 ? (
                            <p className="text-xs text-[var(--muted-foreground)]">该问题下暂无话术</p>
                          ) : (
                            q.scripts.map((s) => scriptCard({ script: s, question: q.question, category_name: cat.name }, false, true))
                          )}
                          {isAdmin && (
                            <div className="flex items-center justify-between gap-2 pt-1">
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openScriptCreate(q.id)}>
                                <Plus className="size-3.5" />新建话术
                              </Button>
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openQuestionEdit(q)}><Edit3 className="size-3" /></Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500" onClick={() => deleteQuestion(q.id)}><Trash2 className="size-3" /></Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── 分类管理弹窗 ── */}
      {catModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCatModalOpen(false)}>
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">分类管理</h3>
              <button onClick={() => setCatModalOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <div className="mt-4 flex gap-2">
              <input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="新分类名" className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
              <Button size="sm" onClick={createCategory}>新建</Button>
            </div>
            {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}
            <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
              {categories.length === 0 ? (
                <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">还没有分类</p>
              ) : (
                categories.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2">
                    {editCatId === c.id ? (
                      <>
                        <input value={editCatName} onChange={(e) => setEditCatName(e.target.value)} className="flex-1 rounded-md border border-[var(--border)] px-2 py-1 text-sm outline-none focus:border-[var(--ring)]" />
                        <Button size="sm" onClick={() => renameCategory(c.id)}>保存</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditCatId(null)}>取消</Button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 truncate text-sm text-[var(--foreground)]">{c.name}</span>
                        <button onClick={() => { setEditCatId(c.id); setEditCatName(c.name); setErr(""); }} className="shrink-0 text-xs text-blue-600 hover:underline">重命名</button>
                        <button onClick={() => deleteCategory(c.id)} className="shrink-0 text-xs text-red-500 hover:underline">删除</button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 问题弹窗 ── */}
      {questionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setQuestionModal(null)}>
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold">{editQuestionId ? "编辑问题" : "新建问题"}</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">问题（客服遇到的情况）</label>
                <textarea value={questionForm.question} onChange={(e) => setQuestionForm((p) => ({ ...p, question: e.target.value }))} rows={3} placeholder="例如：客户问清关需要多久" className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">分类</label>
                <select value={questionForm.category_id} onChange={(e) => setQuestionForm((p) => ({ ...p, category_id: e.target.value }))} className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]">
                  <option value="">请选择分类</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setQuestionModal(null)}>取消</Button>
              <Button size="sm" onClick={saveQuestion}>保存</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── 话术弹窗 ── */}
      {scriptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setScriptModal(null)}>
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold">{editScriptId ? "编辑话术" : "新建话术"}</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">版本名</label>
                <input value={scriptForm.version_name} onChange={(e) => setScriptForm((p) => ({ ...p, version_name: e.target.value }))} placeholder="标准版 / 加急版 / 安抚版" className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">话术内容（支持换行）</label>
                <textarea value={scriptForm.content} onChange={(e) => setScriptForm((p) => ({ ...p, content: e.target.value }))} rows={5} placeholder="填写要回复客户的话术" className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
            </div>
            {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setScriptModal(null)}>取消</Button>
              <Button size="sm" onClick={saveScript}>保存</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── 反馈弹窗 ── */}
      {feedbackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFeedbackModal(null)}>
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold">反馈不好用</h3>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">这条话术哪里不好用？（选填）</p>
            <textarea value={feedbackReason} onChange={(e) => setFeedbackReason(e.target.value)} rows={3} placeholder="例如：话术过时了、回复不对…" className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
            {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setFeedbackModal(null)}>取消</Button>
              <Button size="sm" onClick={submitFeedback}>提交</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── 反馈详情弹窗（仅管理员） ── */}
      {feedbackDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFeedbackDetail(null)}>
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">反馈详情</h3>
              <button onClick={() => setFeedbackDetail(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto">
              {feedbackDetail.items.length === 0 ? (
                <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">暂无反馈</p>
              ) : (
                feedbackDetail.items.map((f) => (
                  <div key={f.id} className="rounded-md border border-[var(--border)] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-[var(--foreground)]">{f.user_name}</span>
                      <span className="text-xs text-[var(--muted-foreground)]">{(toThaiTime(f.created_at) || "").slice(0, 10)}</span>
                    </div>
                    {f.reason && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{f.reason}</p>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
