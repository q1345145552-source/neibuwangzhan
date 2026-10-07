"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { LeaveDashboardTab } from "./dashboard-tab";
import { LeaveAnalysisTab } from "./analysis-tab";
import { LeaveSubmitTab } from "./submit-tab";

type LeaveTab = "dashboard" | "analysis" | "submit";

export default function LeavePage() {
  const { user } = useAuth();
  // 员工默认进「提交请假」，管理员/老板默认进「看板」
  const [tab, setTab] = useState<LeaveTab>(user?.role === "admin" ? "dashboard" : "submit");

  const tabs: { key: LeaveTab; label: string }[] = [
    { key: "dashboard", label: "看板" },
    { key: "analysis", label: "AI分析" },
    { key: "submit", label: "提交请假" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">请假</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">请假看板、AI 分析与提交请假</p>
      </div>

      {/* Tab 切换 */}
      <div className="inline-flex w-fit rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-0.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded px-4 py-1.5 text-sm font-medium transition-colors",
              tab === t.key
                ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >{t.label}</button>
        ))}
      </div>

      {tab === "dashboard" ? <LeaveDashboardTab /> : tab === "analysis" ? <LeaveAnalysisTab /> : <LeaveSubmitTab />}
    </div>
  );
}
