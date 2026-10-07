"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { LeaveDashboardTab } from "./dashboard-tab";
import { LeaveAnalysisTab } from "./analysis-tab";

export default function LeavePage() {
  const [tab, setTab] = useState<"dashboard" | "analysis">("dashboard");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">请假</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">请假看板与 AI 分析</p>
      </div>

      {/* Tab 切换 */}
      <div className="inline-flex w-fit rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-0.5">
        <button
          onClick={() => setTab("dashboard")}
          className={cn(
            "rounded px-4 py-1.5 text-sm font-medium transition-colors",
            tab === "dashboard"
              ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          )}
        >看板</button>
        <button
          onClick={() => setTab("analysis")}
          className={cn(
            "rounded px-4 py-1.5 text-sm font-medium transition-colors",
            tab === "analysis"
              ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          )}
        >AI分析</button>
      </div>

      {tab === "dashboard" ? <LeaveDashboardTab /> : <LeaveAnalysisTab />}
    </div>
  );
}
