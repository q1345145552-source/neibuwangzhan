"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, FileText, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const payClass: Record<string, string> = {
  "未付": "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  "部分付": "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  "已付": "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
};

interface Contract {
  id: number;
  influencer_id: number;
  influencer_name: string;
  base_salary: string;
  commission: string;
  live_sessions: string;
  live_duration: string;
  video_count: string;
  contract_url: string;
  payment_status: string;
  start_date: string;
  end_date: string;
  notes: string;
  created_at: string;
}

function getOverdueLabel(createdAt: string): { label: string; cls: string } | null {
  if (!createdAt) return null;
  const created = new Date(createdAt);
  const now = new Date();
  const days = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
  if (days >= 5) return { label: "已超时", cls: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" };
  if (days >= 2) return { label: "需跟进", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" };
  return null;
}

function getOverdueRowClass(createdAt: string, paymentStatus: string): string {
  if (paymentStatus === "已付") return "";
  const overdue = getOverdueLabel(createdAt);
  if (!overdue) return "";
  if (overdue.label === "已超时") return "bg-red-50/50 dark:bg-red-950/20";
  return "bg-amber-50/50 dark:bg-amber-950/20";
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();
  const overdueFilter = searchParams.get("overdue");

  const load = async () => {
    try {
      const res = await fetch("/api/contracts", { cache: "no-store" });
      const data = await res.json();
      setContracts(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = contracts.filter((c) => {
    // Overdue filter from URL
    if (overdueFilter) {
      const overdue = getOverdueLabel(c.created_at);
      if (!overdue) return false;
      if (overdueFilter === "5" && overdue.label !== "已超时") return false;
      if (overdueFilter === "2" && overdue.label === "已超时") return false;
      if (overdueFilter === "2" && overdue.label !== "需跟进") return false;
    }
    if (!search) return true;
    const s = search.toLowerCase();
    return c.influencer_name?.toLowerCase().includes(s) || c.payment_status.includes(s);
  });

  const overdue2d = contracts.filter(c => {
    const o = getOverdueLabel(c.created_at);
    return o && o.label === "需跟进";
  }).length;
  const overdue5d = contracts.filter(c => {
    const o = getOverdueLabel(c.created_at);
    return o && o.label === "已超时";
  }).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">签约跟进</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            共 {contracts.length} 份签约
            {(overdue2d > 0 || overdue5d > 0) && (
              <span className="ml-2">
                {overdue5d > 0 && <span className="text-red-500 font-medium">{overdue5d} 个已超时</span>}
                {overdue5d > 0 && overdue2d > 0 && " · "}
                {overdue2d > 0 && <span className="text-amber-500 font-medium">{overdue2d} 个需跟进</span>}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input placeholder="搜索达人名称..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-8 text-sm" />
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">达人</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-md:hidden">底薪</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-md:hidden">佣金</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-lg:hidden">直播场次/时长</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-lg:hidden">视频数量</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-md:hidden">合同</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">付款</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">提醒</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const overdue = getOverdueLabel(c.created_at);
                const rowClass = getOverdueRowClass(c.created_at, c.payment_status);
                return (
                <tr key={c.id} className={cn("border-b border-[var(--border)] hover:bg-[var(--secondary)] transition-colors", rowClass)}>
                  <td className="py-3 px-4 font-medium text-[var(--foreground)]">{c.influencer_name || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{c.base_salary || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{c.commission || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-lg:hidden">
                    {c.live_sessions ? `${c.live_sessions}场` : "-"}{c.live_duration ? ` / ${c.live_duration}小时` : ""}
                  </td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-lg:hidden">{c.video_count || "-"}</td>
                  <td className="py-3 px-4 max-md:hidden">
                    {c.contract_url ? (
                      <a href={c.contract_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline">
                        <FileText className="size-3" />查看
                      </a>
                    ) : "-"}
                  </td>
                  <td className="py-3 px-4">
                    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", payClass[c.payment_status] || payClass["未付"])}>
                      {c.payment_status}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {overdue && c.payment_status !== "已付" ? (
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", overdue.cls)}>
                        {overdue.label === "已超时" ? <AlertCircle className="size-3" /> : <Clock className="size-3" />}
                        {overdue.label}
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--muted-foreground)]">—</span>
                    )}
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无签约数据</div>
          )}
        </div>
      )}
    </div>
  );
}
