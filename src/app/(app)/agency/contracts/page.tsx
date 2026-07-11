"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, ExternalLink, FileText } from "lucide-react";
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

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

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
    if (!search) return true;
    const s = search.toLowerCase();
    return c.influencer_name?.toLowerCase().includes(s) || c.payment_status.includes(s);
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">签约跟进</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            共 {contracts.length} 份签约
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
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)] hover:bg-[var(--secondary)] transition-colors">
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
                </tr>
              ))}
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
