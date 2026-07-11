"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Plus, Search, Send, Clock, CheckCircle2, Users, Trash2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";

interface DiscoveryTask {
  id: number;
  task_number: string;
  category: string;
  creator: string;
  status: string;
  inf_count: number;
  created_at: string;
  completed_at: string | null;
}

const categories = ["美妆", "服饰", "食品", "家居", "3C数码", "母婴", "运动", "宠物", "其他"];

export default function DiscoveryTasksPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [tasks, setTasks] = useState<DiscoveryTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newTask, setNewTask] = useState({ task_number: "", category: "" });
  const [error, setError] = useState("");
  const [confirmSubmitId, setConfirmSubmitId] = useState<number | null>(null);
  const [stats, setStats] = useState<{ today: { today_tasks: number; today_creators: number; today_infs: number }; byCreator: any[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const url = statusFilter !== "all" ? `/api/discovery-tasks?status=${statusFilter}` : "/api/discovery-tasks";
      const res = await fetch(url, { cache: "no-store" });
      setTasks(await res.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/discovery-tasks/stats", { cache: "no-store" })
      .then(r => r.json()).then(setStats).catch(() => {});
  }, []);

  const handleCreate = async () => {
    if (!newTask.task_number.trim()) { setError("请填写任务编号"); return; }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/discovery-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newTask, creator: user?.name || "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      setShowCreate(false);
      setNewTask({ task_number: "", category: "" });
      router.push(`/agency/influencers/tasks/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally { setSubmitting(false); }
  };

  const handleSubmitForEval = async (taskId: number) => {
    try {
      await fetch("/api/discovery-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, status: "completed" }),
      });
      setConfirmSubmitId(null);
      load();
    } catch (err) { console.error(err); }
  };

  const handleDelete = async (taskId: number) => {
    if (!confirm("确认删除此任务？任务下的达人不会被删除。")) return;
    await fetch(`/api/discovery-tasks?id=${taskId}`, { method: "DELETE" });
    load();
  };

  const filtered = tasks.filter(t => {
    if (!search) return true;
    const s = search.toLowerCase();
    return t.task_number.toLowerCase().includes(s) || t.creator.toLowerCase().includes(s) || t.category.toLowerCase().includes(s);
  });

  // Stats
  const totalInf = tasks.reduce((sum, t) => sum + (t.inf_count || 0), 0);
  const activeCount = tasks.filter(t => t.status === "active").length;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.push("/agency/influencers")}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">达人发现 · 任务</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {activeCount} 个进行中 · 共找到 {totalInf} 位达人
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="size-3.5" />添加任务</Button>
      </div>

      {/* Create task panel */}
      {showCreate && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h2 className="text-sm font-medium mb-4">新建发现任务</h2>
          {error && <div className="mb-3 text-sm text-[var(--destructive)]">{error}</div>}
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-[var(--foreground)]">任务编号 <span className="text-red-500">*</span></label>
              <input value={newTask.task_number} onChange={e => setNewTask(p => ({ ...p, task_number: e.target.value }))}
                placeholder="例如: 美妆-0720" autoFocus
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--foreground)]">目标品类</label>
              <select value={newTask.category} onChange={e => setNewTask(p => ({ ...p, category: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]">
                <option value="">不限</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <Button size="sm" onClick={handleCreate} disabled={submitting}>{submitting ? "创建中..." : "创建任务"}</Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowCreate(false); setError(""); }}>取消</Button>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
          {/* Today overview */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/30">
              <TrendingUp className="size-4 text-blue-500" />
              <span className="text-sm font-medium">今日</span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-[var(--muted-foreground)]">
                发起 <span className="font-medium text-[var(--foreground)]">{stats.today?.today_tasks || 0}</span> 个任务
              </span>
              <span className="text-[var(--muted-foreground)]">
                <span className="font-medium text-[var(--foreground)]">{stats.today?.today_creators || 0}</span> 人在工作中
              </span>
              <span className="text-[var(--muted-foreground)]">
                找到 <span className="font-medium text-[var(--foreground)]">{stats.today?.today_infs || 0}</span> 位达人
              </span>
            </div>
          </div>

          {/* Per-creator */}
          {stats.byCreator && stats.byCreator.length > 0 && (
            <>
              <h2 className="text-sm font-medium text-[var(--foreground)] mb-3">成员统计</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {stats.byCreator.map((s: any) => (
                  <div key={s.creator} className="flex items-center justify-between rounded-lg bg-[var(--secondary)] px-3 py-2">
                    <div>
                      <span className="font-medium text-sm">{s.creator}</span>
                      <div className="text-xs text-[var(--muted-foreground)]">
                        累计 {s.total_tasks} 个任务 · {s.total_infs} 位达人
                        {s.today_tasks > 0 && <span className="ml-1 text-blue-500">+{s.today_tasks}今日</span>}
                      </div>
                    </div>
                    <div className={s.active_tasks > 0 ? "text-blue-600 text-xs font-medium" : "text-green-600 text-xs font-medium"}>
                      {s.active_tasks > 0 ? `${s.active_tasks} 进行中` : "全部完成"}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input placeholder="搜索任务编号、品类、创建人..." value={search} onChange={e => setSearch(e.target.value)} className="h-9 pl-8 text-sm" />
        </div>
        <div className="flex rounded-lg bg-[var(--secondary)] p-0.5">
          {[{ key: "all", label: "全部" }, { key: "active", label: "进行中" }, { key: "completed", label: "已提交" }].map(s => (
            <button key={s.key} onClick={() => setStatusFilter(s.key)}
              className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors",
                statusFilter === s.key ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]")}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Task list */}
      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(task => (
            <div key={task.id} className={cn(
              "rounded-xl border p-4 transition-all hover:shadow-sm",
              task.status === "completed" ? "border-green-200 dark:border-green-800 bg-green-50/20 dark:bg-green-950/10" : "border-[var(--border)] bg-[var(--background)]"
            )}>
              <div className="flex items-start justify-between">
                <Link href={`/agency/influencers/tasks/${task.id}`} className="font-medium text-sm hover:underline">
                  {task.task_number}
                </Link>
                <span className={cn(
                  "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                  task.status === "completed"
                    ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                    : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                )}>
                  {task.status === "completed" ? "已提交评估" : "进行中"}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
                {task.category && <span>{task.category}</span>}
                <span className="flex items-center gap-1"><Users className="size-3" />{task.inf_count || 0} 位达人</span>
                <span>{task.creator}</span>
              </div>
              <div className="mt-1 text-xs text-[var(--muted-foreground)] flex items-center gap-1">
                <Clock className="size-3" />
                {task.created_at ? new Date(task.created_at).toLocaleDateString("th-TH") : "-"}
                {task.completed_at && <span className="ml-2 text-green-600">→ {new Date(task.completed_at).toLocaleDateString("th-TH")}</span>}
              </div>

              {/* Actions */}
              <div className="mt-3 flex items-center gap-2">
                <Link href={`/agency/influencers/tasks/${task.id}`}>
                  <Button variant="outline" size="sm" className="h-7 text-xs">查看达人</Button>
                </Link>
                {task.status === "active" && (
                  <>
                    <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setConfirmSubmitId(task.id)}>
                      <Send className="size-3" />提交评估
                    </Button>
                    <button onClick={() => handleDelete(task.id)} className="text-[var(--muted-foreground)] hover:text-red-500">
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && filtered.length === 0 && (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无发现任务，点击"添加任务"开始</div>
      )}

      {/* Submit confirmation modal */}
      {confirmSubmitId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setConfirmSubmitId(null)}>
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-medium text-[var(--foreground)]">确认提交评估？</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              任务下所有达人将自动流转到 Ploy 的评估池，状态变为"评估中"。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmSubmitId(null)}>取消</Button>
              <Button size="sm" onClick={() => handleSubmitForEval(confirmSubmitId)}>确认提交</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
