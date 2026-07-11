"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Plus, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const statusClass: Record<string, string> = {
  "待评估": "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  "评估中": "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  "已评估": "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  "已推荐给老板": "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  "已联系": "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  "签约中": "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  "已签约": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  "品牌孵化中": "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300",
  "已完成": "bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200",
  "已停止": "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

interface Influencer {
  id: number;
  name: string;
  tiktok_link: string;
  category: string;
  contact: string;
  contact_phone: string;
  followers: string;
  avg_views: string;
  gmv_range: string;
  notes: string;
  status: string;
  created_at: string;
}

export default function InfluencersPage() {
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await fetch("/api/influencers", { cache: "no-store" });
      const data = await res.json();
      setInfluencers(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = influencers.filter((i) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return i.name.toLowerCase().includes(s) || i.category.toLowerCase().includes(s) || i.contact.toLowerCase().includes(s);
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">达人管理</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            共 {influencers.length} 位达人
          </p>
        </div>
        <Link href="/agency/influencers/new">
          <Button size="sm"><Plus className="size-3.5" />添加达人</Button>
        </Link>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input placeholder="搜索达人名称、品类..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-8 text-sm" />
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">达人名称</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-md:hidden">品类</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-lg:hidden">粉丝量</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-lg:hidden">GMV区间</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-md:hidden">联系方式</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">状态</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inf) => (
                <tr key={inf.id} className="border-b border-[var(--border)] hover:bg-[var(--secondary)] transition-colors cursor-pointer" onClick={() => { /* handled by Link in name cell */ }}>
                  <td className="py-3 px-4">
                    <Link href={`/agency/influencers/${inf.id}`} className="flex items-center gap-2 hover:underline">
                      <span className="font-medium text-[var(--foreground)]">{inf.name}</span>
                    </Link>
                    {inf.tiktok_link && (
                      <a href={inf.tiktok_link} target="_blank" rel="noopener noreferrer" className="inline-flex text-[var(--muted-foreground)] hover:text-[var(--primary)] ml-1" onClick={e => e.stopPropagation()}>
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                  </td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{inf.category || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-lg:hidden">{inf.followers || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-lg:hidden">{inf.gmv_range || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">
                    {inf.contact ? `${inf.contact}${inf.contact_phone ? ` / ${inf.contact_phone}` : ""}` : "-"}
                  </td>
                  <td className="py-3 px-4">
                    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[inf.status] || statusClass["待评估"])}>
                      {inf.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无达人数据</div>
          )}
        </div>
      )}
    </div>
  );
}
