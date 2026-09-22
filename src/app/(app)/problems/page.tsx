"use client";

import { useState, useEffect } from "react";
import { fetchWithAuth } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Problem {
  id: number;
  problem_number: string;
  company_name: string;
  problem_type: string;
  status: string;
  assignee: string;
  priority: string;
  description: string;
  created_by: string;
  created_at: string;
}

const STATUS_CLASS: Record<string, string> = {
  "待处理": "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  "跟进中": "bg-[color-mix(in_oklch,var(--info),var(--background)_85%)] text-[oklch(0.38_0.10_240)]",
  "已解决": "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  "老板验收": "bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] text-[var(--primary)]",
  "搁置": "bg-[var(--muted)] text-[var(--muted-foreground)]",
};

export default function ProblemsPage() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/problems", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setProblems(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">问题跟踪</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">跟踪客户各类问题，紧急问题优先处理</p>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</div>
      ) : problems.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无问题</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--secondary)]/50">
                <th className="py-3 px-5 text-left text-xs font-medium text-[var(--muted-foreground)]">问题编号</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">公司名</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">问题类型</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">状态</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">负责人</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">紧急程度</th>
              </tr>
            </thead>
            <tbody>
              {problems.map((p) => (
                <tr key={p.id} className={cn("border-b border-[var(--border)]", p.priority === "紧急" && "bg-red-50/60 dark:bg-red-950/20")}>
                  <td className="py-3 px-5 font-mono font-medium text-[var(--foreground)]">{p.problem_number}</td>
                  <td className="py-3 px-4 text-[var(--foreground)]">{p.company_name}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)]">{p.problem_type}</td>
                  <td className="py-3 px-4">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASS[p.status] || "bg-[var(--muted)] text-[var(--muted-foreground)]")}>{p.status}</span>
                  </td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)]">{p.assignee || "—"}</td>
                  <td className="py-3 px-4">
                    {p.priority === "紧急" ? (
                      <span className="inline-flex rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">紧急</span>
                    ) : (
                      <span className="text-xs text-[var(--muted-foreground)]">普通</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
