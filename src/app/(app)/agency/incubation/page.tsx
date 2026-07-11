"use client";

import { useRouter } from "next/navigation";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Sparkles, Play, ExternalLink, ArrowLeft, Building } from "lucide-react";
import { cn } from "@/lib/utils";
import { startPhase } from "@/lib/api";

const statusClass: Record<string, string> = {
  "已入池": "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  "孵化中": "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300",
  "孵化已完成": "bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200",
};

interface Influencer {
  id: number; name: string; phase: string; status: string; category: string;
  tiktok_link: string; contact_phone: string; followers: string; gmv_range: string; created_at: string;
}

export default function IncubationPage() {
  const router = useRouter();
  const [pool, setPool] = useState<Influencer[]>([]);
  const [active, setActive] = useState<Influencer[]>([]);
  const [completed, setCompleted] = useState<Influencer[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [startingPhases, setStartingPhases] = useState<Record<number, boolean>>({});
  const [factories, setFactories] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // incubation phase filter already includes completed_discovery + contract + incubation
      const res = await fetch("/api/influencers?phase=incubation", { cache: "no-store" });
      const all = await res.json() as Influencer[];
      setPool(all.filter(i => i.phase === "completed_discovery" || i.phase === "completed_contract"));
      setActive(all.filter(i => i.phase === "incubation"));
      setCompleted(all.filter(i => i.phase === "completed_incubation"));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/factories", { cache: "no-store" })
      .then(r => r.json()).then(d => setFactories(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const handleStartIncubation = async (influencerId: number) => {
    setStartingPhases(p => ({ ...p, [influencerId]: true }));
    try {
      await startPhase(influencerId, "incubation");
      load();
    } catch (err) { console.error(err); }
    setStartingPhases(p => ({ ...p, [influencerId]: false }));
  };

  const filterList = (list: Influencer[]) => {
    if (!search) return list;
    const s = search.toLowerCase();
    return list.filter(i => i.name.toLowerCase().includes(s) || i.category.toLowerCase().includes(s));
  };

  if (loading) return <div className="py-20 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.push("/agency")}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)] flex items-center gap-2">
              <Sparkles className="size-5 text-amber-500" />品牌孵化
            </h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              已入池 {pool.length} 位 · 孵化中 {active.length} 位 · 已完成 {completed.length} 位
            </p>
          </div>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input placeholder="搜索达人名称、品类..." value={search} onChange={e => setSearch(e.target.value)} className="h-9 pl-8 text-sm" />
      </div>

      {/* Pool: ready for incubation */}
      {pool.length > 0 && (
        <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/30 dark:bg-teal-950/10 p-4">
          <h2 className="text-sm font-medium text-teal-700 dark:text-teal-400 mb-3 flex items-center gap-2">
            <Play className="size-3.5" />已入池，待孵化 ({pool.length})
          </h2>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--background)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="py-2.5 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">达人</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-md:hidden">品类</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-lg:hidden">粉丝量</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">来源</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">操作</th>
                </tr>
              </thead>
              <tbody>
                {filterList(pool).map(inf => (
                  <tr key={inf.id} className="border-b border-[var(--border)] hover:bg-[var(--secondary)] transition-colors">
                    <td className="py-2.5 px-4">
                      <Link href={`/agency/influencers/${inf.id}`} className="font-medium hover:underline">
                        {inf.name}
                      </Link>
                    </td>
                    <td className="py-2.5 px-4 text-[var(--muted-foreground)] max-md:hidden">{inf.category || "-"}</td>
                    <td className="py-2.5 px-4 text-[var(--muted-foreground)] max-lg:hidden">{inf.followers || "-"}</td>
                    <td className="py-2.5 px-4">
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {inf.phase === "completed_contract" ? "签约完成" : "发现完成"}
                      </span>
                    </td>
                    <td className="py-2.5 px-4">
                      <Button size="sm" className="h-7 text-xs gap-1"
                        onClick={() => handleStartIncubation(inf.id)}
                        disabled={startingPhases[inf.id]}>
                        <Sparkles className="size-3" />
                        {startingPhases[inf.id] ? "启动中..." : "开始孵化"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Active incubation */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium text-[var(--foreground)]">孵化中 ({filterList(active).length})</h2>
        </div>
        {filterList(active).length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无孵化中的达人</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="py-2.5 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">达人</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-md:hidden">品类</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-lg:hidden">粉丝量</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">状态</th>
                </tr>
              </thead>
              <tbody>
                {filterList(active).map(inf => (
                  <tr key={inf.id} className="border-b border-[var(--border)] hover:bg-[var(--secondary)] transition-colors">
                    <td className="py-2.5 px-4">
                      <Link href={`/agency/influencers/${inf.id}`} className="font-medium hover:underline">
                        {inf.name}
                      </Link>
                    </td>
                    <td className="py-2.5 px-4 text-[var(--muted-foreground)] max-md:hidden">{inf.category || "-"}</td>
                    <td className="py-2.5 px-4 text-[var(--muted-foreground)] max-lg:hidden">{inf.followers || "-"}</td>
                    <td className="py-2.5 px-4">
                      <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300">
                        孵化中
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Completed */}
      {completed.length > 0 && (
        <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50/20 dark:bg-green-950/10">
          <div className="px-4 py-3 border-b border-green-200 dark:border-green-800">
            <h2 className="text-sm font-medium text-green-700 dark:text-green-400">孵化已完成 ({completed.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {completed.map(inf => (
                  <tr key={inf.id} className="border-b border-green-200 dark:border-green-800 hover:bg-[var(--secondary)] transition-colors">
                    <td className="py-2.5 px-4">
                      <Link href={`/agency/influencers/${inf.id}`} className="font-medium hover:underline">{inf.name}</Link>
                    </td>
                    <td className="py-2.5 px-4 text-[var(--muted-foreground)] max-md:hidden">{inf.category || "-"}</td>
                    <td className="py-2.5 px-4">
                      <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                        已完成
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Factory Management */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Building className="size-4 text-amber-500" />工厂管理
          </h2>
          <Link href="/agency/factories">
            <Button variant="outline" size="sm" className="h-7 text-xs">管理工厂</Button>
          </Link>
        </div>
        {factories.length === 0 ? (
          <div className="py-6 text-center text-sm text-[var(--muted-foreground)]">
            暂无工厂数据。<br/>
            <span className="text-xs">工厂可在达人详情页中关联到具体达人。</span>
          </div>
        ) : (
          <div className="px-4 py-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {factories.slice(0, 6).map((f: any) => (
              <div key={f.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{f.name}</span>
                  {f.category && <span className="ml-2 text-xs text-[var(--muted-foreground)]">{f.category}</span>}
                </div>
                <Link href={`/agency/factories/${f.id}`}>
                  <Button variant="ghost" size="sm" className="h-6 text-xs">查看</Button>
                </Link>
              </div>
            ))}
            {factories.length > 6 && (
              <div className="flex items-center justify-center text-xs text-[var(--muted-foreground)]">
                <Link href="/agency/factories" className="hover:underline">+{factories.length - 6} 家工厂</Link>
              </div>
            )}
          </div>
        )}
      </div>

      {pool.length === 0 && active.length === 0 && completed.length === 0 && (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)] rounded-xl border border-dashed border-[var(--border)]">
          暂无孵化相关达人。<br/>达人发现完成后会自动出现在这里。
        </div>
      )}
    </div>
  );
}
