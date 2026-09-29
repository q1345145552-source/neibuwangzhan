"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, X, MessageSquare, Check, ChevronDown, ChevronRight } from "lucide-react";

interface Todo {
  id: number;
  content: string;
  assignee: string;
  priority: string;
  status: string;
  completed_at?: string | null;
  created_by: string;
  created_at: string;
  latest_follow_content?: string | null;
  latest_follow_by?: string | null;
  latest_follow_at?: string | null;
}

const STATUS_CLASS: Record<string, string> = {
  "未完成": "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  "已完成": "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
};

export default function TodosPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [todos, setTodos] = useState<Todo[]>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ content: "", assignee: "", priority: "普通" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [followTarget, setFollowTarget] = useState<Todo | null>(null);
  const [followContent, setFollowContent] = useState("");
  const [following, setFollowing] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);

  const load = useCallback(() => {
    fetchWithAuth("/api/todos", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setTodos(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // 管理员新建时从员工档案下拉选负责人
  useEffect(() => {
    if (!isAdmin) return;
    fetchWithAuth("/api/employees").then((r) => r.json()).then((d) => setEmployees(Array.isArray(d) ? d : [])).catch(() => {});
  }, [isAdmin]);

  const unfinished = todos.filter((t) => t.status !== "已完成");
  const completed = todos
    .filter((t) => t.status === "已完成")
    .sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""));

  // 管理员按员工分组（紧急排前已在后端排好，这里保持顺序）
  const groups = isAdmin
    ? Object.entries(
        unfinished.reduce<Record<string, Todo[]>>((acc, t) => {
          const key = t.assignee || "未分配";
          (acc[key] ||= []).push(t);
          return acc;
        }, {})
      ).map(([assignee, list]) => ({ assignee, list }))
    : null;

  const openForm = () => {
    setForm({ content: "", assignee: user?.name || "", priority: "普通" });
    setErr("");
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.content.trim()) { setErr("请填写工作内容"); return; }
    setSaving(true);
    setErr("");
    try {
      const res = await fetchWithAuth("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowForm(false);
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        setErr(e.error || "提交失败");
      }
    } catch { setErr("提交失败"); }
    finally { setSaving(false); }
  };

  const openFollow = (todo: Todo) => {
    setFollowTarget(todo);
    setFollowContent("");
    setErr("");
  };

  const handleFollow = async () => {
    if (!followTarget) return;
    if (!followContent.trim()) { setErr("请填写跟进内容"); return; }
    setFollowing(true);
    setErr("");
    try {
      const res = await fetchWithAuth(`/api/todos/${followTarget.id}/follow-ups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: followContent.trim() }),
      });
      if (res.ok) {
        setFollowTarget(null);
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        setErr(e.error || "添加跟进失败");
      }
    } catch { setErr("添加跟进失败"); }
    finally { setFollowing(false); }
  };

  const handleComplete = async (todo: Todo) => {
    try {
      const res = await fetchWithAuth(`/api/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "已完成" }),
      });
      if (res.ok) {
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "操作失败");
      }
    } catch { alert("操作失败"); }
  };

  // 未完成待办表格（员工视角 + 管理员每个分组共用）
  const renderTodoTable = (list: Todo[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--secondary)]/50">
            <th className="py-3 px-5 text-left text-xs font-medium text-[var(--muted-foreground)]">工作内容</th>
            <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">负责人</th>
            <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">紧急程度</th>
            <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">状态</th>
            <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">创建时间</th>
            <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">操作</th>
          </tr>
        </thead>
        <tbody>
          {list.map((t) => (
            <tr key={t.id} className={cn("border-b border-[var(--border)]", t.priority === "紧急" && "bg-red-50/60 dark:bg-red-950/20")}>
              <td className="py-3 px-5">
                <div className="text-[var(--foreground)]">{t.content}</div>
                {t.latest_follow_content && (
                  <div className="mt-1 text-xs text-[var(--muted-foreground)]">
                    最新：{t.latest_follow_content}
                    <span className="ml-1 text-[var(--muted-foreground)]/70">· {t.latest_follow_by} · {toThaiTime(t.latest_follow_at)}</span>
                  </div>
                )}
              </td>
              <td className="py-3 px-4 text-[var(--muted-foreground)]">{t.assignee || "—"}</td>
              <td className="py-3 px-4">
                {t.priority === "紧急" ? (
                  <span className="inline-flex rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">紧急</span>
                ) : (
                  <span className="text-xs text-[var(--muted-foreground)]">普通</span>
                )}
              </td>
              <td className="py-3 px-4">
                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASS[t.status] || "bg-[var(--muted)] text-[var(--muted-foreground)]")}>{t.status}</span>
              </td>
              <td className="py-3 px-4 text-xs text-[var(--muted-foreground)]">{toThaiTime(t.created_at) || "—"}</td>
              <td className="py-3 px-4">
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => openFollow(t)} className="gap-1">
                    <MessageSquare className="size-3.5" />跟进
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleComplete(t)} className="gap-1">
                    <Check className="size-3.5" />完成
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">我的待办</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">我的待办列表</p>
        </div>
        <Button size="sm" onClick={openForm} className="gap-1.5">
          <Plus className="size-3.5" />新建待办
        </Button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</div>
      ) : unfinished.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无待办</div>
      ) : isAdmin && groups ? (
        // 管理员：按员工分组显示
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <div key={g.assignee} className="rounded-xl border border-[var(--border)]">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
                <span className="text-sm font-medium text-[var(--foreground)]">{g.assignee}</span>
                <span className="text-xs text-[var(--muted-foreground)]">{g.list.length} 项未完成</span>
              </div>
              {renderTodoTable(g.list)}
            </div>
          ))}
        </div>
      ) : (
        // 员工：只看自己的
        <div className="rounded-xl border border-[var(--border)]">{renderTodoTable(unfinished)}</div>
      )}

      {/* 已完成分类：默认收起，点开看 */}
      <div className="rounded-xl border border-[var(--border)]">
        <button
          onClick={() => setCompletedOpen((o) => !o)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
            {completedOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            已完成（{completed.length}）
          </span>
        </button>
        {completedOpen && (
          <div className="overflow-x-auto border-t border-[var(--border)]">
            {completed.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无已完成待办</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--secondary)]/50">
                    <th className="py-3 px-5 text-left text-xs font-medium text-[var(--muted-foreground)]">工作内容</th>
                    <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">负责人</th>
                    <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">完成时间</th>
                  </tr>
                </thead>
                <tbody>
                  {completed.map((t) => (
                    <tr key={t.id} className="border-b border-[var(--border)]">
                      <td className="py-3 px-5 text-[var(--muted-foreground)] line-through">{t.content}</td>
                      <td className="py-3 px-4 text-[var(--muted-foreground)]">{t.assignee || "—"}</td>
                      <td className="py-3 px-4 text-xs text-[var(--muted-foreground)]">{toThaiTime(t.completed_at) || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* 新建待办弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!saving) setShowForm(false); }}>
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">新建待办</h3>
              <button onClick={() => setShowForm(false)} disabled={saving} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">工作内容（必填）</label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
                  rows={3}
                  placeholder="要做什么事"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">负责人</label>
                {isAdmin ? (
                  <select
                    value={form.assignee}
                    onChange={(e) => setForm((p) => ({ ...p, assignee: e.target.value }))}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                  >
                    {employees.map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
                  </select>
                ) : (
                  <p className="text-sm text-[var(--foreground)]">{user?.name || "—"}</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">紧急程度</label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                >
                  <option value="普通">普通</option>
                  <option value="紧急">紧急</option>
                </select>
              </div>

              {err && <p className="text-xs text-[var(--destructive)]">{err}</p>}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={saving}>取消</Button>
              <Button size="sm" onClick={handleSubmit} disabled={saving}>{saving ? "提交中…" : "提交"}</Button>
            </div>
          </div>
        </div>
      )}

      {/* 加跟进弹窗 */}
      {followTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!following) setFollowTarget(null); }}>
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">加跟进记录</h3>
              <button onClick={() => setFollowTarget(null)} disabled={following} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">待办：{followTarget.content}</p>
            <textarea
              value={followContent}
              onChange={(e) => setFollowContent(e.target.value)}
              rows={3}
              placeholder="写这次更新了什么"
              className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
            />
            {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setFollowTarget(null)} disabled={following}>取消</Button>
              <Button size="sm" onClick={handleFollow} disabled={following}>{following ? "提交中…" : "提交跟进"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
