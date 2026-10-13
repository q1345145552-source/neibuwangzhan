"use client";

import { useState, useEffect } from "react";
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
  created_at: string;
  updated_at: string;
}

const CATEGORIES = ["产品功能", "业务改进", "新业务", "其他"] as const;

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

  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formCategory, setFormCategory] = useState("产品功能");
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    fetchWithAuth("/api/ideas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setIdeas(Array.isArray(d) ? d : []))
      .catch(() => setIdeas([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [user?.name]);

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">想法记录</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{isAdmin ? "记录你的好想法，也看看员工提的点子" : "有好点子就提出来"}</p>
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="size-4" />{isAdmin ? "记想法" : "提点子"}
        </Button>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
      ) : ideas.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">还没有想法，点右上角记录/提一个</p>
      ) : (
        <div className="flex flex-col gap-2">
          {ideas.map((i) => (
            <div key={i.id} className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Lightbulb className="size-4 text-amber-500" />
                <span className="text-sm font-medium text-[var(--foreground)]">{i.title}</span>
                <span className="rounded-full bg-[var(--muted)]/40 px-2 py-0.5 text-xs text-[var(--foreground)]">{i.category}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_BADGE[i.status] || "")}>{i.status}</span>
              </div>
              {i.content && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--foreground)]">{i.content}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <span>来源：{i.source}{i.is_boss === 1 && "（老板）"}</span>
                <span>·</span>
                <span>{toThaiTime(i.created_at)}</span>
              </div>
            </div>
          ))}
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
    </div>
  );
}
