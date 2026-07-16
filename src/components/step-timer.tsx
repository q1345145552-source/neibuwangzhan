"use client";

import { useState, useEffect, useRef } from "react";
import { calcWorkSeconds, formatWorkSeconds } from "@/lib/work-hours";
import { cn } from "@/lib/utils";
import { Clock, Timer } from "lucide-react";

interface StepTimerProps {
  created_at: string;
  completed_at?: string | null;
  status?: string;
  className?: string;
  /** 上一环节完成时间，计时起点 = max(started_at, 上一步完成时间) */
  prev_completed_at?: string | null;
  /** 员工点"开始"的时间，替代 created_at 作为计时起点 */
  started_at?: string | null;
}

/**
 * 步骤计时器 — 秒级 HH:MM:SS 走字
 * - 计时起点 = 上一步的 completed_at（上一步未完成则不启动）
 * - 进行中/待处理：每秒走字
 * - 已完成：静态不动
 * - 撤回后 completed_at 清空 → 恢复走字
 */
export function StepTimer({ created_at, completed_at, status, prev_completed_at, started_at, className }: StepTimerProps) {
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isCompleted = status === "已完成" || (typeof completed_at === "string" && completed_at.length > 0);

  // 有效起点：必须有 started_at 才开始计时
  // 如果是第一步(started_at === created_at 作为 fallback)，用 started_at
  // 否则用 max(started_at, prev_completed_at)
  const effectiveStart = (started_at || prev_completed_at)
    ? (prev_completed_at && started_at && prev_completed_at > started_at ? prev_completed_at : (started_at || prev_completed_at))
    : null;

  // 交接间隔
  const handoverSec = effectiveStart && completed_at
    ? calcWorkSeconds(effectiveStart, completed_at)
    : 0;

  useEffect(() => {
    // 没开始就不计时
    if (!effectiveStart) {
      setSeconds(0);
      return;
    }

    const compute = () => {
      try {
        const end = (isCompleted && completed_at) ? completed_at : new Date().toISOString();
        setSeconds(calcWorkSeconds(effectiveStart, end));
      } catch {
        setSeconds(0);
      }
    };

    compute();

    if (!isCompleted) {
      intervalRef.current = setInterval(compute, 1000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [effectiveStart, completed_at, isCompleted]);

  // 未开始：灰色占位
  if (!effectiveStart) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[0.65rem] text-[var(--muted-foreground)]/40 font-mono tabular-nums", className)}>
        <Clock className="size-3" />
        待开始
      </span>
    );
  }

  return (
    <span className={cn("inline-flex flex-col gap-0.5 font-mono", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 tabular-nums tracking-tight",
          isCompleted
            ? "text-xs text-[var(--muted-foreground)]"
            : "text-sm font-medium text-[var(--foreground)]"
        )}
        title={isCompleted ? "本步耗时" : "计时中（周一至周六 08:00-17:00）"}
      >
        {isCompleted ? (
          <Clock className="size-3 text-[var(--muted-foreground)]" />
        ) : (
          <span className="relative inline-flex">
            <Timer className="size-3.5 text-emerald-500" />
            <span className="absolute -right-0.5 -top-0.5 flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
          </span>
        )}
        <span>{formatWorkSeconds(seconds)}</span>
      </span>
      {handoverSec > 0 && (
        <span className="inline-flex items-center gap-1 text-[0.65rem] text-[var(--muted-foreground)]/50 tabular-nums">
          <span className="inline-block w-3" />
          间隔 {formatWorkSeconds(handoverSec)}
        </span>
      )}
    </span>
  );
}

/**
 * 纯展示组件（列表/汇总页，不实时走字）
 */
export function StepTimerStatic({ created_at, completed_at, started_at, prev_completed_at }: StepTimerProps) {
  const effectiveStart = (started_at || prev_completed_at) || null;
  if (!effectiveStart) {
    return <span className="text-[0.65rem] text-[var(--muted-foreground)]/40">—</span>;
  }
  const elapsedSec = completed_at
    ? calcWorkSeconds(effectiveStart, completed_at)
    : calcWorkSeconds(effectiveStart, new Date().toISOString());
  const handoverSec = completed_at
    ? calcWorkSeconds(effectiveStart, completed_at)
    : 0;

  return (
    <span className={cn("inline-flex flex-col gap-0.5 font-mono text-xs tabular-nums text-[var(--muted-foreground)]")}>
      <span className="inline-flex items-center gap-1">
        <Clock className="size-3" />
        {formatWorkSeconds(elapsedSec)}
      </span>
      {handoverSec > 0 && (
        <span className="inline-flex items-center gap-1 text-[0.65rem] text-[var(--muted-foreground)]/60 tabular-nums">
          <span className="inline-block w-3" />
          间隔 {formatWorkSeconds(handoverSec)}
        </span>
      )}
    </span>
  );
}
