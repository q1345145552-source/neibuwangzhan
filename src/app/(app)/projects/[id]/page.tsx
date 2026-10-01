"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { fetchWithAuth } from "@/lib/api";
import { cn, toThaiTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface ProgressItem {
  id: number;
  content: string;
  created_by: string;
  created_at: string;
}

interface SummaryItem {
  id: number;
  phase: string;
  conclusion: string;
  lesson: string;
  adjustment: string;
  created_by: string;
  created_at: string;
}

interface ProjectDetail {
  id: number;
  name: string;
  description: string;
  assignee: string;
  current_phase: string;
  status: string;
  created_by: string;
  created_at: string;
  progress: ProgressItem[];
  summaries: SummaryItem[];
}

const PHASE_CLASS: Record<string, string> = {
  "构思": "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  "执行": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "里程碑": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  "收益": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
};

const STATUS_CLASS: Record<string, string> = {
  "孵化中": "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  "已孵化为业务线": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  "已搁置": "bg-[var(--muted)] text-[var(--muted-foreground)]",
};

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth(`/api/projects/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) setProject(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</div>;
  if (!project) return <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">项目不存在</div>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link href="/projects">
          <Button variant="ghost" size="icon-sm" aria-label="返回"><ArrowLeft className="size-4" /></Button>
        </Link>
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">{project.name}</h1>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASS[project.status] || "bg-[var(--muted)]")}>{project.status}</span>
            <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", PHASE_CLASS[project.current_phase] || "bg-slate-100 text-slate-600")}>{project.current_phase}</span>
          </div>
        </div>
      </div>

      {/* 基本信息 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">基本信息</h3>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div><dt className="text-xs text-[var(--muted-foreground)]">项目名称</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{project.name}</dd></div>
          <div><dt className="text-xs text-[var(--muted-foreground)]">负责人</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{project.assignee || "—"}</dd></div>
          <div><dt className="text-xs text-[var(--muted-foreground)]">当前阶段</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{project.current_phase || "—"}</dd></div>
          <div><dt className="text-xs text-[var(--muted-foreground)]">创建时间</dt><dd className="mt-1 text-sm text-[var(--foreground)]">{toThaiTime(project.created_at) || "—"}</dd></div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-[var(--muted-foreground)]">项目想法描述</dt>
            <dd className="mt-1 text-sm text-[var(--foreground)]">{project.description || "—"}</dd>
          </div>
        </dl>
      </div>

      {/* 进展历史 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">进展历史</h3>
        {project.progress.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">暂无进展记录</p>
        ) : (
          <div className="space-y-3">
            {project.progress.map((g) => (
              <div key={g.id} className="rounded-md border border-[var(--border)] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[var(--foreground)]">{g.created_by}</span>
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{toThaiTime(g.created_at) || "—"}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--foreground)]">{g.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 各阶段总结 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">阶段总结</h3>
        {project.summaries.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">暂无阶段总结</p>
        ) : (
          <div className="space-y-3">
            {project.summaries.map((s) => (
              <div key={s.id} className="rounded-md border border-[var(--border)] px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", PHASE_CLASS[s.phase] || "bg-slate-100 text-slate-600")}>{s.phase}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">{s.created_by} · {toThaiTime(s.created_at) || "—"}</span>
                </div>
                {s.conclusion && <p className="mt-2 text-sm text-[var(--foreground)]"><span className="text-xs text-[var(--muted-foreground)]">阶段结论：</span>{s.conclusion}</p>}
                {s.lesson && <p className="mt-1 text-sm text-[var(--foreground)]"><span className="text-xs text-[var(--muted-foreground)]">经验教训：</span>{s.lesson}</p>}
                {s.adjustment && <p className="mt-1 text-sm text-[var(--foreground)]"><span className="text-xs text-[var(--muted-foreground)]">方向调整：</span>{s.adjustment}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
