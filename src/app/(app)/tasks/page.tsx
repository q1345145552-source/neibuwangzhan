"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { Plus, ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchTasks, createTask as apiCreateTask, updateTaskStatus, fetchAssignedSteps, deleteTask } from "@/lib/api";
import type { Task } from "@/lib/api";
import { cn } from "@/lib/utils";


const stepStatusColumns = [
  { key: "待处理" as const, label: "待处理" },
  { key: "进行中" as const, label: "进行中" },
  { key: "已完成" as const, label: "已完成" },
];
const statusColumns = [
  { key: "pending" as const, label: "待处理" },
  { key: "in_progress" as const, label: "进行中" },
  { key: "completed" as const, label: "已完成" },
];
const priorityDot: Record<string, string> = {
  low: "bg-[var(--muted-foreground)]/30",
  medium: "bg-[var(--info)]",
  high: "bg-[var(--destructive)]",
};

const columnTitles: Record<string, string> = {
  pending: "待处理",
  in_progress: "进行中",
  completed: "已完成",
};

const columnBg: Record<string, string> = {
  pending: "bg-[color-mix(in_oklch,var(--warning),var(--background)_95%)]",
  in_progress: "bg-[color-mix(in_oklch,var(--info),var(--background)_95%)]",
  completed: "bg-[color-mix(in_oklch,var(--success),var(--background)_95%)]",
};

export default function TasksPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isClient = user?.role === "client";
  const searchParams = useSearchParams();
  const businessFilter = searchParams.get("biz");
  const [filter, setFilter] = useState<string>("all");
  const [taskList, setTaskList] = useState<Task[]>([]);
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<{id:string,title:string}|null>(null);
  const [deletingTask, setDeletingTask] = useState(false);
  const [loading, setLoading] = useState(true);
  const [assignedSteps, setAssignedSteps] = useState<Array<{ orderId: string; stepName: string; status: string; businessType: string }>>([]);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchTasks(businessFilter ? { business: businessFilter } : undefined);
        setTaskList(data);

        // 加载当前用户的待办步骤
        if (user?.name) {
          const steps = await fetchAssignedSteps(user.name);
          setAssignedSteps(steps.map((s: { order_id: string; step_name: string; status: string; business_type_name: string }) => ({
            orderId: s.order_id,
            stepName: s.step_name,
            status: s.status,
            businessType: s.business_type_name,
          })));
        }
      } catch (err) {
        console.error("Tasks load error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [businessFilter]);

  const handleDeleteTask = async () => {
    if (!deleteTaskTarget) return;
    setDeletingTask(true);
    try {
      console.log("[删除任务]", deleteTaskTarget.id);
      await deleteTask(deleteTaskTarget.id);
      setTaskList(prev => prev.filter(t => t.id !== deleteTaskTarget.id));
      setDeleteTaskTarget(null);
    } catch (err) {
      console.error("[删除任务] 失败:", err);
    } finally {
      setDeletingTask(false);
    }
  };
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<Task["priority"]>("medium");
  const [newTaskBusinessLine, setNewTaskBusinessLine] = useState(businessFilter || "");

  const grouped = useMemo(() => {
    let sourceList = taskList;
    if (businessFilter) {
      sourceList = sourceList.filter((t) => t.business_line === businessFilter);
    }
    const result: Record<string, Task[]> = { pending: [], in_progress: [], completed: [] };
    for (const task of sourceList) {
      if (filter !== "all" && task.assignee !== filter) continue;
      result[task.status || "pending"].push(task);
    }
    return result;
  }, [filter, businessFilter, taskList]);

  const groupedSteps = useMemo(() => {
    const result: Record<string, typeof assignedSteps> = { "待处理": [], "进行中": [], "已完成": [] };
    for (const step of assignedSteps) {
      const status = step.status || "待处理";
      if (result[status]) result[status].push(step);
    }
    return result;
  }, [assignedSteps]);

  const assignees = useMemo(() => [...new Set(taskList.map((t) => t.assignee || ""))], [taskList]);
  const businessLines = useMemo(() => [...new Set(taskList.map((t) => t.business_line || ""))], [taskList]);

  const handleAddTask = () => {
    if (!newTaskTitle.trim() || !newTaskAssignee) return;
    const newTask: Task = {
      id: `TASK-${String(Date.now()).slice(-6)}`,
      title: newTaskTitle.trim(),
      description: "",
      assignee: newTaskAssignee,
      priority: newTaskPriority,
      status: "pending",
      business_line: businessFilter || newTaskBusinessLine,
      deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    };
    apiCreateTask(newTask).then(() => {
      setTaskList((prev) => [...prev, newTask]);
    });
    setShowNewForm(false);
    setNewTaskTitle("");
    setNewTaskAssignee("");
    setNewTaskPriority("medium");
    if (!businessFilter) setNewTaskBusinessLine("");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {businessFilter && (
            <Button variant="ghost" size="icon-sm" onClick={() => router.back()} aria-label="返回"><ArrowLeft className="size-4" /></Button>
          )}
          <div>
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>
              {businessFilter ? `${businessFilter} · 任务` : "任务看板"}
            </h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{user?.name || "用户"}手上有 {taskList.filter(t => t.assignee === (user?.name || "张三")).length} 件，别堆太多</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowNewForm((v) => !v)}><Plus className="size-3.5" aria-hidden="true" />{showNewForm ? "取消" : "新建任务"}</Button>
      </div>

      {showNewForm && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
          <h3 className="text-sm font-medium text-[var(--foreground)]">新建任务{businessFilter ? ` · ${businessFilter}` : ""}</h3>
          <div className="flex flex-wrap gap-3">
            <input
              placeholder="任务标题"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              className="flex-1 min-w-[200px] rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleAddTask(); }}
            />
            <select
              value={newTaskAssignee}
              onChange={(e) => setNewTaskAssignee(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20"
            >
              <option value="">选择负责人</option>
              {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select
              value={newTaskPriority}
              onChange={(e) => setNewTaskPriority(e.target.value as Task["priority"])}
              className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20"
            >
              <option value="low">低优先级</option>
              <option value="medium">中优先级</option>
              <option value="high">高优先级</option>
            </select>
            {!businessFilter && (
              <select
                value={newTaskBusinessLine}
                onChange={(e) => setNewTaskBusinessLine(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20"
              >
                <option value="">选择业务线</option>
                {businessLines.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={handleAddTask} className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_20%)] transition-colors">添加</button>
            <button onClick={() => { setShowNewForm(false); setNewTaskTitle(""); setNewTaskAssignee(""); setNewTaskPriority("medium"); if (!businessFilter) setNewTaskBusinessLine(""); }} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">取消</button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--muted-foreground)]">负责人:</span>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="按负责人筛选"
          className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20"
        >
          <option value="all">全部</option>
          {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>


      {/* 我的环节 */}
      <div className="rounded-xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted),var(--background)_50%)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-medium text-[var(--foreground)]">我的环节</h2>
          <span className="text-xs text-[var(--muted-foreground)]">{assignedSteps.length} 个环节</span>
        </div>
        {assignedSteps.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {stepStatusColumns.map((col) => {
              const colSteps = groupedSteps[col.key] || [];
              return (
                <div key={col.key} className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--card)]">
                  <div className={cn("flex items-center justify-between rounded-t-xl px-4 py-3", columnBg[col.key])}>
                    <h3 className="text-sm font-medium text-[var(--foreground)]">{col.label}</h3>
                    <span className="inline-flex size-5 items-center justify-center rounded-full bg-[var(--muted)] text-xs font-mono tabular-nums text-[var(--muted-foreground)]">{colSteps.length}</span>
                  </div>
                  <div className="flex flex-col gap-2 px-3 pb-3">
                    {colSteps.map((item, i) => (
                      <button
                        key={i}
                        onClick={() => router.push(`/orders/${item.orderId}`)}
                        className="flex flex-col gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-left transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-[var(--primary)]">{item.orderId}</span>
                          <span className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-[0.625rem] font-medium",
                            item.status === "进行中" ? "bg-[color-mix(in_oklch,var(--info),var(--background)_85%)] text-[var(--info)]" :
                            item.status === "阻塞" ? "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[var(--destructive)]" :
                            item.status === "已完成" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]" :
                            "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]"
                          )}>{item.status}</span>
                        </div>
                        <p className="text-sm text-[var(--foreground)] truncate">{item.stepName}</p>
                        <span className="text-xs text-[var(--muted-foreground)]">{item.businessType}</span>
                      </button>
                    ))}
                    {colSteps.length === 0 && (
                      <div className="py-8 text-center text-xs text-[var(--muted-foreground)]">暂无环节</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无分配的环节</p>
        )}
      </div>

      {/* 看板分隔 */}
      <div className="h-px bg-[var(--border)]" />

      {/* 任务看板 */}

      <div className="grid gap-4 lg:grid-cols-3">
        {statusColumns.map((col) => {
          const colTasks = grouped[col.key];
          return (
            <div key={col.key} className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--card)]">
              <div className={cn("flex items-center justify-between rounded-t-xl px-4 py-3", columnBg[col.key])}>
                <h3 className="text-sm font-medium text-[var(--foreground)]">{columnTitles[col.key]}</h3>
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-[var(--muted)] text-xs font-mono tabular-nums text-[var(--muted-foreground)]">
                  {colTasks.length}
                </span>
              </div>
              <div className="flex flex-col gap-2 px-3 pb-3">
                {colTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={cn("inline-block size-2 shrink-0 rounded-full", priorityDot[task.priority || "medium"])} />
                        <p className="text-sm font-medium text-[var(--foreground)]">{task.title}</p>
                      </div>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)] line-clamp-2">{task.description}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-[var(--secondary)] px-1.5 py-0.5 text-xs text-[var(--secondary-foreground)]">{task.business_line}</span>
                      {task.status === 'completed' && (
                        <span className="inline-flex size-4 items-center justify-center rounded-full bg-[var(--success)] text-[0.625rem] text-[var(--success-foreground)]">✓</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex size-6 items-center justify-center rounded-full bg-[var(--sidebar-accent)] text-xs font-medium text-[var(--sidebar-accent-foreground)]">
                          {(task.assignee || "").slice(0, 1)}
                        </div>
                        {!isClient && (
                          <button onClick={() => setDeleteTaskTarget({id: task.id, title: task.title})} className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] transition-colors" title="删除任务"><Trash2 className="size-3" /></button>
                        )}
                      </div>
                      <span className="font-mono text-xs tabular-nums text-[var(--muted-foreground)]">{task.deadline}</span>
                    </div>
                  </div>
                ))}
                {colTasks.length === 0 && (
                  <div className="py-8 text-center text-xs text-[var(--muted-foreground)]">暂无任务</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 删除任务确认弹窗 */}
      {deleteTaskTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteTaskTarget(null)}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-[var(--foreground)]">确认删除任务</h3>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              确定要删除任务「{deleteTaskTarget.title}」吗？此操作不可恢复。
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setDeleteTaskTarget(null)} disabled={deletingTask} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50">取消</button>
              <button onClick={handleDeleteTask} disabled={deletingTask} className="rounded-lg bg-[var(--destructive)] px-4 py-2 text-sm font-medium text-white hover:bg-[color-mix(in_oklch,var(--destructive),var(--foreground)_20%)] transition-colors disabled:opacity-50">
                {deletingTask ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
