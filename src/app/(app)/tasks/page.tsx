"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tasks, statusColumns, type TaskStatus } from "@/mock/tasks";
import type { Task } from "@/mock/tasks";
import { cn } from "@/lib/utils";

const priorityDot: Record<Task["priority"], string> = {
  low: "bg-[var(--muted-foreground)]/30",
  medium: "bg-[var(--info)]",
  high: "bg-[var(--destructive)]",
};

const columnTitles: Record<TaskStatus, string> = {
  pending: "待处理",
  in_progress: "进行中",
  completed: "已完成",
};

const columnBg: Record<TaskStatus, string> = {
  pending: "bg-[color-mix(in_oklch,var(--warning),var(--background)_95%)]",
  in_progress: "bg-[color-mix(in_oklch,var(--info),var(--background)_95%)]",
  completed: "bg-[color-mix(in_oklch,var(--success),var(--background)_95%)]",
};

export default function TasksPage() {
  const searchParams = useSearchParams();
  const businessFilter = searchParams.get("business");
  const [filter, setFilter] = useState<string>("all");

  const grouped = useMemo(() => {
    let taskList = tasks;
    if (businessFilter) {
      taskList = taskList.filter((t) => t.businessLine === businessFilter);
    }
    const result: Record<TaskStatus, Task[]> = { pending: [], in_progress: [], completed: [] };
    for (const task of taskList) {
      if (filter !== "all" && task.assignee !== filter) continue;
      result[task.status].push(task);
    }
    return result;
  }, [filter, businessFilter]);

  const assignees = useMemo(() => [...new Set(tasks.map((t) => t.assignee))], []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>
            {businessFilter ? `${businessFilter} · 任务` : "任务看板"}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">张三手上有 {tasks.filter(t => t.assignee === "张三").length} 件，别堆太多</p>
        </div>
        <Button size="sm" onClick={() => console.log("新建任务")}><Plus className="size-3.5" aria-hidden="true" />新建任务</Button>
      </div>

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

      {/* Kanban columns */}
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
                        <span className={cn("inline-block size-2 shrink-0 rounded-full", priorityDot[task.priority])} />
                        <p className="text-sm font-medium text-[var(--foreground)]">{task.title}</p>
                      </div>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)] line-clamp-2">{task.description}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-[var(--secondary)] px-1.5 py-0.5 text-xs text-[var(--secondary-foreground)]">{task.businessLine}</span>
                      {task.status === 'completed' && (
                        <span className="inline-flex size-4 items-center justify-center rounded-full bg-[var(--success)] text-[0.625rem] text-[var(--success-foreground)]">✓</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex size-6 items-center justify-center rounded-full bg-[var(--sidebar-accent)] text-xs font-medium text-[var(--sidebar-accent-foreground)]">
                        {task.assignee.slice(0, 1)}
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
    </div>
  );
}
