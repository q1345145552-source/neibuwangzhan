"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Upload, Download, FileText } from "lucide-react";
import { documents } from "@/mock/documents";
import { cn } from "@/lib/utils";

const statusClass: Record<string, string> = {
  approved: "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  pending: "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  rejected: "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]",
};

const statusLabel: Record<string, string> = {
  approved: "已审核",
  pending: "待审核",
  rejected: "已驳回",
};

export default function DocumentsPage() {
  const [search, setSearch] = useState("");
  const [businessFilter, setBusinessFilter] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("currentBusinessFilter");
    if (stored) {
      setBusinessFilter(stored);
      localStorage.removeItem("currentBusinessFilter");
    }
  }, []);

  const filtered = useMemo(() => {
    let result = documents;
    if (businessFilter) {
      result = result.filter((d) => d.businessLine === businessFilter);
    }
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(s) ||
          d.businessLine.toLowerCase().includes(s) ||
          d.uploadBy.toLowerCase().includes(s)
      );
    }
    return result;
  }, [search, businessFilter]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>
            {businessFilter ? `${businessFilter} · 文档` : "文档管理"}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">合同、资质、报告都在这儿，别弄丢了</p>
        </div>
        <Button size="sm" onClick={() => console.log("上传文档")}><Upload className="size-3.5" aria-hidden="true" />上传文档</Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input
          placeholder="搜索文档名、业务线..."
          aria-label="搜索文档"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 pl-8 text-sm"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">文档名称</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">类型</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">业务线</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">上传人</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-sm:hidden">日期</th>
              <th className="py-3 px-4 text-right text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-sm:hidden">大小</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">状态</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide w-16"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((doc) => (
              <tr key={doc.id} className="border-b border-[var(--border)] transition-colors hover:bg-[var(--secondary)]">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <FileText className="size-3.5 shrink-0 text-[var(--muted-foreground)]" />
                    <span className="truncate font-medium text-[var(--foreground)]">{doc.name}</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{doc.type}</td>
                <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{doc.businessLine}</td>
                <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{doc.uploadBy}</td>
                <td className="py-3 px-4 font-mono text-xs tabular-nums text-[var(--muted-foreground)] max-sm:hidden">{doc.uploadDate}</td>
                <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-[var(--muted-foreground)] max-sm:hidden">{doc.size}</td>
                <td className="py-3 px-4">
                  <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[doc.status])}>
                    {statusLabel[doc.status]}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <Button variant="ghost" size="icon-xs" aria-label="下载文档" onClick={() => console.log("下载", doc.name)}>
                    <Download className="size-3.5" aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">没有匹配的文档</div>
        )}
      </div>
    </div>
  );
}
