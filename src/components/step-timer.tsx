"use client";

import { useState, useEffect, useRef } from "react";
import { calcWorkHours, formatWorkHours, isWorkingHours } from "@/lib/work-hours";
import { cn } from "@/lib/utils";
import { Clock } from "lucide-react";

interface StepTimerProps {
  created_at: string;
  completed_at?: string | null;
  deadline_hours?: number; // 预估工作小时数
  status?: string;
  className?: string;
}

/**
 * 步骤计时器组件
 * - 进行中：每秒更新，计算 created_at → now 的工作小时
 * - 已完成：计算 created_at → completed_at 的工作小时（不更新）
 * - 超时数字变红
 */
export function StepTimer({ created_at, completed_at, deadline_hours, status, className }: StepTimerProps) {
  const [elapsed, setElapsed] = useState(0);
  const isCompleted = status === "已完成" || !!completed_at;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const compute = () => {
      try {
        if (isCompleted && completed_at) {
          setElapsed(calcWorkHours(created_at, completed_at));
        } else {
          setElapsed(calcWorkHours(created_at, new Date().toISOString()));
        }
      } catch {
        setElapsed(0);
      }
    };

    compute();

    // 进行中步骤：在工作时间内每秒更新
    if (!isCompleted) {
      intervalRef.current = setInterval(() => {
        compute();
      }, 1000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [created_at, completed_at, isCompleted]);

  const isOverdue = deadline_hours !== undefined && deadline_hours > 0 && elapsed > deadline_hours;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs tabular-nums",
        isOverdue ? "text-[var(--destructive)] font-semibold" : "text-[var(--muted-foreground)]",
        className
      )}
      title={isCompleted ? "实际用时（工作小时）" : "已用工作小时"}
    >
      <Clock className="size-3" />
      {formatWorkHours(elapsed)}
      {isOverdue && deadline_hours !== undefined && (
        <span className="text-[var(--destructive)]"> / 超 {formatWorkHours(elapsed - deadline_hours)}</span>
      )}
    </span>
  );
}

/**
 * 纯展示组件（不实时更新，用于列表页）
 */
export function StepTimerStatic({ created_at, completed_at, deadline_hours }: StepTimerProps) {
  const elapsed = completed_at
    ? calcWorkHours(created_at, completed_at)
    : calcWorkHours(created_at, new Date().toISOString());
  const isOverdue = deadline_hours !== undefined && deadline_hours > 0 && elapsed > deadline_hours;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs tabular-nums",
        isOverdue ? "text-[var(--destructive)] font-semibold" : "text-[var(--muted-foreground)]"
      )}
      title={completed_at ? "实际用时（工作小时）" : "已用工作小时"}
    >
      <Clock className="size-3" />
      {formatWorkHours(elapsed)}
    </span>
  );
}
