"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Plus, ExternalLink, Sparkles, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { startPhase } from "@/lib/api";

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
  "已入池": "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
};

const phaseLabelMap: Record<string, string> = {
  "completed_discovery": "已入池，待签约",
  "completed_contract": "签约已完成",
  "completed_incubation": "孵化已完成",
};

const tabs = [
  { key: "discovery", label: "达人发现" },
  { key: "incubation", label: "品牌孵化" },
];

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
  phase: string;
  created_at: string;
}

export default function InfluencersPage() {
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("discovery");
  const [startingPhases, setStartingPhases] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/influencers?phase=${activeTab}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      setInfluencers(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [activeTab]);

  useEffect(() => { load(); }, [load]);

  const handleStartPhase = async (influencerId: number, phase: string) => {
    setStartingPhases(p => ({ ...p, [influencerId]: true }));
    try {
      await startPhase(influencerId, phase);
      load();
    } catch (err) {
      console.error(err);
    }
    setStartingPhases(p => ({ ...p, [influencerId]: false }));
  };

  const filtered = influencers.filter((i) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return i.name.toLowerCase().includes(s) || i.category.toLowerCase().includes(s) || i.contact.toLowerCase().includes(s);
  });

  const getDisplayStatus = (inf: Influencer) => {
    if (inf.phase === "completed_discovery") return "已入池";
    if (inf.phase === "completed_contract") return "签约已完成";
    if (inf.phase === "completed_incubation") return "孵化已完成";
    return inf.status;
  };

  const getDisplayLabel = (inf: Influencer) => {
    if (activeTab === "incubation" && inf.phase === "completed_discovery") return "已入池，可孵化";
    if (activeTab === "incubation" && inf.phase === "completed_contract") return "已入池，可孵化";
    if (activeTab === "incubation" && (inf.phase === "incubation" || inf.phase === "completed_incubation")) return phaseLabelMap[inf.phase] || "";
    return "";
  };

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

      {/* Phase tabs */}
      <div className="flex gap-1 rounded-lg bg-[var(--secondary)] p-1 w-fit">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setSearch(""); }}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
              activeTab === tab.key
                ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            {tab.label}
          </button>
        ))}
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
                {(activeTab === "incubation") && (
                  <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">操作</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((inf) => (
                <tr key={inf.id} className="border-b border-[var(--border)] hover:bg-[var(--secondary)] transition-colors">
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
                    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[getDisplayStatus(inf)] || statusClass["待评估"])}>
                      {getDisplayStatus(inf)}
                    </span>
                    {getDisplayLabel(inf) && (
                      <span className="ml-2 text-xs text-[var(--muted-foreground)]">{getDisplayLabel(inf)}</span>
                    )}
                  </td>
                  {activeTab === "incubation" && (
                    <td className="py-3 px-4">
                      {(inf.phase === "completed_discovery" || inf.phase === "completed_contract") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          onClick={() => handleStartPhase(inf.id, "incubation")}
                          disabled={startingPhases[inf.id]}
                        >
                          <Sparkles className="size-3" />
                          {startingPhases[inf.id] ? "启动中..." : "开始孵化"}
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
              {activeTab === "discovery" ? "暂无发现阶段的达人" : "暂无可孵化的达人"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
