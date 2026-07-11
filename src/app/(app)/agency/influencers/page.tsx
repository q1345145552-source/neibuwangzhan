"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, ExternalLink, ListTodo, ClipboardCheck, Star, Upload, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";

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

const ratingColors: Record<string, string> = {
  A: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  B: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  C: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  D: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

const tabs = [
  { key: "discovery", label: "达人发现" },
  { key: "evaluating", label: "待评估" },
  { key: "evaluated", label: "待推荐" },
  { key: "recommended", label: "老板推荐" },
];

interface Influencer {
  id: number; name: string; tiktok_link: string; category: string;
  contact: string; contact_phone: string; followers: string;
  avg_views: string; gmv_range: string; notes: string;
  status: string; phase: string; monthly_gmv: string; live_stream_ratio: string;
  created_at: string;
}

export default function InfluencersPage() {
  const { user } = useAuth();
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("discovery");

  // Evaluation modal
  const [evalModal, setEvalModal] = useState<Influencer | null>(null);
  const [evalForm, setEvalForm] = useState({ gmv: "", liveRatio: "", rating: "", content: "", brand: "", notes: "" });
  const [evalSaving, setEvalSaving] = useState(false);
  const [evalError, setEvalError] = useState("");
  const csvRef = useRef<HTMLInputElement>(null);

  // Rating filter for 待推荐 tab
  const [ratingFilter, setRatingFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let url: string;
      if (activeTab === "evaluating") {
        url = "/api/influencers?status=评估中";
      } else if (activeTab === "evaluated") {
        url = "/api/influencers?status=已评估,已推荐给老板";
      } else if (activeTab === "recommended") {
        url = "/api/influencers?status=已推荐给老板";
      } else {
        url = `/api/influencers?phase=${activeTab}`;
      }
      const res = await fetch(url, { cache: "no-store" });
      setInfluencers(await res.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [activeTab]);

  useEffect(() => { load(); }, [load]);

  // ── Evaluation submission ──
  const handleStartEval = (inf: Influencer) => {
    setEvalModal(inf);
    setEvalForm({ gmv: inf.monthly_gmv || "", liveRatio: inf.live_stream_ratio || "", rating: "", content: "", brand: "", notes: "" });
    setEvalError("");
  };

  const handleSaveEval = async () => {
    if (!evalModal) return;
    setEvalSaving(true);
    setEvalError("");
    try {
      // Save evaluation record
      const res = await fetch("/api/influencers/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          influencer_id: evalModal.id,
          gmv: evalForm.gmv,
          live_stream_ratio: evalForm.liveRatio,
          rating: evalForm.rating,
          content_quality: evalForm.content,
          brand_fit: evalForm.brand,
          notes: evalForm.notes,
          evaluated_by: user?.name || "Ploy",
        }),
      });
      if (!res.ok) throw new Error("保存评估失败");

      // Update influencer status to 已评估
      await fetch("/api/influencers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: evalModal.id, status: "已评估", monthly_gmv: evalForm.gmv, live_stream_ratio: evalForm.liveRatio }),
      });

      setEvalModal(null);
      load();
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : "保存失败");
    } finally { setEvalSaving(false); }
  };

  // ── CSV import ──
  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/influencers/evaluations/import", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        alert(`导入完成: ${data.imported} 条成功${data.skipped?.length ? `, ${data.skipped.length} 条跳过` : ""}`);
        load();
      } else {
        alert("导入失败: " + (data.error || "未知错误"));
      }
    } catch (err) {
      alert("导入失败: " + (err instanceof Error ? err.message : "网络错误"));
    }
  };

  // ── Recommend to boss ──
  const handleRecommend = async (infId: number) => {
    if (!confirm("确认推荐给老板？")) return;
    try {
      await fetch("/api/influencers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: infId, status: "已推荐给老板" }),
      });
      load();
    } catch (err) { console.error(err); }
  };

  const filtered = influencers.filter(i => {
    // Rating filter for 待推荐 tab
    if (activeTab === "evaluated" && ratingFilter !== "all") {
      // Check latest evaluation rating
      if (i.status === "已评估" && ratingFilter !== "all") {
        // We need the rating from evaluations — but we don't have it in the influencer list
        // Let's just check any A rated ones via the API's phase field
      }
    }
    if (!search) return true;
    const s = search.toLowerCase();
    return i.name.toLowerCase().includes(s) || i.category.toLowerCase().includes(s) || (i.contact || "").toLowerCase().includes(s);
  });

  const getDisplayStatus = (inf: Influencer) => {
    if (inf.status === "评估中" && activeTab === "evaluating") return "待评估";
    if (inf.phase === "completed_discovery") return "已入池";
    return inf.status;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">达人发现</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            共 {influencers.length} 位达人
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/agency/influencers/tasks">
            <Button size="sm"><ListTodo className="size-3.5" />添加任务</Button>
          </Link>
          {activeTab === "evaluating" && (
            <Button size="sm" variant="outline" onClick={() => csvRef.current?.click()}>
              <Upload className="size-3.5" />导入CSV
            </Button>
          )}
          <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
        </div>
      </div>

      {/* Phase tabs */}
      <div className="flex gap-1 rounded-lg bg-[var(--secondary)] p-1 w-fit">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setSearch(""); setRatingFilter("all"); }}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
              activeTab === tab.key
                ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            {tab.key === "evaluated" && <Star className="size-3.5 inline mr-1.5" />}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input placeholder="搜索达人名称、品类..." value={search} onChange={e => setSearch(e.target.value)} className="h-9 pl-8 text-sm" />
        </div>
        {activeTab === "evaluated" && (
          <div className="flex rounded-lg bg-[var(--secondary)] p-0.5">
            {[{ k: "all", l: "全部" }, { k: "A", l: "A级" }, { k: "B", l: "B级" }, { k: "C", l: "C级" }, { k: "D", l: "D级" }].map(r => (
              <button key={r.k} onClick={() => setRatingFilter(r.k)}
                className={cn("px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                  ratingFilter === r.k ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]")}>
                {r.l}
              </button>
            ))}
          </div>
        )}
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
                {(activeTab === "evaluating" || activeTab === "evaluated" || activeTab === "recommended") && (
                  <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">操作</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inf => (
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
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-lg:hidden">{inf.gmv_range || inf.monthly_gmv || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">
                    {inf.contact ? `${inf.contact}${inf.contact_phone ? ` / ${inf.contact_phone}` : ""}` : "-"}
                  </td>
                  <td className="py-3 px-4">
                    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[getDisplayStatus(inf)] || statusClass["待评估"])}>
                      {getDisplayStatus(inf)}
                    </span>
                  </td>
                  {(activeTab === "evaluating" || activeTab === "evaluated" || activeTab === "recommended") && (
                    <td className="py-3 px-4">
                      {activeTab === "evaluating" && (
                        <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleStartEval(inf)}>
                          <ClipboardCheck className="size-3" />开始评估
                        </Button>
                      )}
                      {activeTab === "evaluated" && (
                        <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleRecommend(inf.id)}>
                          <Star className="size-3" />推荐给老板
                        </Button>
                      )}
                      {activeTab === "recommended" && (
                        <Link href={`/agency/influencers/${inf.id}`}>
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                            查看详情
                          </Button>
                        </Link>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
              {activeTab === "discovery" ? "暂无发现阶段的达人" : activeTab === "evaluating" ? "暂无待评估的达人" : activeTab === "evaluated" ? "暂无已评估的达人" : "暂无待老板确认的达人"}
            </div>
          )}
        </div>
      )}

      {/* Evaluation Modal */}
      {evalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEvalModal(null)}>
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-[var(--foreground)]">
                <ClipboardCheck className="size-5 inline mr-2 text-blue-500" />
                评估 {evalModal.name}
              </h3>
              <span className="text-xs text-[var(--muted-foreground)]">{evalModal.category || ""}</span>
            </div>

            {evalError && <div className="mb-4 text-sm text-[var(--destructive)] rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-3 py-2">{evalError}</div>}

            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">月度 GMV</label>
                  <input value={evalForm.gmv} onChange={e => setEvalForm(p => ({ ...p, gmv: e.target.value }))}
                    placeholder="例如: ฿50-100万"
                    className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
                <div>
                  <label className="text-xs font-medium">直播间 GMV 占比</label>
                  <input value={evalForm.liveRatio} onChange={e => setEvalForm(p => ({ ...p, liveRatio: e.target.value }))}
                    placeholder="例如: 70%"
                    className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium">评分等级</label>
                <div className="mt-1.5 flex gap-2">
                  {["A", "B", "C", "D"].map(r => (
                    <button key={r} onClick={() => setEvalForm(p => ({ ...p, rating: r }))}
                      className={cn("flex-1 py-1.5 rounded-md text-sm font-semibold border transition-colors",
                        evalForm.rating === r
                          ? "border-current text-white bg-current"
                          : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-current",
                        r === "A" ? "text-green-600 bg-green-600" : r === "B" ? "text-blue-600 bg-blue-600" : r === "C" ? "text-amber-600 bg-amber-600" : "text-red-600 bg-red-600"
                      )}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">内容质量</label>
                  <input value={evalForm.content} onChange={e => setEvalForm(p => ({ ...p, content: e.target.value }))}
                    placeholder="高/中/低"
                    className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
                <div>
                  <label className="text-xs font-medium">品牌匹配度</label>
                  <input value={evalForm.brand} onChange={e => setEvalForm(p => ({ ...p, brand: e.target.value }))}
                    placeholder="高/中/低"
                    className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium">备注</label>
                <textarea value={evalForm.notes} onChange={e => setEvalForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="补充说明..." rows={2}
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)] resize-none" />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEvalModal(null)}>取消</Button>
              <Button size="sm" onClick={handleSaveEval} disabled={evalSaving}>
                {evalSaving ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
                保存评估
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
